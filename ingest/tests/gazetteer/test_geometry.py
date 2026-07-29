from __future__ import annotations

import math

import pytest

from brownsync_ingest.gazetteer.geometry import (
    GeometryError,
    assemble_multipolygon,
    close_ring,
    multipolygon_centroid,
    multipolygon_wkt,
    parse_multipolygon_wkt,
    stitch_rings,
)
from brownsync_ingest.policy import validate_multipolygon_wkt


SQUARE = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)]


def square(x0: float, y0: float, x1: float, y1: float) -> list[tuple[float, float]]:
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]


class TestCloseRing:
    def test_accepts_an_already_closed_ring(self) -> None:
        assert close_ring(SQUARE) == SQUARE

    def test_rejects_an_open_ring_instead_of_silently_closing_it(self) -> None:
        with pytest.raises(GeometryError, match="closed"):
            close_ring(SQUARE[:-1])

    def test_rejects_a_closed_ring_with_fewer_than_four_points(self) -> None:
        with pytest.raises(GeometryError, match="at least"):
            close_ring([(0.0, 0.0), (1.0, 1.0), (0.0, 0.0)])

    def test_rejects_non_finite_coordinates(self) -> None:
        bad = [(0.0, 0.0), (1.0, 0.0), (1.0, math.inf), (0.0, 1.0), (0.0, 0.0)]
        with pytest.raises(GeometryError, match="finite"):
            close_ring(bad)


class TestStitchRings:
    def test_passes_already_closed_fragments_through(self) -> None:
        assert stitch_rings([SQUARE]) == [SQUARE]

    def test_stitches_two_open_fragments_end_to_end(self) -> None:
        first = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)]
        second = [(1.0, 1.0), (0.0, 1.0), (0.0, 0.0)]
        [ring] = stitch_rings([first, second])
        assert ring[0] == ring[-1]
        assert set(ring) == set(SQUARE)
        assert len(ring) == 5

    def test_stitches_fragments_recorded_in_the_opposite_orientation(self) -> None:
        first = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)]
        reversed_second = [(0.0, 0.0), (0.0, 1.0), (1.0, 1.0)]
        [ring] = stitch_rings([first, reversed_second])
        assert ring[0] == ring[-1]
        assert set(ring) == set(SQUARE)

    def test_stitches_three_fragments_and_keeps_separate_closed_rings(self) -> None:
        far = square(10.0, 10.0, 11.0, 11.0)
        parts = [
            [(0.0, 0.0), (1.0, 0.0)],
            [(1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
            [(0.0, 1.0), (0.0, 0.0)],
            far,
        ]
        rings = stitch_rings(parts)
        assert len(rings) == 2
        assert far in rings

    def test_unstitchable_leftover_fragments_raise(self) -> None:
        with pytest.raises(GeometryError, match="stitch"):
            stitch_rings([[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)]])

    def test_disjoint_open_fragments_raise(self) -> None:
        with pytest.raises(GeometryError, match="stitch"):
            stitch_rings(
                [
                    [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)],
                    [(5.0, 5.0), (6.0, 5.0), (6.0, 6.0)],
                ]
            )


class TestAssembleMultipolygon:
    def test_single_outer_becomes_a_single_polygon(self) -> None:
        assert assemble_multipolygon([SQUARE], []) == [(SQUARE, [])]

    def test_hole_is_assigned_to_its_unique_containing_outer(self) -> None:
        outer_a = square(0.0, 0.0, 4.0, 4.0)
        outer_b = square(10.0, 10.0, 14.0, 14.0)
        hole_in_b = square(11.0, 11.0, 12.0, 12.0)
        assembled = assemble_multipolygon([outer_a, outer_b], [hole_in_b])
        assert assembled == [(outer_a, []), (outer_b, [hole_in_b])]

    def test_multiple_outers_each_become_polygon_parts(self) -> None:
        outer_a = square(0.0, 0.0, 1.0, 1.0)
        outer_b = square(2.0, 2.0, 3.0, 3.0)
        assert assemble_multipolygon([outer_a, outer_b], []) == [(outer_a, []), (outer_b, [])]

    def test_hole_outside_every_outer_raises(self) -> None:
        with pytest.raises(GeometryError, match="hole"):
            assemble_multipolygon([SQUARE], [square(5.0, 5.0, 6.0, 6.0)])

    def test_no_outer_at_all_raises(self) -> None:
        with pytest.raises(GeometryError, match="outer"):
            assemble_multipolygon([], [])

    def test_self_intersecting_outer_raises(self) -> None:
        bowtie = [(0.0, 0.0), (2.0, 2.0), (2.0, 0.0), (0.0, 2.0), (0.0, 0.0)]
        with pytest.raises(GeometryError, match="invalid|intersect"):
            assemble_multipolygon([bowtie], [])

    def test_zero_area_collinear_ring_raises(self) -> None:
        collinear = [(0.0, 0.0), (1.0, 1.0), (2.0, 2.0), (0.0, 0.0)]
        with pytest.raises(GeometryError, match="area"):
            assemble_multipolygon([collinear], [])

    def test_open_ring_input_raises(self) -> None:
        with pytest.raises(GeometryError, match="closed"):
            assemble_multipolygon([SQUARE[:-1]], [])


class TestWkt:
    def test_emits_lng_lat_axis_order(self) -> None:
        ring = square(10.0, 20.0, 11.0, 21.0)  # lng in 10..11, lat in 20..21
        wkt = multipolygon_wkt([(ring, [])])
        assert wkt.startswith("MULTIPOLYGON(((10 20, ")
        assert "20 10" not in wkt

    def test_wkt_satisfies_the_ingestion_policy_check(self) -> None:
        outer = square(-71.404, 41.826, -71.402, 41.827)
        hole = square(-71.4035, 41.8263, -71.4030, 41.8266)
        wkt = multipolygon_wkt(assemble_multipolygon([outer], [hole]))
        assert validate_multipolygon_wkt(wkt) == wkt

    def test_wkt_round_trips_through_parse(self) -> None:
        outer_a = square(0.0, 0.0, 4.0, 4.0)
        hole_a = square(1.0, 1.0, 2.0, 2.0)
        outer_b = square(10.5, -3.25, 11.5, -2.25)
        polygons = assemble_multipolygon([outer_a, outer_b], [hole_a])
        wkt = multipolygon_wkt(polygons)
        assert parse_multipolygon_wkt(wkt) == polygons

    def test_parse_preserves_float_precision(self) -> None:
        ring = square(-71.4028328, 41.8260884, -71.4023077, 41.8263052)
        [(parsed, holes)] = parse_multipolygon_wkt(multipolygon_wkt([(ring, [])]))
        assert parsed == ring
        assert holes == []

    @pytest.mark.parametrize(
        "bad",
        [
            "",
            "POLYGON((0 0, 1 0, 1 1, 0 0))",
            "MULTIPOLYGON()",
            "MULTIPOLYGON EMPTY",
            "MULTIPOLYGON(((0 0, 1 0, 1 1, 0 1)))",  # unclosed ring
            "MULTIPOLYGON(((0 0, 1 0, 0 0)))",  # too few points
            "MULTIPOLYGON(((0 0, 1 0, 1 1, 0 0))",  # unbalanced
            "MULTIPOLYGON(((0 0, 1 0, 1 1, 0 0))) trailing",
        ],
    )
    def test_parse_rejects_malformed_wkt(self, bad: str) -> None:
        with pytest.raises(GeometryError):
            parse_multipolygon_wkt(bad)


class TestCentroid:
    def test_returns_lat_lng_order(self) -> None:
        ring = square(10.0, 20.0, 11.0, 21.0)  # lng 10..11, lat 20..21
        assert multipolygon_centroid(multipolygon_wkt([(ring, [])])) == (20.5, 10.5)

    def test_is_area_weighted_across_multiple_outers(self) -> None:
        small = square(0.0, 0.0, 1.0, 1.0)  # area 1, centroid (0.5, 0.5)
        large = square(2.0, 2.0, 4.0, 4.0)  # area 4, centroid (3, 3)
        wkt = multipolygon_wkt([(small, []), (large, [])])
        lat, lng = multipolygon_centroid(wkt)
        assert lat == pytest.approx(2.5)
        assert lng == pytest.approx(2.5)

    def test_holes_subtract_from_the_centroid(self) -> None:
        outer = square(0.0, 0.0, 4.0, 4.0)  # area 16, centroid (2, 2)
        hole = square(0.5, 0.5, 2.5, 2.5)  # area 4, centroid (1.5, 1.5)
        wkt = multipolygon_wkt(assemble_multipolygon([outer], [hole]))
        lat, lng = multipolygon_centroid(wkt)
        assert lat == pytest.approx(26.0 / 12.0)
        assert lng == pytest.approx(26.0 / 12.0)

    def test_rejects_malformed_wkt(self) -> None:
        with pytest.raises(GeometryError):
            multipolygon_centroid("MULTIPOLYGON EMPTY")
