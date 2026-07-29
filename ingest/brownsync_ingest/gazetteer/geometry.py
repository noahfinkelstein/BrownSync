"""Ring assembly and plain MULTIPOLYGON WKT for OSM building footprints.

Coordinates are ``(lng, lat)`` tuples throughout, matching WKT axis order.
Only :func:`multipolygon_centroid` speaks ``(lat, lng)``, matching the
contract's ``lat``/``lng`` columns.
"""

from __future__ import annotations

import math
import re
from typing import Sequence

from shapely.geometry import MultiPoint, MultiPolygon, Polygon


Coordinate = tuple[float, float]
Ring = list[Coordinate]
PolygonRings = tuple[Ring, list[Ring]]


class GeometryError(ValueError):
    """A footprint cannot be represented as a valid MultiPolygon."""


def close_ring(points: Sequence[Coordinate]) -> Ring:
    """Validate an already-closed ring; never close an open one silently."""
    ring = [(float(lng), float(lat)) for lng, lat in points]
    if any(not math.isfinite(component) for point in ring for component in point):
        raise GeometryError("ring coordinates must be finite")
    if len(ring) < 4:
        raise GeometryError("a closed ring needs at least 4 points")
    if ring[0] != ring[-1]:
        raise GeometryError("ring is not closed (first point must equal last)")
    return ring


def stitch_rings(fragments: Sequence[Sequence[Coordinate]]) -> list[Ring]:
    """Join way fragments end-to-end (either orientation) into closed rings."""
    open_fragments: list[list[Coordinate]] = []
    rings: list[Ring] = []
    for fragment in fragments:
        points = [(float(lng), float(lat)) for lng, lat in fragment]
        if len(points) >= 4 and points[0] == points[-1]:
            rings.append(close_ring(points))
        elif len(points) >= 2:
            open_fragments.append(points)
        else:
            raise GeometryError("cannot stitch a fragment with fewer than 2 points")
    while open_fragments:
        current = open_fragments.pop(0)
        while current[0] != current[-1]:
            for index, candidate in enumerate(open_fragments):
                if candidate[0] == current[-1]:
                    current += candidate[1:]
                elif candidate[-1] == current[-1]:
                    current += list(reversed(candidate))[1:]
                else:
                    continue
                del open_fragments[index]
                break
            else:
                raise GeometryError("cannot stitch fragments into a closed ring")
        rings.append(close_ring(current))
    return rings


def _ring_polygon(ring: Sequence[Coordinate]) -> Polygon:
    closed = close_ring(ring)
    if MultiPoint(closed).convex_hull.area == 0:
        raise GeometryError("ring encloses zero area (collinear points)")
    polygon = Polygon(closed)
    if not polygon.is_valid:
        raise GeometryError("ring produces an invalid (e.g. self-intersecting) polygon")
    if polygon.area == 0:
        raise GeometryError("ring encloses zero area")
    return polygon


def assemble_multipolygon(
    outers: Sequence[Sequence[Coordinate]],
    inners: Sequence[Sequence[Coordinate]],
) -> list[PolygonRings]:
    """Assign each hole to its unique containing outer ring."""
    if not outers:
        raise GeometryError("a multipolygon needs at least one outer ring")
    outer_rings = [close_ring(outer) for outer in outers]
    outer_polygons = [_ring_polygon(ring) for ring in outer_rings]
    holes: list[list[Ring]] = [[] for _ in outer_rings]
    for inner in inners:
        inner_ring = close_ring(inner)
        inner_polygon = _ring_polygon(inner_ring)
        containers = [
            index
            for index, outer_polygon in enumerate(outer_polygons)
            if outer_polygon.covers(inner_polygon)
        ]
        if len(containers) != 1:
            raise GeometryError(
                "hole is not contained by exactly one outer ring"
                f" (contained by {len(containers)})"
            )
        holes[containers[0]].append(inner_ring)
    polygons = [(ring, ring_holes) for ring, ring_holes in zip(outer_rings, holes)]
    for outer_ring, ring_holes in polygons:
        shaped = Polygon(outer_ring, ring_holes)
        if not shaped.is_valid:
            raise GeometryError("holes make the polygon invalid")
    return polygons


def _format_number(value: float) -> str:
    if value.is_integer():
        return str(int(value))
    return repr(value)


def _format_ring(ring: Ring) -> str:
    return "(" + ", ".join(f"{_format_number(lng)} {_format_number(lat)}" for lng, lat in ring) + ")"


def multipolygon_wkt(polygons: Sequence[PolygonRings]) -> str:
    """Emit plain ``MULTIPOLYGON(...)`` WKT in ``lng lat`` axis order."""
    if not polygons:
        raise GeometryError("cannot emit WKT for an empty multipolygon")
    parts = []
    for outer, holes in polygons:
        rings = [_format_ring(close_ring(outer))] + [_format_ring(close_ring(hole)) for hole in holes]
        parts.append("(" + ", ".join(rings) + ")")
    return "MULTIPOLYGON(" + ", ".join(parts) + ")"


_WKT_SHAPE = re.compile(
    r"MULTIPOLYGON\s*\(\s*(?P<body>\(\s*\([^()]*\)(?:\s*,\s*\([^()]*\))*\s*\)"
    r"(?:\s*,\s*\(\s*\([^()]*\)(?:\s*,\s*\([^()]*\))*\s*\))*)\s*\)\Z"
)
_POLYGON_GROUP = re.compile(r"\(\s*(\([^()]*\)(?:\s*,\s*\([^()]*\))*)\s*\)")
_RING_GROUP = re.compile(r"\(([^()]*)\)")


def parse_multipolygon_wkt(wkt: str) -> list[PolygonRings]:
    """Parse the plain MULTIPOLYGON WKT emitted by :func:`multipolygon_wkt`."""
    match = _WKT_SHAPE.fullmatch(wkt.strip())
    if match is None:
        raise GeometryError("not a plain MULTIPOLYGON(...) WKT string")
    polygons: list[PolygonRings] = []
    for polygon_match in _POLYGON_GROUP.finditer(match.group("body")):
        rings: list[Ring] = []
        for ring_match in _RING_GROUP.finditer(polygon_match.group(1)):
            coordinates: Ring = []
            for pair in ring_match.group(1).split(","):
                components = pair.split()
                if len(components) != 2:
                    raise GeometryError("each WKT coordinate must be 'lng lat'")
                try:
                    coordinates.append((float(components[0]), float(components[1])))
                except ValueError as error:
                    raise GeometryError("WKT coordinates must be numeric") from error
            rings.append(close_ring(coordinates))
        polygons.append((rings[0], rings[1:]))
    return polygons


def multipolygon_centroid(wkt: str) -> tuple[float, float]:
    """Area-weighted centroid of the WKT (holes subtract), as ``(lat, lng)``."""
    polygons = parse_multipolygon_wkt(wkt)
    shape = MultiPolygon([Polygon(outer, holes) for outer, holes in polygons])
    if shape.area == 0:
        raise GeometryError("cannot take the centroid of a zero-area multipolygon")
    centroid = shape.centroid
    return (centroid.y, centroid.x)
