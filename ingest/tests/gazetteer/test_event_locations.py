"""Enrichment round (Codex drop): LiveWhale event-location alias growth.

``fixtures/user_provided/brown_event_locations.csv`` aggregates the 153
distinct non-blank LOCATION strings of the 1,000-event LiveWhale snapshot
(772 event instances). Every alias or place added for them is grounded in
evidence — the recorded Overpass footprints (point-in-polygon on the
LiveWhale coordinates, OSM ``name``/``addr:*`` tags) or the string itself
naming an already-catalogued place — never guessed. Placeholder, virtual,
and away-venue strings stay unresolved by design.

The round also repairs two wrong-building trigram traps that were live in
the baseline: ``94 George Street`` (116 events, the John Carter Brown
Library per OSM way/166668948 ``addr:housenumber=94`` + ``operator=Brown
University``) resolved to 67-george-street, and ``111 Thayer Street``
(31 events, the Watson Institute per OSM way/177075426) resolved to
135-thayer-street.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from brownsync_ingest.gazetteer.catalog import build_catalog_from_files
from brownsync_ingest.gazetteer.resolver import PlaceResolver, Resolution

INGEST_ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = (
    INGEST_ROOT / "fixtures" / "user_provided" / "brown_event_locations.csv"
)

# Weighted (by event_count) resolution floor after alias growth. The
# measured baseline before this round was 457/772 (59.20%); the remaining
# unresolved weight is dominated by virtual/placeholder strings and
# athletics away venues that must never pin to a campus place.
WEIGHTED_FLOOR = 0.75

# string -> place id, each grounded in fixture/catalog evidence (see the
# per-place comments in gazetteer/aliases.yaml and the enrichment report).
GROUNDED = {
    # corrections of wrong-building trigram traps (previously "resolved")
    "94 George Street": "john-carter-brown-library",
    "111 Thayer Street": "watson-institute-for-international-studies",
    # aliases onto existing places
    "1 Euclid Ave, Providence RI 02906": "nelson-center-for-entrepreneurship",
    "Ruth J. Simmons Center for the Study of Slavery & Justice, 94 Waterman St., Providence, RI 02906": "center-for-the-study-of-slavery-and-justice",
    "Tisch Career Center": "hemisphere-building",
    "Lizzie and Jonathan Tisch Center for Career Exploration at Brown, Kobliner Conference Space: 1st Floor, 167 Angell Street, Providence, Rhode Island 02912, United States": "hemisphere-building",
    "Cogut Institute, Andrews House": "andrews-house",
    "Watson School of International and Public Affairs, 111 Thayer Street": "watson-institute-for-international-studies",
    "Joukowsky Forum, 111 Thayer Street": "watson-institute-for-international-studies",
    "70 Brown St., Providence": "70-brown-street",
    "70 Brown St., Providence, RI  02912": "70-brown-street",
    "Providence, R.I., Richard Gouse Field at Brown Stadium": "brown-stadium",
    "450 Brook St": "sternlicht-commons",
    "155 Angell Street, Providence": "churchill-house",
    "Building for Environmental Research and Teaching (BERT)": "85-waterman-street",
    "75 Waterman Street": "stephen-robert-62-campus-center",
    "Stephen Robert ’62 Campus Center, Petteruti Lounge, Room 201, 75 Waterman Street, Providence, RI 02912": "stephen-robert-62-campus-center",
    "Petteruti Lounge, 75 Waterman Street, Providence, RI 02912 - Stephen Robert ’62 Campus Center,": "stephen-robert-62-campus-center",
    "Stephen Robert ’62 Hall, 280 Brook Street": "stephen-robert-hall",
    "Pembroke Hall, 172 Meeting Street, Providence, RI": "pembroke-hall",
    "Main Green @ George St Gate Entrance": "the-college-green",
    "Engineering Research Center, RM 125 (345 Brook St Providence, RI)": "engineering-research-center",
    # new evidence-grounded places
    "Chase Center/RISD Museum": "chace-center",
    "South Street Landing": "south-street-landing",
    "70 Ship Street": "70-ship-street",
    "51 Prospect Street, Providence Rhode Island": "51-prospect-street",
    "Van Wickle Gates": "van-wickle-gates",
    "Van Wickle Gates and Memorial Park": "van-wickle-gates",
    "225 Dyer St. (5th Floor)": "wexford-innovation-complex",
    "225 Dyer St.": "wexford-innovation-complex",
    "225 Dyer Street": "wexford-innovation-complex",
    "International House of Rhode Island": "international-house-of-rhode-island",
    "Stonewall House": "stonewall-house",
}

# Strings that must STAY unresolved: virtual/placeholder values, athletics
# away venues (a campus pin would be wrong), and conflicting-evidence cases
# ("Brown Bookstore" geocodes inside the 164-176 Angell footprint while the
# store itself is at 244 Thayer, which the fixture does not cover).
UNRESOLVED_BY_DESIGN = (
    "Zoom",
    "Virtual",
    "TBA",
    "TBD",
    "See Description",
    "Dining Halls",
    "In Your Dorm Room",
    "Various Locations",
    "Cambridge, Mass.",
    "Tulsa, Okla.",
    "Providence, R.I., Chapey Field at Anderson Stadium",  # Providence College
    "Brown Bookstore",
    # street-only, no building evidence; a bare "172 Meeting Street" alias
    # was rejected in this round because it trigram-trapped this string
    "Meeting street",
)

# Previously-correct resolutions that must not regress under alias growth.
REGRESSION_SENTINELS = {
    "Rhode Island Hall": "rhode-island-hall",
    "MacMillan Hall": "macmillan-hall",
    "Providence, R.I., Katherine Moran Coleman Aquatics Center": "coleman-aquatics-center",
    "Providence, R.I., Stevenson-Pincince Field": "stevenson-pincince-field",
    "Page-Robinson Hall (previously JWW)": "page-robinson-hall",
    "Sharpe Refectory": "sharpe-refectory",
    "Stephen Robert ’62 Campus Center": "stephen-robert-62-campus-center",
    "180 George Street": "180-george-street",
    "Main Green": "the-college-green",
    "Sayles Hall": "sayles-hall",
    "Salomon Center": "salomon-center-for-teaching",
    "Andrews House": "andrews-house",
    "John Carter Brown Library": "john-carter-brown-library",
    "67 George Street": "67-george-street",
    "135 Thayer Street": "135-thayer-street",
}


@pytest.fixture(scope="module")
def rows() -> list[dict[str, str]]:
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


@pytest.fixture(scope="module")
def resolver() -> PlaceResolver:
    return PlaceResolver.from_files()


@pytest.fixture(scope="module")
def resolutions(
    rows: list[dict[str, str]], resolver: PlaceResolver
) -> dict[str, tuple[int, Resolution]]:
    return {
        row["location"]: (int(row["event_count"]), resolver.resolve(row["location"]))
        for row in rows
    }


class TestEventLocationDrop:
    def test_the_drop_shape_matches_its_provenance(self, rows: list[dict[str, str]]) -> None:
        assert len(rows) == 153
        assert sum(int(row["event_count"]) for row in rows) == 772
        assert len({row["location"] for row in rows}) == 153

    def test_weighted_resolution_meets_the_enrichment_floor(
        self, resolutions: dict[str, tuple[int, Resolution]]
    ) -> None:
        total = sum(count for count, _ in resolutions.values())
        resolved = sum(
            count
            for count, resolution in resolutions.values()
            if resolution.place_id is not None
        )
        assert total == 772
        assert resolved / total >= WEIGHTED_FLOOR, (
            f"weighted resolution {resolved}/{total} = {resolved / total:.4f} "
            f"below the {WEIGHTED_FLOOR:.0%} enrichment floor"
        )


class TestGroundedStrings:
    def test_every_grounded_string_is_actually_in_the_drop(
        self, rows: list[dict[str, str]]
    ) -> None:
        locations = {row["location"] for row in rows}
        missing = set(GROUNDED) - locations
        assert not missing, f"pinned strings not in the drop: {sorted(missing)}"

    @pytest.mark.parametrize("value,place_id", sorted(GROUNDED.items()))
    def test_grounded_string_resolves_to_its_evidence_backed_place(
        self, resolver: PlaceResolver, value: str, place_id: str
    ) -> None:
        resolution = resolver.resolve(value)
        assert resolution.place_id == place_id, (
            f"{value!r}: resolved to {resolution.place_id!r} "
            f"({resolution.method}/{resolution.reason}), expected {place_id!r}"
        )

    def test_the_wexford_fifth_floor_string_keeps_its_room(
        self, resolver: PlaceResolver
    ) -> None:
        resolution = resolver.resolve("225 Dyer St. (5th Floor)")
        assert resolution.place_id == "wexford-innovation-complex"
        assert resolution.room == "(5th Floor)"

    @pytest.mark.parametrize("value", UNRESOLVED_BY_DESIGN)
    def test_placeholder_virtual_and_away_strings_stay_unresolved(
        self, resolver: PlaceResolver, value: str
    ) -> None:
        assert resolver.resolve(value).place_id is None

    @pytest.mark.parametrize("value,place_id", sorted(REGRESSION_SENTINELS.items()))
    def test_previously_correct_resolutions_do_not_regress(
        self, resolver: PlaceResolver, value: str, place_id: str
    ) -> None:
        assert resolver.resolve(value).place_id == place_id


class TestNewPlacesCarryEvidence:
    @pytest.fixture(scope="class")
    def by_id(self) -> dict[str, object]:
        build = build_catalog_from_files()
        assert not [d for d in build.diagnostics if d.dropped]
        return {row.id: row for row in build.rows}

    @pytest.mark.parametrize(
        "place_id,osm_id",
        [
            ("chace-center", "way/1032446275"),
            ("wexford-innovation-complex", "way/710679438"),
            ("51-prospect-street", "way/771420949"),
            ("international-house-of-rhode-island", "way/195508296"),
            # upgraded: previously curated coords, now the named BERT footprint
            ("85-waterman-street", "way/176918226"),
        ],
    )
    def test_footprint_backed_places_carry_their_osm_way(
        self, by_id: dict[str, object], place_id: str, osm_id: str
    ) -> None:
        row = by_id[place_id]
        assert row.source == "osm"
        assert row.osm_id == osm_id
        assert row.polygon is not None

    @pytest.mark.parametrize(
        "place_id,lat,lng",
        [
            # curated coordinates taken verbatim from the LiveWhale evidence
            ("south-street-landing", 41.818344, -71.406139),
            ("van-wickle-gates", 41.826124, -71.404571),
            ("stonewall-house", 41.824775, -71.403111),
            ("70-ship-street", 41.818841, -71.4102),
        ],
    )
    def test_curated_places_pin_the_livewhale_coordinates(
        self, by_id: dict[str, object], place_id: str, lat: float, lng: float
    ) -> None:
        row = by_id[place_id]
        assert row.source == "curated"
        assert row.polygon is None
        assert row.lat == pytest.approx(lat)
        assert row.lng == pytest.approx(lng)
