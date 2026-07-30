"""Adapter from recorded Overpass JSON to named building footprints."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Mapping

from brownsync_ingest.gazetteer.geometry import (
    GeometryError,
    close_ring,
    assemble_multipolygon,
    multipolygon_centroid,
    multipolygon_wkt,
    stitch_rings,
)
from brownsync_ingest.gazetteer.models import OsmBuilding


_ADDRESS_SEGMENTS = (("addr:housenumber", "addr:street"), ("addr:city",), ("addr:state", "addr:postcode"))


def load_overpass_elements(path: Path) -> list[dict]:
    """Load the raw ``elements`` array from an Overpass JSON response."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    elements = payload.get("elements")
    if not isinstance(elements, list):
        raise ValueError("Overpass payload has no elements array")
    return elements


def _points(geometry: object) -> list[tuple[float, float]]:
    if not isinstance(geometry, list) or not geometry:
        raise GeometryError("element has no geometry array")
    return [(float(point["lon"]), float(point["lat"])) for point in geometry]


def _way_wkt(element: Mapping) -> str:
    ring = close_ring(_points(element.get("geometry")))
    return multipolygon_wkt(assemble_multipolygon([ring], []))


def _relation_wkt(element: Mapping) -> str:
    members = element.get("members")
    if not isinstance(members, list):
        raise GeometryError("relation has no members array")
    outer_fragments: list[list[tuple[float, float]]] = []
    inner_fragments: list[list[tuple[float, float]]] = []
    for member in members:
        if member.get("type") != "way":
            continue
        role = member.get("role")
        if role in ("outer", ""):
            outer_fragments.append(_points(member.get("geometry")))
        elif role == "inner":
            inner_fragments.append(_points(member.get("geometry")))
    outers = stitch_rings(outer_fragments) if outer_fragments else []
    inners = stitch_rings(inner_fragments) if inner_fragments else []
    return multipolygon_wkt(assemble_multipolygon(outers, inners))


def _fallback_center(element: Mapping) -> tuple[float, float] | None:
    bounds = element.get("bounds")
    if not isinstance(bounds, Mapping):
        return None
    try:
        return (
            (float(bounds["minlat"]) + float(bounds["maxlat"])) / 2,
            (float(bounds["minlon"]) + float(bounds["maxlon"])) / 2,
        )
    except (KeyError, TypeError, ValueError):
        return None


def _address(tags: Mapping[str, str]) -> str | None:
    segments = []
    for keys in _ADDRESS_SEGMENTS:
        parts = [tags[key] for key in keys if tags.get(key)]
        if parts:
            segments.append(" ".join(parts))
    return ", ".join(segments) if segments else None


def index_buildings(elements: Iterable[Mapping]) -> dict[str, OsmBuilding]:
    """Index way/relation footprints by exact OSM name (first wins).

    Unnamed footprints carrying both ``addr:housenumber`` and ``addr:street``
    are indexed under the fallback key ``addr:{housenumber} {street}`` (also
    first wins) so curated entries can claim address-only buildings via an
    explicit ``osm:`` reference; the prefix keeps the two key namespaces
    disjoint. Unnamed footprints without a full address are skipped.
    """
    buildings: dict[str, OsmBuilding] = {}
    for element in elements:
        element_type = element.get("type")
        if element_type not in ("way", "relation"):
            continue
        tags = element.get("tags") or {}
        name = tags.get("name")
        if not name:
            housenumber = tags.get("addr:housenumber")
            street = tags.get("addr:street")
            if not housenumber or not street:
                continue
            name = f"addr:{housenumber} {street}"
        if name in buildings:
            continue
        wkt: str | None = None
        centroid: tuple[float, float] | None = None
        geometry_error: str | None = None
        try:
            wkt = _way_wkt(element) if element_type == "way" else _relation_wkt(element)
            centroid = multipolygon_centroid(wkt)
        except GeometryError as error:
            wkt = None
            centroid = None
            geometry_error = str(error)
        buildings[name] = OsmBuilding(
            osm_type=element_type,
            osm_id=f"{element_type}/{element.get('id')}",
            name=name,
            tags=dict(tags),
            wkt=wkt,
            centroid=centroid,
            fallback_center=_fallback_center(element),
            address=_address(tags),
            geometry_error=geometry_error,
        )
    return buildings
