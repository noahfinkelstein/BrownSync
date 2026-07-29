"""Merge the curated catalog with recorded OSM footprints into PlaceRows."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

from brownsync_ingest.contract import PlaceRow
from brownsync_ingest.gazetteer.aliases import DEFAULT_ALIASES_PATH, load_curated_catalog
from brownsync_ingest.gazetteer.models import (
    CuratedCatalog,
    CuratedPlace,
    OsmBuilding,
    PlaceDiagnostic,
)
from brownsync_ingest.gazetteer.overpass import index_buildings, load_overpass_elements
from brownsync_ingest.policy import (
    validate_coordinates,
    validate_multipolygon_wkt,
    validate_slug,
)


DEFAULT_OVERPASS_PATH = (
    Path(__file__).resolve().parents[2]
    / "fixtures"
    / "recorded"
    / "overpass"
    / "college-hill-buildings.json"
)


@dataclass
class CatalogBuild:
    """The validated gazetteer output plus its build diagnostics."""

    rows: list[PlaceRow] = field(default_factory=list)
    diagnostics: list[PlaceDiagnostic] = field(default_factory=list)
    attribution: str = ""


def _coordinates(
    place: CuratedPlace, building: OsmBuilding | None
) -> tuple[float, float] | None:
    if building is not None:
        if building.centroid is not None:
            return building.centroid
        if building.fallback_center is not None:
            return building.fallback_center
    if place.lat is not None and place.lng is not None:
        return (place.lat, place.lng)
    return None


def build_catalog(
    catalog: CuratedCatalog, buildings: Mapping[str, OsmBuilding]
) -> CatalogBuild:
    """Merge curated identity/kind with OSM geometry, address, and provenance."""
    build = CatalogBuild(attribution=catalog.attribution)
    for place in catalog.places:
        building = buildings.get(place.osm_name or place.name)
        if building is not None and building.geometry_error is not None:
            build.diagnostics.append(
                PlaceDiagnostic(
                    place_id=place.id,
                    reason=f"invalid OSM geometry for {building.osm_id}: {building.geometry_error}",
                )
            )
        coordinates = _coordinates(place, building)
        if coordinates is None:
            build.diagnostics.append(
                PlaceDiagnostic(
                    place_id=place.id,
                    reason="no usable coordinates (no OSM centroid, bounds, or curated lat/lng)",
                    dropped=True,
                )
            )
            continue
        lat, lng = coordinates
        row = PlaceRow(
            id=validate_slug(place.id),
            name=place.name,
            aliases=list(place.aliases),
            kind=place.kind,
            lat=lat,
            lng=lng,
            polygon=validate_multipolygon_wkt(building.wkt) if building else None,
            address=building.address if building else None,
            osm_id=building.osm_id if building else None,
            source="osm" if building else "curated",
        )
        validate_coordinates(row.lat, row.lng)
        build.rows.append(row)
    build.rows.sort(key=lambda row: row.id)
    return build


def build_catalog_from_files(
    aliases_path: Path | None = None, overpass_path: Path | None = None
) -> CatalogBuild:
    """Build the gazetteer from aliases.yaml plus the recorded Overpass fixture."""
    catalog = load_curated_catalog(aliases_path or DEFAULT_ALIASES_PATH)
    buildings = index_buildings(
        load_overpass_elements(overpass_path or DEFAULT_OVERPASS_PATH)
    )
    return build_catalog(catalog, buildings)
