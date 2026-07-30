"""Integration tests against a real Postgres with PostGIS.

These run only when TEST_DATABASE_URL points at a disposable database. Each
module run works inside its own temporary schema and removes only that schema.
"""

from __future__ import annotations

from datetime import UTC, datetime, time
import os
from typing import Iterator
from uuid import UUID, uuid4

import pytest

psycopg = pytest.importorskip("psycopg")
from psycopg import errors, sql  # noqa: E402

from brownsync_ingest.contract import (  # noqa: E402
    CourseMeetingRow,
    EventRow,
    OrganizationRow,
    PlaceRow,
)
from brownsync_ingest.repository import PostgresRepository  # noqa: E402
from brownsync_ingest.run_log import SourceRunRecorder  # noqa: E402


DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = [
    pytest.mark.postgres,
    pytest.mark.skipif(
        not DATABASE_URL,
        reason="TEST_DATABASE_URL is not set; postgres integration tests need a disposable database",
    ),
]

T0 = datetime(2026, 9, 1, 6, 0, tzinfo=UTC)
T1 = datetime(2026, 9, 1, 7, 0, tzinfo=UTC)

_TABLES = """
create table places (
  id            text primary key,
  name          text not null,
  aliases       text[] not null default '{}',
  kind          text not null,
  lat           double precision not null,
  lng           double precision not null,
  polygon       geometry(MultiPolygon, 4326),
  address       text,
  osm_id        text,
  source        text not null default 'osm'
);

create table organizations (
  id            text primary key,
  name          text not null,
  kind          text not null,
  category      text,
  description   text,
  url           text,
  instagram     text,
  default_place_id text references places(id),
  source        text not null
);

create table events (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,
  source_id     text not null,
  canonical_id  uuid references events(id),
  title         text not null,
  description   text,
  start_ts      timestamptz not null,
  end_ts        timestamptz,
  is_all_day    boolean not null default false,
  rrule         text,
  location_raw  text,
  place_id      text references places(id),
  lat           double precision,
  lng           double precision,
  org_id        text references organizations(id),
  category      text,
  tags          text[] not null default '{}',
  url           text,
  cost          text,
  confidence    real not null default 1.0,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  is_canceled   boolean not null default false,
  raw           jsonb,
  unique (source, source_id)
);
create index events_time_idx  on events (start_ts, end_ts);
create index events_geo_idx   on events using gist (ST_SetSRID(ST_MakePoint(lng, lat), 4326));
create index events_title_trgm on events using gin (title gin_trgm_ops);

create table course_meetings (
  id            text primary key,
  srcdb         text not null,
  crn           text not null,
  course_code   text not null,
  title         text not null,
  instructor    text,
  days          text not null,
  start_time    time not null,
  end_time      time not null,
  location_raw  text,
  place_id      text references places(id),
  room          text,
  enrollment    int,
  raw           jsonb
);

create table source_runs (
  id          bigserial primary key,
  source      text not null,
  started_at  timestamptz not null,
  finished_at timestamptz,
  status      text not null,
  items_upserted int,
  error       text
);
"""


@pytest.fixture(scope="module")
def schema_name() -> str:
    return f"brownsync_test_{uuid4().hex[:12]}"


@pytest.fixture(scope="module")
def admin_connection(schema_name: str) -> Iterator[psycopg.Connection]:
    connection = psycopg.connect(DATABASE_URL, autocommit=True)
    try:
        connection.execute("create extension if not exists postgis")
        connection.execute("create extension if not exists pg_trgm")
        connection.execute(
            sql.SQL("create schema {}").format(sql.Identifier(schema_name))
        )
        connection.execute(
            sql.SQL("set search_path to {}, public").format(sql.Identifier(schema_name))
        )
        connection.execute(_TABLES)
        yield connection
    finally:
        connection.execute(
            sql.SQL("drop schema if exists {} cascade").format(sql.Identifier(schema_name))
        )
        connection.close()


@pytest.fixture(autouse=True)
def clean_tables(admin_connection: psycopg.Connection) -> None:
    admin_connection.execute(
        "truncate table events, course_meetings, organizations, places, source_runs "
        "restart identity cascade"
    )


@pytest.fixture()
def repo(
    admin_connection: psycopg.Connection, schema_name: str
) -> Iterator[PostgresRepository]:
    connection = psycopg.connect(DATABASE_URL, autocommit=False)
    connection.execute(
        sql.SQL("set search_path to {}, public").format(sql.Identifier(schema_name))
    )
    connection.commit()
    repository = PostgresRepository(connection)
    yield repository
    repository.close()


def event(source_id: str, **overrides: object) -> EventRow:
    payload: dict[str, object] = {
        "source": "livewhale",
        "source_id": source_id,
        "title": source_id,
        "start_ts": datetime(2026, 9, 2, 9, tzinfo=UTC),
    }
    payload.update(overrides)
    return EventRow(**payload)


def fetch_event(
    admin_connection: psycopg.Connection, source_id: str
) -> tuple[object, ...]:
    row = admin_connection.execute(
        "select id, first_seen_at, last_seen_at, title, tags, raw, is_canceled "
        "from events where source = %s and source_id = %s",
        ("livewhale", source_id),
    ).fetchone()
    assert row is not None
    return row


def test_event_insert_gets_defaults_and_conflict_preserves_identity(
    repo: PostgresRepository, admin_connection: psycopg.Connection
) -> None:
    assert repo.upsert_events([event("ev-1", tags=["talk"], raw={"v": 1})]) == 1
    inserted = fetch_event(admin_connection, "ev-1")
    first_id, first_seen, first_last_seen = inserted[0], inserted[1], inserted[2]
    assert isinstance(first_id, UUID)
    assert first_seen is not None and first_last_seen is not None

    later = datetime(2026, 9, 3, 12, tzinfo=UTC)
    assert (
        repo.upsert_events(
            [event("ev-1", title="Renamed", tags=["talk", "free"], raw={"v": 2}, last_seen_at=later)]
        )
        == 1
    )
    updated = fetch_event(admin_connection, "ev-1")
    assert updated[0] == first_id
    assert updated[1] == first_seen
    assert updated[2] == later
    assert updated[3] == "Renamed"
    assert updated[4] == ["talk", "free"]
    assert updated[5] == {"v": 2}
    count = admin_connection.execute("select count(*) from events").fetchone()
    assert count == (1,)


def test_new_non_cancelled_sighting_clears_prior_cancellation(
    repo: PostgresRepository, admin_connection: psycopg.Connection
) -> None:
    repo.upsert_events([event("ev-2", is_canceled=True)])
    assert fetch_event(admin_connection, "ev-2")[6] is True

    repo.upsert_events([event("ev-2")])
    assert fetch_event(admin_connection, "ev-2")[6] is False


def test_place_wkt_becomes_multipolygon_geometry_and_null_stays_null(
    repo: PostgresRepository, admin_connection: psycopg.Connection
) -> None:
    with_polygon = PlaceRow(
        id="barus-holley",
        name="Barus & Holley",
        kind="academic",
        lat=41.8268,
        lng=-71.3993,
        polygon="MULTIPOLYGON(((0 0,0 1,1 1,0 0)))",
    )
    without_polygon = PlaceRow(
        id="sayles-hall", name="Sayles Hall", kind="academic", lat=41.826, lng=-71.403
    )
    assert repo.upsert_places([with_polygon, without_polygon]) == 2

    geometry = admin_connection.execute(
        "select ST_GeometryType(polygon), ST_SRID(polygon) from places where id = %s",
        ("barus-holley",),
    ).fetchone()
    assert geometry == ("ST_MultiPolygon", 4326)
    null_polygon = admin_connection.execute(
        "select polygon is null from places where id = %s", ("sayles-hall",)
    ).fetchone()
    assert null_polygon == (True,)

    repo.upsert_places(
        [with_polygon.model_copy(update={"polygon": "MULTIPOLYGON(((0 0,0 2,2 2,0 0)))", "name": "B&H"})]
    )
    refreshed = admin_connection.execute(
        "select name, ST_AsText(polygon) from places where id = %s", ("barus-holley",)
    ).fetchone()
    assert refreshed[0] == "B&H"
    assert "2 2" in refreshed[1]


def test_organizations_and_course_meetings_refresh_mutable_columns(
    repo: PostgresRepository, admin_connection: psycopg.Connection
) -> None:
    org = OrganizationRow(
        id="brown-outing-club", name="Brown Outing Club", kind="club", source="clubs"
    )
    repo.upsert_organizations([org])
    repo.upsert_organizations(
        [org.model_copy(update={"name": "BOC", "url": "https://boc.brown.edu"})]
    )
    org_row = admin_connection.execute(
        "select name, url from organizations where id = %s", ("brown-outing-club",)
    ).fetchone()
    assert org_row == ("BOC", "https://boc.brown.edu")

    meeting = CourseMeetingRow(
        id="202710-12345-0",
        srcdb="202710",
        crn="12345",
        course_code="CSCI 0150",
        title="Intro",
        days="MWF",
        start_time=time(9, 0),
        end_time=time(9, 50),
    )
    repo.upsert_course_meetings([meeting])
    repo.upsert_course_meetings(
        [meeting.model_copy(update={"room": "101", "enrollment": 220, "raw": {"ok": True}})]
    )
    meeting_row = admin_connection.execute(
        "select room, enrollment, raw from course_meetings where id = %s",
        ("202710-12345-0",),
    ).fetchone()
    assert meeting_row == ("101", 220, {"ok": True})


def test_failed_batch_rolls_back_every_row(
    repo: PostgresRepository, admin_connection: psycopg.Connection
) -> None:
    with pytest.raises(errors.ForeignKeyViolation):
        repo.upsert_events([event("ev-good"), event("ev-bad", org_id="missing-org")])

    count = admin_connection.execute("select count(*) from events").fetchone()
    assert count == (0,)
    # The connection must be usable again after the rollback.
    assert repo.upsert_events([event("ev-good")]) == 1


def test_full_and_partial_cancellation_windows(
    repo: PostgresRepository, admin_connection: psycopg.Connection
) -> None:
    window_start = datetime(2026, 9, 1, tzinfo=UTC)
    window_end = datetime(2026, 9, 8, tzinfo=UTC)
    repo.upsert_events(
        [
            event("e1", start_ts=datetime(2026, 9, 2, 10, tzinfo=UTC)),
            event("e2", start_ts=datetime(2026, 9, 3, 10, tzinfo=UTC)),
            event("e3", start_ts=datetime(2026, 9, 20, 10, tzinfo=UTC)),
            event("c1", source="cab", start_ts=datetime(2026, 9, 2, 10, tzinfo=UTC)),
        ]
    )

    canceled = repo.cancel_missing_events(
        source="livewhale",
        coverage_start=window_start,
        coverage_end=window_end,
        seen_source_ids=["e1"],
        complete=True,
    )
    assert canceled == 1
    flags = dict(
        admin_connection.execute("select source_id, is_canceled from events").fetchall()
    )
    assert flags == {"e1": False, "e2": True, "e3": False, "c1": False}

    canceled_all = repo.cancel_missing_events(
        source="livewhale",
        coverage_start=window_start,
        coverage_end=window_end,
        seen_source_ids=[],
        complete=True,
    )
    assert canceled_all == 2  # e1 and the already-canceled e2 are both in-window
    flags = dict(
        admin_connection.execute("select source_id, is_canceled from events").fetchall()
    )
    assert flags == {"e1": True, "e2": True, "e3": False, "c1": False}
    count = admin_connection.execute("select count(*) from events").fetchone()
    assert count == (4,)

    with pytest.raises(ValueError, match="complete"):
        repo.cancel_missing_events(
            source="livewhale",
            coverage_start=window_start,
            coverage_end=window_end,
            seen_source_ids=[],
            complete=False,
        )


class RepositorySink:
    def __init__(self, repository: PostgresRepository) -> None:
        self._repository = repository

    def start(self, source: str, started_at: datetime) -> int:
        return self._repository.start_source_run(source, started_at)

    def finish(
        self,
        run_id: int,
        *,
        finished_at: datetime,
        status: str,
        items_upserted: int,
        error: str | None,
    ) -> None:
        self._repository.finish_source_run(
            run_id,
            finished_at=finished_at,
            status=status,  # type: ignore[arg-type]
            items_upserted=items_upserted,
            error=error,
        )


def test_source_run_lifecycle_finalizes_errors_and_rejects_unknown_ids(
    repo: PostgresRepository, admin_connection: psycopg.Connection
) -> None:
    run_id = repo.start_source_run("livewhale", T0)
    started = admin_connection.execute(
        "select source, started_at, finished_at, status from source_runs where id = %s",
        (run_id,),
    ).fetchone()
    assert started == ("livewhale", T0, None, "partial")

    clock_values = iter([T0, T1])
    with pytest.raises(RuntimeError, match="feed exploded"):
        with SourceRunRecorder(
            RepositorySink(repo), "cab", clock=lambda: next(clock_values)
        ) as recorder:
            recorder.add_items(3)
            raise RuntimeError("feed exploded")

    error_row = admin_connection.execute(
        "select status, finished_at, items_upserted, error from source_runs "
        "where source = %s",
        ("cab",),
    ).fetchone()
    assert error_row == ("error", T1, 3, "feed exploded")

    with pytest.raises(LookupError):
        repo.finish_source_run(
            999_999, finished_at=T1, status="ok", items_upserted=0, error=None
        )
