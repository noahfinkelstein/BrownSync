"""Golden parity: PlaceResolver.resolve() vs PostgreSQL resolve_place().

Migration ``db/migrations/0007_place_resolution.sql`` moves contract §2 place
resolution into SQL, because the poller has no gazetteer and was writing
``place_id = null`` over every resolved place on each refresh. That makes the
database the second implementation of a resolver whose Python original was
itself built to mirror pg_trgm — so the two must be pinned against each other
the way ``test_trigram_postgres.py`` pins the trigram function.

This test replays a corpus of real location strings through BOTH and asserts
identical ``(place_id, room, method)``. A divergence here is a silent
production bug: rows would resolve differently depending on whether ingestion
or the poller wrote them.

Runs only when TEST_DATABASE_URL points at a disposable database carrying the
migrated schema; skips cleanly offline, exactly like its sibling.

ISOLATION. Everything happens in one transaction that is always rolled back.
``place_aliases`` is emptied first and the curated catalog upserted into
``places``, so the trigger repopulates the index with exactly the catalog the
Python resolver was constructed from. Other gazetteer rows may still exist in
``places``, but with no alias rows they are invisible to ``resolve_place`` —
which is what makes the comparison apples-to-apples without deleting anything
that other tables reference.
"""

from __future__ import annotations

import os
from typing import Iterator

import pytest

psycopg = pytest.importorskip("psycopg")

from brownsync_ingest.gazetteer.aliases import (  # noqa: E402
    load_curated_catalog,
    normalize_alias,
)
from brownsync_ingest.gazetteer.resolver import PlaceResolver  # noqa: E402


DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = [
    pytest.mark.postgres,
    pytest.mark.skipif(
        not DATABASE_URL,
        reason="TEST_DATABASE_URL is not set; postgres integration tests need a disposable database",
    ),
]


# Verbatim location strings from the Fall 2026 export plus the resolver's own
# behavioural vectors: exact hits, alias prefixes with rooms, rooms that must
# keep their raw capitalisation, mid-raw-token traps, typos, and strings that
# must stay unresolved. Every one of these is pinned on the Python side in
# test_resolver.py; here they only have to AGREE across implementations.
CORPUS: tuple[str, ...] = (
    # exact
    "Sayles Hall",
    "the ratty",
    "SMITH-BUONANNO  HALL",
    "  The  Ratty  ",
    "Barus Building",
    "Barus & Holley",
    "B&H",
    "85 Waterman Street",
    "85 Waterman",
    # alias prefix + room
    "Salomon 101",
    "Salomon Center 101",
    "Smith-Buonanno Hall 106",
    "Salomon B101",
    "Salomon 001 A",
    "Barus Building 108",
    "Barus and Holley 168",
    "Barus Building 141",
    "Barus & Holley 166",
    # digitless remainder is not a room
    "Sayles Hall Auditorium",
    # fuzzy
    "MacMillan 117",
    "Smith Buonano Hall",
    "S. Frank Hall for Life Science MARC",
    # unresolvable
    "zzzz qqqq xyxyx",
    "",
    "   ",
    " & ",
    "SMN121 801",
    "National Press Building DC 975 968",
    "300 Richmond Street 298",
    # Task 6B alias-growth vectors (verbatim export strings)
    "S. Frank Hall for Life Science 218",
    "155 George Street 106",
    "Grant Recital 105",
    "111 Thayer St-Watson Institute 138",
    "190 Hope Street 102",
    "Geo-Chemistry Building 039",
    "68 Waterman Mencoff Hall 205",
    "79 Brown St-Peter Green Hse 106",
    "84 Prospect St-Rochambeau Hse 107",
    "163 George Street 103",
    "159 George St-Meiklejohn House 102",
    "50 John Street 120",
    "1 Euclid Ave, Nelson Ctr Entr 201",
    "47 George St-Horace Mann 103",
    "45 Prospect St-CorlissBrackett 106",
    "67 George Street 104",
    "135 Thayer Street 101",
    "2 Stimson Avenue 111",
    "59 Charlesfield Street 101",
    "8 Fones Alley 016",
    "271 Thayer Street 2NDFLOOR",
    "Steinert Hall 105",
    "130 Hope St (Feinstein Bldg.) 104",
    "Gerard House 101",
    "59 George St- S. Miller House 101",
    "80 Waterman St - Walter Hall 102",
    "Nicholson House 101",
    "101 Thayer Street (VGQ 1st fl) 116E",
    "222 Richmond (Alpert Med) 280",
    # Task 10 address traps — strings that used to bind to the WRONG building
    "70 Brown Street 315",
    "94 Waterman Street- CSSJ 110",
    "155 South Main Street - Packet 151",
    "69 Brown Street 315",
)


def _catalog_corpus() -> list[str]:
    """Every curated alias, plus the same alias carrying a room number.

    This is the part that gives the parity test breadth rather than depth: it
    drives both implementations through the exact and alias-prefix stages once
    per alias in the real gazetteer, which is where the overwhelming majority
    of production strings resolve.
    """
    catalog = load_curated_catalog()
    queries: list[str] = []
    for place in catalog.places:
        for alias in place.aliases:
            queries.append(alias)
            queries.append(f"{alias} 101")
    return queries


@pytest.fixture(scope="module")
def connection() -> Iterator["psycopg.Connection"]:
    connection = psycopg.connect(DATABASE_URL)
    try:
        yield connection
    finally:
        connection.rollback()
        connection.close()


@pytest.fixture(scope="module")
def loaded(connection: "psycopg.Connection") -> Iterator["psycopg.Connection"]:
    """Point resolve_place at exactly the curated catalog, then roll it back."""
    catalog = load_curated_catalog()
    with connection.cursor() as cur:
        # No table references place_aliases, so emptying it isolates the
        # resolver without touching anything the FKs care about.
        cur.execute("delete from place_aliases")
        for place in catalog.places:
            aliases = list(dict.fromkeys(place.aliases))
            cur.execute(
                """
                insert into places (id, name, aliases, kind, lat, lng)
                values (%s, %s, %s, %s, %s, %s)
                on conflict (id) do update
                  set name = excluded.name, aliases = excluded.aliases
                """,
                (
                    place.id,
                    place.name,
                    aliases,
                    place.kind,
                    place.lat if place.lat is not None else 41.826,
                    place.lng if place.lng is not None else -71.403,
                ),
            )
    yield connection
    connection.rollback()


@pytest.fixture(scope="module")
def resolver() -> PlaceResolver:
    return PlaceResolver.from_files()


def _sql_resolve(
    connection: "psycopg.Connection", value: str
) -> tuple[str | None, str | None, str]:
    with connection.cursor() as cur:
        cur.execute("select place_id, room, method from resolve_place(%s)", (value,))
        row = cur.fetchone()
    assert row is not None, f"resolve_place({value!r}) returned no row"
    return (row[0], row[1], row[2])


def _python_resolve(
    resolver: PlaceResolver, value: str
) -> tuple[str | None, str | None, str]:
    resolution = resolver.resolve(value)
    return (resolution.place_id, resolution.room, resolution.method)


def test_the_alias_index_mirrors_the_catalog(loaded: "psycopg.Connection") -> None:
    """The trigger must index exactly `name ∪ aliases`, normalized."""
    catalog = load_curated_catalog()
    expected: set[tuple[str, str]] = set()
    for place in catalog.places:
        for alias in place.aliases:
            expected.add((place.id, normalize_alias(alias)))
    with loaded.cursor() as cur:
        cur.execute("select place_id, alias_norm from place_aliases")
        actual = {(row[0], row[1]) for row in cur.fetchall()}
    assert actual == expected


@pytest.mark.parametrize("value", CORPUS, ids=[repr(v) for v in CORPUS])
def test_sql_resolution_matches_the_python_resolver(
    loaded: "psycopg.Connection", resolver: PlaceResolver, value: str
) -> None:
    assert _sql_resolve(loaded, value) == _python_resolve(resolver, value)


def test_every_curated_alias_resolves_identically(
    loaded: "psycopg.Connection", resolver: PlaceResolver
) -> None:
    """Breadth pass over the whole gazetteer, reported as one diff.

    Parametrizing ~1,400 database round trips would dominate the suite's
    runtime, so this runs as a single test that collects every divergence and
    fails with all of them at once — a partial port shows its whole shape in
    one CI log instead of one vector at a time.
    """
    divergences: list[tuple[str, tuple, tuple]] = []
    for value in _catalog_corpus():
        sql = _sql_resolve(loaded, value)
        python = _python_resolve(resolver, value)
        if sql != python:
            divergences.append((value, python, sql))
    assert divergences == [], (
        f"{len(divergences)} alias vector(s) diverge between the Python and SQL "
        f"resolvers (query, python, sql): {divergences[:20]}"
    )
