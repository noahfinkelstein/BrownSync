"""Brown Facilities ArcGIS ``Active_Buildings_2_view`` → normalized buildings.

Endpoint (public, unauthenticated, ``access-control-allow-origin: *``)::

    https://services1.arcgis.com/HMLBxPKXzqtpFXfq/arcgis/rest/services
        /Active_Buildings_2_view/FeatureServer/0/query
        ?where=1=1&outFields=*&returnGeometry=true&f=geojson

Verified 2026-07-29: 263 features in a single page (``maxRecordCount`` is 2000
and ``exceededTransferLimit`` is absent), so there is no pagination loop.

**The service's native SR is wkid 102730 (RI State Plane feet).** ``f=geojson``
returns EPSG:4326; a plain ``f=json`` request without ``outSR=4326`` returns
state-plane coordinates that look superficially plausible and are wrong by
thousands of kilometres. Always ask for GeoJSON here.

This module is deliberately **offline by default**: it reads the recorded
fixture at ``ingest/fixtures/recorded/arcgis/active-buildings.geojson``. Brown's
ArcGIS is a third party with no SLA, so it is touched once by a human-run
capture, hash-pinned in ``ingest/fixtures/manifest.json``, and the published
artifact is committed. CI never reaches the network, and the map keeps working
if Brown retires the service.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from brownsync_ingest.campus.aliases_parse import ResolvedLabel, parse_aliases, resolve_label
from brownsync_ingest.campus.height import HeightEstimate, estimate_height


ARCGIS_SERVICE = (
    "https://services1.arcgis.com/HMLBxPKXzqtpFXfq/arcgis/rest/services"
    "/Active_Buildings_2_view/FeatureServer/0"
)
ARCGIS_QUERY = "/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson"

DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "fixtures"
    / "recorded"
    / "arcgis"
    / "active-buildings.geojson"
)

#: Attribution carried on every published artifact. The service publishes no
#: licence text of its own (checked 2026-07-29); crediting the source is the
#: same discipline the OSM/ODbL sidecars already follow, and the licence
#: question is tracked as gate G5 in BROWNSYNC_V2_PLAN.md.
ATTRIBUTION = (
    "Building footprints, names and attributes © Brown University Facilities "
    "Management, via the public ArcGIS Active_Buildings_2_view feature service."
)

#: ``Ownership_Status`` values excluded from the campus layer. Note the source
#: misspells "Affiliated" as "Affilliated" — matching the real value matters.
EXCLUDED_OWNERSHIP = frozenset({"Sold"})

#: ``Current_Use`` → contract §1 ``places.kind``. Unmapped uses fall to "other";
#: this only ever assigns a kind to buildings the gazetteer does not already
#: curate (see conflate.py — curated kinds always win).
USE_TO_KIND: dict[str, str] = {
    "Dormitory": "residence",
    "Library": "library",
    "Office": "admin",
    "Classroom": "academic",
    "Classroom/Office": "academic",
    "School": "academic",
    "School/Lab": "academic",
    "Lab": "academic",
    "Medical Research": "academic",
    "Research": "academic",
    "Dining": "dining",
    "Athletic": "athletic",
    "Athletics": "athletic",
}

#: A ``Year_of_Construction`` of 0 is the source's "unknown" sentinel — 38 of
#: 263 rows carry it. Treated as missing, never as the year 0.
YEAR_UNKNOWN = 0

#: Decimal places kept on published coordinates. 6 dp is ~11 cm at this
#: latitude, far finer than a building footprint is surveyed to, and it takes
#: the artifact from 132 kB gz to 58 kB gz across 8,903 vertices.
COORD_PRECISION = 6


def round_geometry(geometry: Mapping[str, Any], precision: int = COORD_PRECISION) -> dict[str, Any]:
    """Round a (Multi)Polygon's coordinates for publication."""

    def walk(node: Any) -> Any:
        if node and isinstance(node[0], (int, float)):
            return [round(node[0], precision), round(node[1], precision)]
        return [walk(child) for child in node]

    return {"type": geometry["type"], "coordinates": walk(geometry["coordinates"])}


@dataclass(frozen=True)
class CampusBuilding:
    """One normalized Brown building, ready for conflation and rendering."""

    property_code: str
    label: str
    aliases: tuple[str, ...]
    kind: str
    lat: float
    lng: float
    geometry: dict[str, Any]
    height_m: float
    floors: int
    height_source: str
    year_built: int | None
    address: str | None
    ownership: str | None
    current_use: str | None
    building_type: str | None
    gross_area: float | None
    footprint_area: float | None
    official_name: str | None
    complex_name: str | None
    label_rung: int
    label_rule: str
    diagnostics: tuple[str, ...] = ()


def load_arcgis_geojson(path: Path | str | None = None) -> dict[str, Any]:
    """Load the recorded GeoJSON FeatureCollection."""
    source = Path(path) if path else DEFAULT_FIXTURE
    with source.open(encoding="utf-8") as handle:
        document = json.load(handle)
    if document.get("type") != "FeatureCollection":
        raise ValueError(f"{source}: expected a FeatureCollection, got {document.get('type')!r}")
    return document


def _ring_centroid(geometry: Mapping[str, Any]) -> tuple[float, float]:
    """Area-weighted centroid of a (Multi)Polygon's outer rings.

    Implemented directly rather than via shapely so this module stays usable in
    the CLI's import path without a geometry dependency; the shoelace formula
    over exterior rings is exact for the planar case and campus-scale error
    from ignoring the ellipsoid is far below a metre.
    """
    kind = geometry.get("type")
    if kind == "Polygon":
        rings: Sequence[Any] = [geometry["coordinates"][0]]
    elif kind == "MultiPolygon":
        rings = [polygon[0] for polygon in geometry["coordinates"]]
    else:
        raise ValueError(f"unsupported geometry type {kind!r}")

    # TWO numerical hazards here, both hit by real data. Do not "simplify" this.
    #
    # 1. TRANSLATE TO A LOCAL ORIGIN FIRST. The shoelace term `x0*y1 - x1*y0`
    #    subtracts two values of magnitude ~2966 (71.4 x 41.8) that differ by
    #    the polygon's area. Doubles carry ~1e-16 relative precision, so at that
    #    magnitude the absolute error is ~1e-12 — and a real athletic field in
    #    this layer is a sliver of area 2.3e-12 deg^2. The computed area was
    #    entirely rounding noise. Subtracting a nearby origin makes the operands
    #    ~1e-6, restoring full relative precision.
    #
    # 2. WEIGHT BY THE MAGNITUDE OF EACH RING'S AREA, not its signed area.
    #    GeoJSON guarantees no winding order, so two parts wound opposite ways
    #    make the summed signed area approach zero while the numerators do not
    #    cancel, and the centroid diverges.
    #
    # Together these turned a centroid of 42.58 N, -72.68 E (about 80 km off
    # campus) into the correct 41.830 N, -71.394 E.
    origin_x, origin_y = rings[0][0]

    total_weight = 0.0
    cx = 0.0
    cy = 0.0
    for ring in rings:
        cross_sum = 0.0
        rx = 0.0
        ry = 0.0
        for (px0, py0), (px1, py1) in zip(ring, ring[1:]):
            x0, y0 = px0 - origin_x, py0 - origin_y
            x1, y1 = px1 - origin_x, py1 - origin_y
            cross = x0 * y1 - x1 * y0
            cross_sum += cross
            rx += (x0 + x1) * cross
            ry += (y0 + y1) * cross
        area = cross_sum * 0.5
        if area == 0.0:
            continue
        weight = abs(area)
        total_weight += weight
        cx += weight * (rx / (6.0 * area))
        cy += weight * (ry / (6.0 * area))

    if total_weight == 0.0:
        # Every ring degenerate (a zero-area sliver) — the mean vertex is the
        # only meaningful answer, and for a sliver it is a good one.
        points = [pt for ring in rings for pt in ring]
        return (
            sum(p[1] for p in points) / len(points),
            sum(p[0] for p in points) / len(points),
        )
    return (cy / total_weight + origin_y, cx / total_weight + origin_x)


def geometry_to_multipolygon_wkt(geometry: Mapping[str, Any]) -> str:
    """GeoJSON (Multi)Polygon → WKT MULTIPOLYGON for ``places.polygon``.

    The layer returns ``Polygon`` for every feature, but ``places.polygon`` is
    ``geometry(MultiPolygon, 4326)``, so single polygons are wrapped.
    """
    kind = geometry.get("type")
    if kind == "Polygon":
        polygons = [geometry["coordinates"]]
    elif kind == "MultiPolygon":
        polygons = geometry["coordinates"]
    else:
        raise ValueError(f"unsupported geometry type {kind!r}")

    def ring(coords: Iterable[Sequence[float]]) -> str:
        pts = [f"{x:.7f} {y:.7f}" for x, y in coords]
        if pts and pts[0] != pts[-1]:
            pts.append(pts[0])
        return "(" + ", ".join(pts) + ")"

    body = ", ".join("(" + ", ".join(ring(r) for r in poly) + ")" for poly in polygons)
    return f"MULTIPOLYGON ({body})"


def normalize_features(
    document: Mapping[str, Any],
    *,
    osm_levels: Mapping[str, int] | None = None,
) -> tuple[tuple[CampusBuilding, ...], tuple[str, ...]]:
    """FeatureCollection → normalized buildings + collected diagnostics."""
    buildings: list[CampusBuilding] = []
    diagnostics: list[str] = []
    seen: set[str] = set()

    for feature in document.get("features", []):
        props = feature.get("properties") or {}
        geometry = feature.get("geometry")
        code = (props.get("Property_Code") or "").strip()

        if not code:
            diagnostics.append(f"skipped a feature with no Property_Code: {props.get('Property_Name')!r}")
            continue
        if code in seen:
            # promoteId requires uniqueness; a duplicate would make
            # setFeatureState silently target the wrong building.
            raise ValueError(f"duplicate Property_Code {code!r} — promoteId requires uniqueness")
        if geometry is None:
            diagnostics.append(f"{code}: no geometry, skipped")
            continue

        ownership = (props.get("Ownership_Status") or "").strip() or None
        if ownership in EXCLUDED_OWNERSHIP:
            diagnostics.append(f"{code}: excluded, Ownership_Status={ownership!r}")
            continue

        seen.add(code)
        parsed = parse_aliases(props.get("Aliases"))
        resolved: ResolvedLabel = resolve_label(
            property_code=code,
            property_name=props.get("Property_Name"),
            official_name=props.get("Official_Name"),
            address_line_1=props.get("Address_Line_1"),
            property_abbr=props.get("Property_Abbr"),
            parsed=parsed,
        )

        year_raw = props.get("Year_of_Construction")
        year = int(year_raw) if year_raw and int(year_raw) != YEAR_UNKNOWN else None

        gross = _as_float(props.get("Gross_area__Property_"))
        footprint = _as_float(props.get("Shape__Area"))
        height: HeightEstimate = estimate_height(
            gross_area=gross,
            footprint_area=footprint,
            osm_levels=(osm_levels or {}).get(code),
        )

        lat, lng = _ring_centroid(geometry)
        geometry = round_geometry(geometry)
        current_use = (props.get("Current_Use") or "").strip() or None

        row_diagnostics = tuple(
            f"{code}: {message}" for message in (*resolved.diagnostics, *height.diagnostics)
        )
        diagnostics.extend(row_diagnostics)

        buildings.append(
            CampusBuilding(
                property_code=code,
                label=resolved.label,
                aliases=resolved.aliases,
                kind=USE_TO_KIND.get(current_use or "", "other"),
                lat=lat,
                lng=lng,
                geometry=geometry,
                height_m=height.height_m,
                floors=height.floors,
                height_source=height.source,
                year_built=year,
                address=(props.get("Address_Line_1") or "").strip() or None,
                ownership=ownership,
                current_use=current_use,
                building_type=(props.get("Building_Type") or "").strip() or None,
                gross_area=gross,
                footprint_area=footprint,
                official_name=(props.get("Official_Name") or "").strip() or None,
                complex_name=resolved.complex_name,
                label_rung=resolved.rung,
                label_rule=resolved.rule,
                diagnostics=row_diagnostics,
            )
        )

    buildings.sort(key=lambda b: b.property_code)
    return tuple(buildings), tuple(diagnostics)


def _as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result and result not in (float("inf"), float("-inf")) else None
