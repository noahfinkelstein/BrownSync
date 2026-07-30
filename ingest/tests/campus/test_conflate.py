"""Binding ArcGIS footprints to curated places.

This is the highest-consequence module in the campus lane: a wrong binding puts
course meetings on the wrong building, and `places.ndjson` slugs are foreign
keys for 1,755 `course_meetings` rows.
"""

from __future__ import annotations

import pytest

from brownsync_ingest.campus.arcgis import load_arcgis_geojson, normalize_features
from brownsync_ingest.campus.conflate import (
    NEAREST_EXCLUDED_KINDS,
    NEAREST_TOLERANCE_M,
    SeedPlace,
    conflate,
    load_seed_places,
    point_in_geometry,
)


SEEDS = "db/seeds/places.ndjson"


@pytest.fixture(scope="module")
def buildings():
    rows, _ = normalize_features(load_arcgis_geojson())
    return rows


@pytest.fixture(scope="module")
def places(repo_root):
    return load_seed_places(repo_root / SEEDS)


@pytest.fixture(scope="module")
def result(buildings, places):
    return conflate(buildings, places)


def square(lng: float, lat: float, half: float = 0.001) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [lng - half, lat - half],
                [lng + half, lat - half],
                [lng + half, lat + half],
                [lng - half, lat + half],
                [lng - half, lat - half],
            ]
        ],
    }


class TestPointInGeometry:
    def test_inside_and_outside(self) -> None:
        poly = square(-71.4, 41.83)
        assert point_in_geometry(-71.4, 41.83, poly)
        assert not point_in_geometry(-71.5, 41.83, poly)
        assert not point_in_geometry(-71.4, 41.9, poly)

    def test_respects_holes(self) -> None:
        donut = {
            "type": "Polygon",
            "coordinates": [
                [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]],
                [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5]],
            ],
        }
        assert point_in_geometry(0.75, 0, donut)
        assert not point_in_geometry(0, 0, donut)  # in the hole

    def test_handles_multipolygon(self) -> None:
        multi = {
            "type": "MultiPolygon",
            "coordinates": [square(-71.4, 41.83)["coordinates"], square(-71.3, 41.83)["coordinates"]],
        }
        assert point_in_geometry(-71.4, 41.83, multi)
        assert point_in_geometry(-71.3, 41.83, multi)
        assert not point_in_geometry(-71.35, 41.83, multi)


class TestTolerance:
    def test_the_tolerance_is_metres_not_hundreds_of_metres(self) -> None:
        # REGRESSION. This constant was briefly raised to 200.0, which bound
        # International House to the "OMAC Shed" 138 m away, RISD's Chace
        # Center to Macfarlane House at 127 m, and the Soldiers Memorial Gate
        # to Saint Stephen's Church at 99 m. A place with no building must stay
        # unmatched; that is the honest answer, not a nearby stranger.
        assert NEAREST_TOLERANCE_M <= 30.0

    def test_no_nearest_match_exceeds_the_tolerance(self, result) -> None:
        for match in result.matches:
            if match.method == "nearest-within-tolerance":
                assert match.distance_m <= NEAREST_TOLERANCE_M, match

    def test_containment_matches_record_zero_distance(self, result) -> None:
        for match in result.matches:
            if match.method == "centroid-in-footprint":
                assert match.distance_m == 0.0

    def test_a_far_place_stays_unmatched(self, buildings) -> None:
        far = SeedPlace("far-away", "Far Away", "academic", 41.90, -71.30)
        outcome = conflate(buildings, [far])
        assert outcome.unmatched_places == ("far-away",)
        assert outcome.by_code == {}


class TestRealData:
    def test_matches_the_large_majority_of_curated_places(self, result, places) -> None:
        matched = len(places) - len(result.unmatched_places)
        assert matched >= 155, f"only {matched}/{len(places)} places bound"

    def test_reports_no_ambiguities(self, result) -> None:
        assert result.ambiguities == ()

    def test_unmatched_places_are_all_things_without_a_building(self, result, places) -> None:
        # Greens, quads, gates, athletic fields, and RISD's Chace Center. Every
        # one of these SHOULD be unmatched — they have no Brown building.
        by_id = {p.id: p for p in places}
        for place_id in result.unmatched_places:
            place = by_id[place_id]
            looks_outdoor = place.kind in {"outdoor", "athletic"} or any(
                word in place.name.lower()
                for word in ("green", "quad", "field", "gate", "stadium", "chace", "house", "street")
            )
            assert looks_outdoor, f"{place_id} ({place.kind}, {place.name!r}) should have matched"

    def test_never_renames_or_invents_a_place_id(self, result, places) -> None:
        # places.ndjson slugs are FK targets of 1,755 course_meetings rows.
        known = {p.id for p in places}
        for match in result.matches:
            assert match.place_id in known

    def test_binds_each_place_at_most_once(self, result) -> None:
        bound = [m.place_id for m in result.matches]
        assert len(bound) == len(set(bound))

    def test_primary_is_one_of_the_buildings_occupants(self, result) -> None:
        for code, primary in result.by_code.items():
            assert primary in result.all_places_by_code[code]


class TestManyPlacesPerBuilding:
    def test_a_footprint_may_host_several_places(self, result) -> None:
        multi = {c: v for c, v in result.all_places_by_code.items() if len(v) > 1}
        assert len(multi) >= 5, "dining venues inside halls should produce several"

    @pytest.mark.parametrize(
        ("inner", "expected_primary"),
        [
            ("andrews-commons", "andrews-hall"),
            ("blue-room", "stephen-robert-62-campus-center"),
            ("ivy-room", "sharpe-refectory"),
            ("josiahs", "vartan-gregorian-quad-b"),
        ],
    )
    def test_the_containing_hall_wins_over_the_venue_inside_it(
        self, result, inner: str, expected_primary: str
    ) -> None:
        # "The Ratty" is a room inside a building whose name people use for the
        # building, so tapping the footprint must land on the hall. Kind order
        # alone gets this wrong (both are `dining`) — the tiebreak is name
        # similarity to the building's OWN label.
        code = next(c for c, v in result.all_places_by_code.items() if inner in v)
        assert result.by_code[code] == expected_primary


class TestOutdoorExclusion:
    def test_outdoor_places_are_never_nearest_matched(self, result, places) -> None:
        # Without this guard the Ruth J. Simmons Quadrangle bound to "Saint
        # Stephen's Church" 20 m away. Greens are served by the landmarks layer.
        by_id = {p.id: p for p in places}
        for match in result.matches:
            if match.method == "nearest-within-tolerance":
                assert by_id[match.place_id].kind not in NEAREST_EXCLUDED_KINDS

    def test_the_greens_stay_unmatched_here(self, result) -> None:
        for green in ("the-college-green", "the-quiet-green", "wriston-quadrangle"):
            assert green in result.unmatched_places
