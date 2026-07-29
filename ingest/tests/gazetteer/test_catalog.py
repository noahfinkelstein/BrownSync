from __future__ import annotations

import pytest

from brownsync_ingest.contract import PlaceRow
from brownsync_ingest.gazetteer.catalog import CatalogBuild, build_catalog, build_catalog_from_files
from brownsync_ingest.gazetteer.models import CuratedCatalog, CuratedPlace, OsmBuilding
from brownsync_ingest.policy import (
    validate_coordinates,
    validate_multipolygon_wkt,
    validate_slug,
)


ATTRIBUTION = "test data © OpenStreetMap contributors, ODbL 1.0"


def curated(**overrides: object) -> CuratedPlace:
    values: dict = {
        "id": "test-hall",
        "name": "Test Hall",
        "kind": "academic",
        "aliases": ("Test Hall",),
        "osm_name": "Test Hall",
        "lat": None,
        "lng": None,
    }
    values.update(overrides)
    return CuratedPlace(**values)


def building(**overrides: object) -> OsmBuilding:
    values: dict = {
        "osm_type": "way",
        "osm_id": "way/101",
        "name": "Test Hall",
        "tags": {"building": "university"},
        "wkt": "MULTIPOLYGON(((-71.5 41, -71.3 41, -71.3 41.2, -71.5 41.2, -71.5 41)))",
        "centroid": (41.1, -71.4),
        "fallback_center": (41.1, -71.4),
        "address": "81 Waterman Street, 02912",
        "geometry_error": None,
    }
    values.update(overrides)
    return OsmBuilding(**values)


def catalog_of(*places: CuratedPlace) -> CuratedCatalog:
    return CuratedCatalog(places=tuple(places), attribution=ATTRIBUTION)


class TestMerge:
    def test_osm_match_merges_geometry_address_and_provenance(self) -> None:
        build = build_catalog(catalog_of(curated()), {"Test Hall": building()})
        [row] = build.rows
        assert isinstance(row, PlaceRow)
        assert row.id == "test-hall"
        assert row.name == "Test Hall"
        assert row.kind == "academic"
        assert row.source == "osm"
        assert row.osm_id == "way/101"
        assert row.polygon is not None
        assert validate_multipolygon_wkt(row.polygon) == row.polygon
        assert (row.lat, row.lng) == (41.1, -71.4)
        assert row.address == "81 Waterman Street, 02912"
        assert build.diagnostics == []
        assert build.attribution == ATTRIBUTION

    def test_osm_centroid_wins_over_curated_coordinates(self) -> None:
        build = build_catalog(
            catalog_of(curated(lat=1.0, lng=2.0)), {"Test Hall": building()}
        )
        [row] = build.rows
        assert (row.lat, row.lng) == (41.1, -71.4)

    def test_invalid_osm_geometry_yields_none_polygon_diagnostic_and_bounds_center(self) -> None:
        broken = building(wkt=None, centroid=None, geometry_error="ring is not closed")
        build = build_catalog(catalog_of(curated()), {"Test Hall": broken})
        [row] = build.rows
        assert row.polygon is None
        assert row.source == "osm"
        assert (row.lat, row.lng) == (41.1, -71.4)  # bounds fallback
        [diagnostic] = build.diagnostics
        assert diagnostic.place_id == "test-hall"
        assert "ring is not closed" in diagnostic.reason
        assert diagnostic.dropped is False

    def test_invalid_osm_geometry_without_bounds_uses_curated_coordinates(self) -> None:
        broken = building(wkt=None, centroid=None, fallback_center=None, geometry_error="boom")
        build = build_catalog(
            catalog_of(curated(lat=41.83, lng=-71.4)), {"Test Hall": broken}
        )
        [row] = build.rows
        assert (row.lat, row.lng) == (41.83, -71.4)

    def test_curated_only_entry_uses_its_own_coordinates_and_curated_source(self) -> None:
        place = curated(id="green", name="Green", aliases=("Green",), osm_name="Green", lat=41.82, lng=-71.4)
        build = build_catalog(catalog_of(place), {})
        [row] = build.rows
        assert row.source == "curated"
        assert row.polygon is None
        assert row.osm_id is None
        assert row.address is None
        assert (row.lat, row.lng) == (41.82, -71.4)
        assert build.diagnostics == []

    def test_entry_with_no_usable_coordinates_is_dropped_with_diagnostics(self) -> None:
        broken = building(wkt=None, centroid=None, fallback_center=None, geometry_error="boom")
        build = build_catalog(catalog_of(curated()), {"Test Hall": broken})
        assert build.rows == []
        geometry_diagnostic, drop_diagnostic = build.diagnostics
        assert geometry_diagnostic.place_id == "test-hall"
        assert "boom" in geometry_diagnostic.reason
        assert geometry_diagnostic.dropped is False
        assert drop_diagnostic.place_id == "test-hall"
        assert drop_diagnostic.dropped is True

    def test_unmatched_entry_without_coordinates_is_dropped_with_a_diagnostic(self) -> None:
        build = build_catalog(catalog_of(curated()), {})
        assert build.rows == []
        [diagnostic] = build.diagnostics
        assert diagnostic.dropped is True
        assert "no usable coordinates" in diagnostic.reason

    def test_rows_carry_the_curated_aliases_and_are_sorted_by_id(self) -> None:
        first = curated(id="b-hall", name="B Hall", aliases=("B Hall", "B"), osm_name="B Hall")
        second = curated(id="a-hall", name="A Hall", aliases=("A Hall",), osm_name="A Hall", lat=41.82, lng=-71.4)
        build = build_catalog(catalog_of(first, second), {"B Hall": building(name="B Hall")})
        assert [row.id for row in build.rows] == ["a-hall", "b-hall"]
        assert build.rows[1].aliases == ["B Hall", "B"]


class TestRealAcceptance:
    @pytest.fixture(scope="class")
    def build(self) -> CatalogBuild:
        return build_catalog_from_files()

    def test_at_least_120_valid_rows_from_fixture_plus_catalog(self, build: CatalogBuild) -> None:
        assert len(build.rows) >= 120

    def test_every_row_passes_contract_and_policy_checks(self, build: CatalogBuild) -> None:
        for row in build.rows:
            revalidated = PlaceRow.model_validate(row.model_dump())
            assert revalidated == row
            assert validate_slug(row.id) == row.id
            validate_coordinates(row.lat, row.lng)
            validate_multipolygon_wkt(row.polygon)
            assert row.name in row.aliases, f"{row.id} must list its own name as an alias"
            assert row.source in ("osm", "curated")
            if row.source == "osm":
                assert row.osm_id, f"{row.id} claims osm source without osm_id"

    def test_row_ids_are_unique_and_sorted(self, build: CatalogBuild) -> None:
        ids = [row.id for row in build.rows]
        assert ids == sorted(ids)
        assert len(ids) == len(set(ids))

    def test_most_rows_carry_real_osm_footprints(self, build: CatalogBuild) -> None:
        with_polygon = [row for row in build.rows if row.polygon is not None]
        assert len(with_polygon) >= 120

    def test_the_six_canonical_dining_places_survive_the_merge(self, build: CatalogBuild) -> None:
        by_id = {row.id: row for row in build.rows}
        for place_id in (
            "sharpe-refectory",
            "andrews-commons",
            "verney-woolley-dining-hall",
            "blue-room",
            "ivy-room",
            "josiahs",
        ):
            assert place_id in by_id, f"dining place {place_id} missing from output"
            assert by_id[place_id].kind == "dining"

    def test_kassar_house_carries_its_two_part_relation_footprint(self, build: CatalogBuild) -> None:
        by_id = {row.id: row for row in build.rows}
        kassar = by_id["kassar-house"]
        assert kassar.osm_id == "relation/14295043"
        assert kassar.polygon is not None and kassar.polygon.count("((") == 2

    def test_rows_are_geographically_plausible_for_college_hill(self, build: CatalogBuild) -> None:
        for row in build.rows:
            assert 41.80 < row.lat < 41.86, row.id
            assert -71.42 < row.lng < -71.37, row.id

    def test_task_6b_alias_growth_keeps_the_catalog_at_162_places(
        self, build: CatalogBuild
    ) -> None:
        assert len(build.rows) == 162  # 148 from Task 4 + 14 export-proven venues
        by_id = {row.id: row for row in build.rows}
        # unnamed footprints claimed through the addr: fallback keys
        for place_id, osm_id in (
            ("2-stimson-avenue", "way/195508291"),
            ("135-thayer-street", "way/177016169"),
            ("59-charlesfield-street", "way/177075425"),
            ("8-fones-alley", "way/177075314"),
            ("271-thayer-street", "way/185225906"),
        ):
            assert by_id[place_id].osm_id == osm_id
            assert by_id[place_id].source == "osm"
            assert by_id[place_id].polygon is not None
        # the two curated-coordinate entries stay flagged as curated
        assert by_id["vartan-gregorian-quad"].source == "curated"
        assert by_id["warren-alpert-medical-school"].source == "curated"

    def test_attribution_credits_openstreetmap_and_odbl(self, build: CatalogBuild) -> None:
        assert "OpenStreetMap" in build.attribution
        assert "ODbL" in build.attribution

    def test_no_diagnostic_is_a_drop_on_the_real_data(self, build: CatalogBuild) -> None:
        dropped = [diagnostic for diagnostic in build.diagnostics if diagnostic.dropped]
        assert dropped == []
