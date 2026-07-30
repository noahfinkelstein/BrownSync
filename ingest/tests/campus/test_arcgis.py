"""ArcGIS normalization, geometry, and height — against the recorded fixture.

These tests read ``ingest/fixtures/recorded/arcgis/active-buildings.geojson``
and never touch the network, matching the repo's fixture discipline.
"""

from __future__ import annotations

import math

import pytest

from brownsync_ingest.campus.arcgis import (
    EXCLUDED_OWNERSHIP,
    load_arcgis_geojson,
    geometry_to_multipolygon_wkt,
    normalize_features,
    _ring_centroid,
)
from brownsync_ingest.campus.height import (
    MAX_FLOORS,
    METRES_PER_FLOOR,
    PARAPET_M,
    estimate_height,
    floors_from_area,
)


@pytest.fixture(scope="module")
def normalized():
    rows, diagnostics = normalize_features(load_arcgis_geojson())
    return rows, diagnostics


class TestFixtureShape:
    def test_the_recorded_layer_is_the_one_we_designed_against(self) -> None:
        doc = load_arcgis_geojson()
        assert doc["type"] == "FeatureCollection"
        # 263 features, single page, verified live 2026-07-29.
        assert len(doc["features"]) == 263

    def test_every_geometry_is_a_polygon(self) -> None:
        doc = load_arcgis_geojson()
        assert {f["geometry"]["type"] for f in doc["features"]} == {"Polygon"}

    def test_coordinates_are_wgs84_not_state_plane(self) -> None:
        # The service's native SR is wkid 102730 (RI State Plane FEET). A
        # request without f=geojson/outSR=4326 returns six-digit coordinates
        # that are silently wrong. Campus must sit near 41.83 N, -71.40 E.
        doc = load_arcgis_geojson()
        lng, lat = doc["features"][0]["geometry"]["coordinates"][0][0]
        assert 41.7 < lat < 41.9, lat
        assert -71.5 < lng < -71.3, lng


class TestNormalize:
    def test_excludes_sold_property_and_keeps_the_rest(self, normalized) -> None:
        rows, _ = normalized
        assert len(rows) == 262  # 263 minus the one Ownership_Status='Sold'
        assert EXCLUDED_OWNERSHIP == frozenset({"Sold"})
        assert all(r.ownership not in EXCLUDED_OWNERSHIP for r in rows)

    def test_property_code_is_unique_and_present(self, normalized) -> None:
        # promoteId requires this. A duplicate or null makes setFeatureState
        # silently target the wrong building — or nothing at all.
        rows, _ = normalized
        codes = [r.property_code for r in rows]
        assert all(codes)
        assert len(set(codes)) == len(codes)

    def test_a_duplicate_property_code_is_a_hard_error(self) -> None:
        doc = load_arcgis_geojson()
        one = doc["features"][0]
        clashing = {
            "type": "FeatureCollection",
            "features": [one, {**one, "properties": dict(one["properties"])}],
        }
        with pytest.raises(ValueError, match="promoteId requires uniqueness"):
            normalize_features(clashing)

    def test_every_building_resolves_a_label(self, normalized) -> None:
        rows, _ = normalized
        assert all(r.label.strip() for r in rows)

    def test_labels_come_overwhelmingly_from_facilities_display_names(self, normalized) -> None:
        rows, _ = normalized
        strong = sum(1 for r in rows if r.label_rung <= 2)
        assert strong / len(rows) >= 0.95, f"only {strong}/{len(rows)} labels above the address rung"

    def test_year_zero_sentinel_becomes_none(self, normalized) -> None:
        # 38 rows carry Year_of_Construction = 0 meaning "unknown". Rendering
        # an age ramp from the year 0 would peg them at the oldest colour.
        rows, _ = normalized
        assert all(r.year_built is None or r.year_built > 1600 for r in rows)
        assert any(r.year_built is None for r in rows)

    def test_centroids_land_on_college_hill(self, normalized) -> None:
        rows, _ = normalized
        for r in rows:
            assert 41.75 < r.lat < 41.87, (r.property_code, r.lat)
            assert -71.45 < r.lng < -71.37, (r.property_code, r.lng)

    def test_output_is_deterministic(self, normalized) -> None:
        rows, _ = normalized
        assert [r.property_code for r in rows] == sorted(r.property_code for r in rows)

    def test_diagnostics_are_reported_never_swallowed(self, normalized) -> None:
        _, diagnostics = normalized
        assert diagnostics
        assert any("Ownership_Status" in d for d in diagnostics)


class TestCentroid:
    def test_unit_square(self) -> None:
        square = {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]}
        lat, lng = _ring_centroid(square)
        assert lat == pytest.approx(1.0)
        assert lng == pytest.approx(1.0)

    def test_degenerate_ring_falls_back_to_the_mean_vertex(self) -> None:
        line = {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 0]]]}
        lat, lng = _ring_centroid(line)
        assert math.isfinite(lat) and math.isfinite(lng)

    def test_multipolygon_is_area_weighted(self) -> None:
        multi = {
            "type": "MultiPolygon",
            "coordinates": [
                [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
                [[[10, 0], [11, 0], [11, 1], [10, 1], [10, 0]]],
            ],
        }
        _, lng = _ring_centroid(multi)
        assert lng == pytest.approx(5.5)

    def test_survives_a_sliver_at_real_world_coordinates(self) -> None:
        # REGRESSION, from real data. A 4-point athletic-field sliver at
        # (-71.3940, 41.8301) spanning 7e-6 by 2e-6 degrees has a signed area
        # of ~2.3e-12 — the same magnitude as the rounding error of the naive
        # shoelace at that coordinate magnitude. Without translating to a local
        # origin the computed centroid was 42.58 N, -72.68 E, ~80 km away.
        sliver = {
            "type": "MultiPolygon",
            "coordinates": [
                [[[-71.393965, 41.830061], [-71.393958, 41.830062],
                  [-71.393962, 41.830064], [-71.393965, 41.830061]]],
                [[[-71.393965, 41.830061], [-71.393958, 41.830061],
                  [-71.393960, 41.830062], [-71.393965, 41.830061]]],
            ],
        }
        lat, lng = _ring_centroid(sliver)
        assert 41.8300 < lat < 41.8302, lat
        assert -71.3940 < lng < -71.3939, lng

    def test_survives_parts_wound_in_opposite_directions(self) -> None:
        # REGRESSION. Weighting by signed area drives the denominator toward
        # zero when winding is mixed and the centroid diverges — a real
        # MultiPolygon athletic field whose vertices all sat at 41.830 N
        # produced 42.58 N, -72.68 E, about 80 km off campus. GeoJSON makes no
        # winding guarantee, so magnitude weighting is required.
        ccw = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
        cw = [[10, 0], [10, 1], [11, 1], [11, 0], [10, 0]]
        multi = {"type": "MultiPolygon", "coordinates": [[ccw], [cw]]}
        lat, lng = _ring_centroid(multi)
        assert 0.0 <= lat <= 1.0, lat
        assert 0.0 <= lng <= 11.0, lng
        assert lng == pytest.approx(5.5)


class TestWkt:
    def test_wraps_a_polygon_as_a_multipolygon(self, normalized) -> None:
        # places.polygon is geometry(MultiPolygon, 4326); the layer returns
        # bare Polygons, so every one must be wrapped.
        rows, _ = normalized
        wkt = geometry_to_multipolygon_wkt(rows[0].geometry)
        assert wkt.startswith("MULTIPOLYGON (((")

    def test_closes_an_open_ring(self) -> None:
        open_ring = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1]]]}
        wkt = geometry_to_multipolygon_wkt(open_ring)
        assert wkt.count("0.0000000 0.0000000") == 2  # first point repeated to close

    def test_rejects_unsupported_geometry(self) -> None:
        with pytest.raises(ValueError, match="unsupported geometry"):
            geometry_to_multipolygon_wkt({"type": "LineString", "coordinates": []})


class TestHeight:
    def test_floor_count_is_gross_over_footprint(self) -> None:
        assert floors_from_area(10_000, 2_500) == 4

    def test_clamps_the_measured_outliers(self) -> None:
        # The fixture contains one ratio at 0.07 and one at 19.23.
        assert floors_from_area(7, 100) == 1
        # A 100 sq ft (9 m2) footprint is ~3 m across, so the ASPECT clamp —
        # not MAX_FLOORS — is what binds. Before it existed, an 11 m2 waste
        # shed derived 9 floors and rendered 32.7 m tall.
        assert floors_from_area(2_000, 100) == 2
        # A genuinely large footprint still reaches the storey clamp.
        assert floors_from_area(2_000_000, 50_000) == MAX_FLOORS

    @pytest.mark.parametrize("bad", [(None, 100), (100, None), (100, 0), (0, 100)])
    def test_missing_or_zero_inputs_yield_no_estimate(self, bad) -> None:
        assert floors_from_area(*bad) is None

    def test_height_includes_a_parapet(self) -> None:
        est = estimate_height(gross_area=10_000, footprint_area=2_500)
        assert est.floors == 4
        assert est.height_m == pytest.approx(4 * METRES_PER_FLOOR + PARAPET_M)
        assert est.source == "area-ratio"

    def test_osm_levels_wins_a_large_disagreement(self) -> None:
        # 4 floors derived vs 10 tagged: a human tagged that one.
        est = estimate_height(gross_area=10_000, footprint_area=2_500, osm_levels=10)
        assert est.floors == 10
        assert est.source == "osm-levels"
        assert est.diagnostics

    def test_osm_levels_does_not_override_a_small_disagreement(self) -> None:
        est = estimate_height(gross_area=10_000, footprint_area=2_500, osm_levels=5)
        assert est.floors == 4
        assert est.source == "area-ratio"

    def test_falls_back_to_a_default_with_a_diagnostic(self) -> None:
        est = estimate_height(gross_area=None, footprint_area=None)
        assert est.source == "default"
        assert est.diagnostics

    def test_real_heights_are_plausible(self, normalized) -> None:
        rows, _ = normalized
        for r in rows:
            assert 4.0 <= r.height_m <= MAX_FLOORS * METRES_PER_FLOOR + PARAPET_M
        # The tallest thing on campus is the Sciences Library at ~14 storeys.
        assert max(r.height_m for r in rows) == pytest.approx(
            MAX_FLOORS * METRES_PER_FLOOR + PARAPET_M
        )
        # And the massing must actually vary — a uniform fallback is the bug
        # this whole module exists to fix.
        assert len({r.floors for r in rows}) >= 8
