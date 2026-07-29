"""Gazetteer-internal value objects (never written to seed files directly)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class OsmBuilding:
    """A named OSM building footprint extracted from recorded Overpass data."""

    osm_type: str
    osm_id: str
    name: str
    tags: dict[str, str]
    wkt: str | None
    centroid: tuple[float, float] | None  # (lat, lng)
    fallback_center: tuple[float, float] | None  # (lat, lng) from element bounds
    address: str | None
    geometry_error: str | None


@dataclass(frozen=True)
class CuratedPlace:
    """One curated catalog entry from aliases.yaml."""

    id: str
    name: str
    kind: str
    aliases: tuple[str, ...]
    osm_name: str | None
    lat: float | None
    lng: float | None


@dataclass(frozen=True)
class CuratedCatalog:
    """The validated curated catalog."""

    places: tuple[CuratedPlace, ...]
    attribution: str


@dataclass(frozen=True)
class PlaceDiagnostic:
    """Why a curated place lost geometry or was dropped entirely."""

    place_id: str
    reason: str
    dropped: bool = field(default=False)
