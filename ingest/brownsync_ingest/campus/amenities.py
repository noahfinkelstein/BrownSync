"""Campus amenity points — the "where is the nearest X" layer.

Brown Facilities publishes ~80 public ArcGIS FeatureServer services. Eight
matter for a student-facing map, and they arrive in three different shapes:

1. **Standalone point layers.** ``BlueLightEmergencyPhone_view`` (158 phones)
   and ``BikeRacks_view`` (225 racks) are one row per physical thing.

2. **A flagged union table.** ``All_Building_Resources`` is 127 buildings with
   a boolean column *per amenity* — ``HydrationStation``, ``Printers``,
   ``MenstrualProducts``, ``LactationRooms``, ``Dining`` — each paired with a
   free-text ``…Text`` column describing where in the building it is. Brown
   also publishes ``Hydration_Station_view``, ``Printers_view`` and
   ``Menstrual_Products_view``, but those are *filtered views of this same
   table*. Reading the union once is why the per-kind counts here can never
   disagree with each other.

3. **A room-list table.** ``All_Restrooms_(Includes_Sub_Types)_VIEW`` is one
   row per building with pipe-delimited room numbers
   (``"114 | 116 | 201 | 301"``) split across all/single-sex/gender-inclusive/
   single-occupancy columns. It is keyed on ``Property_Code``, which is the
   same key ``campus_buildings.geojson`` uses — so restrooms join to footprints
   for free.

**AED and Narcan are one source, not two.** ``AED_NEW_view_for_base_map``
carries a ``narcan`` Y/N column; Brown also ships ``Narcan_2_view_esri_test``
and ``Narcan_2_view_for_base_map``. Those report 41 points where the AED
table flags 43. Two tables can disagree with each other; one cannot, so the
Narcan points are derived from the AED flag.

**Deliberately excluded**: ``elevator_locations_view`` (154 rows whose only
populated fields are ``Layer: "C-BLDG-ELEV"`` and ``Shape_Leng`` — no name, no
building, nothing to put in a popover) and ``EVChargers_view`` (4 rows whose
sole property is ``OBJECTID``).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import json
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "recorded" / "arcgis"

#: Coordinates are rounded to 6 dp (~11 cm) — the same precision the buildings
#: artifact uses, and the difference between a 300 KB and a 900 KB asset.
COORD_PRECISION = 6

#: Every amenity kind the artifact can contain. The web layer registry mirrors
#: this list; `test_amenities.py` asserts the two cannot drift.
AMENITY_KINDS: tuple[str, ...] = (
    "blue-light",
    "aed",
    "narcan",
    "restroom",
    "restroom-inclusive",
    "hydration",
    "printer",
    "menstrual",
    "lactation",
    "bike",
    "dining",
)


@dataclass(frozen=True)
class Amenity:
    """One mappable amenity point."""

    id: str
    kind: str
    lat: float
    lng: float
    label: str
    #: Where in the building, opening notes, rack type — whatever the source
    #: gives that a student would actually want. None when the source has none.
    detail: str | None = None
    #: Brown property code, when the source carries one. Joins to
    #: `campus_buildings.geojson`'s `propertyCode`.
    property_code: str | None = None
    #: Curated place ids inside the owning building. Resolved HERE rather than
    #: in the browser: the place page would otherwise have to fetch the 327 kB
    #: buildings artifact purely to learn that footprint 100116 contains
    #: `stonewall-house`.
    place_ids: tuple[str, ...] = ()


def load_layer(name: str, root: Path | None = None) -> dict[str, Any]:
    """Load a recorded ArcGIS FeatureCollection by stored filename."""
    source = (root or FIXTURES) / name
    with source.open(encoding="utf-8") as handle:
        document = json.load(handle)
    if document.get("type") != "FeatureCollection":
        raise ValueError(f"{source}: expected a FeatureCollection, got {document.get('type')!r}")
    return document


def _point(feature: Mapping[str, Any]) -> tuple[float, float] | None:
    """(lng, lat) from the geometry, falling back to Long/Lat columns.

    Several of these layers carry BOTH — and `Menstrual_Products_view` has rows
    where the geometry is null but the columns are populated, so the fallback
    is load-bearing rather than defensive.
    """
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates")
    if geometry.get("type") == "Point" and isinstance(coordinates, (list, tuple)):
        lng, lat = coordinates[0], coordinates[1]
        if _plausible(lng, lat):
            return float(lng), float(lat)
    properties = feature.get("properties") or {}
    lng, lat = properties.get("Long"), properties.get("Lat")
    if _plausible(lng, lat):
        return float(lng), float(lat)
    return None


def _plausible(lng: Any, lat: Any) -> bool:
    """Reject nulls, zeros and anything off College Hill.

    ArcGIS happily returns `[0, 0]` for a row whose geometry was never set;
    without this, Null Island lands in the artifact's bbox and the map's
    fitBounds flies to the Atlantic.
    """
    try:
        lng_f, lat_f = float(lng), float(lat)
    except (TypeError, ValueError):
        return False
    return -71.45 < lng_f < -71.37 and 41.75 < lat_f < 41.87


#: Longest `detail` we will publish. The AED descriptions run to 555
#: characters of turn-by-turn directions; a map popover is not a document.
MAX_DETAIL_CHARS = 240


def _text(value: Any) -> str | None:
    """Trimmed non-empty string, or None. ArcGIS uses "", " " and null."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _detail(value: Any) -> str | None:
    """Normalize a free-text column into one popover-sized line.

    110 of these carry literal CRLF (the AED directions are multi-paragraph),
    which renders as a run-on inside a single-line label and blows the
    artifact up with escape sequences.
    """
    text = _text(value)
    if text is None:
        return None
    collapsed = " ".join(text.split())
    if len(collapsed) <= MAX_DETAIL_CHARS:
        return collapsed
    # Cut on a word boundary so the ellipsis never lands mid-word.
    cut = collapsed[:MAX_DETAIL_CHARS].rsplit(" ", 1)[0]
    return f"{cut}…"


#: A resource-table `Name` is an internal asset code, not a display name —
#: "ANDREWHALL", "KQARCHBRON", "BENE026" — and 27 of the 127 rows have none at
#: all. Anything matching this shape is replaced by the nearest building's
#: resolved label; see `resolve_labels`.
#:
#: The no-space rule is load-bearing. An asset code is always ONE token; the
#: bike layer's `Brown_Description` is a shouty but genuine human string
#: ("BIKE RACK 2 DAVOL SQ 010"), and treating that as a code threw away the
#: only description those 225 points have.
def _is_asset_code(label: str) -> bool:
    return " " not in label and label.isupper() and label.isalnum() and len(label) >= 2


def _readable(label: str) -> str:
    """Soften an all-caps source string without mangling real acronyms."""
    if not label.isupper() or " " not in label:
        return label
    words = []
    for index, word in enumerate(label.split()):
        # Keep digits and short tokens (SQ, ST, KQ) as-is; title-case the rest.
        if index > 0 and (word.isdigit() or len(word) <= 2):
            words.append(word)
        else:
            words.append(word.capitalize())
    return " ".join(words)


def _code(value: Any) -> str | None:
    """Property codes arrive as ints in some layers and strings in others."""
    if value is None:
        return None
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    return text or None


def blue_light_amenities(document: Mapping[str, Any]) -> list[Amenity]:
    out: list[Amenity] = []
    for index, feature in enumerate(document.get("features") or []):
        position = _point(feature)
        if position is None:
            continue
        properties = feature.get("properties") or {}
        # `Exterior_Telephone_Location` is the human place name ("Brown Office
        # Building"); `Address` is the fallback for the ~dozen with no name.
        label = (
            _text(properties.get("Exterior_Telephone_Location"))
            or _text(properties.get("Address"))
            or "Blue-light phone"
        )
        details = []
        if _text(properties.get("Address")) and _text(
            properties.get("Exterior_Telephone_Location")
        ):
            details.append(str(_text(properties.get("Address"))))
        if str(properties.get("BLUE_Strobe") or "").upper() == "YES":
            details.append("strobe")
        if str(properties.get("Camera") or "").upper() == "YES":
            details.append("camera")
        out.append(
            Amenity(
                id=f"blue-light:{_text(properties.get('OBJECTID')) or index}",
                kind="blue-light",
                lng=position[0],
                lat=position[1],
                label=label,
                detail=" · ".join(details) or None,
                property_code=_code(properties.get("Building")),
            )
        )
    return out


def aed_amenities(document: Mapping[str, Any]) -> list[Amenity]:
    """AEDs, plus a Narcan point for every AED flagged as carrying it."""
    out: list[Amenity] = []
    for index, feature in enumerate(document.get("features") or []):
        position = _point(feature)
        if position is None:
            continue
        properties = feature.get("properties") or {}
        label = _text(properties.get("Name")) or "AED"
        identifier = _text(properties.get("OBJECTID")) or str(index)
        restricted = str(properties.get("restricted") or "").strip().lower() == "restricted"
        # `Descrip` is where the useful "inside the lobby, left of the desk"
        # text lives; PopupInfo is an HTML blob with a hosted image tag.
        detail = _detail(properties.get("Descrip"))
        if restricted:
            detail = f"Restricted access{f' · {detail}' if detail else ''}"
        out.append(
            Amenity(
                id=f"aed:{identifier}",
                kind="aed",
                lng=position[0],
                lat=position[1],
                label=label,
                detail=detail,
            )
        )
        if str(properties.get("narcan") or "").strip().upper().startswith("Y"):
            out.append(
                Amenity(
                    id=f"narcan:{identifier}",
                    kind="narcan",
                    lng=position[0],
                    lat=position[1],
                    label=label,
                    detail=detail,
                )
            )
    return out


#: Union-table column → amenity kind. The `…Text` sibling column supplies the
#: detail string, and its name is NOT derivable: the source misspells
#: "Menstrual" as `MestrualProductsText`.
RESOURCE_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("HydrationStation", "hydration", "HydrationStationText"),
    ("Printers", "printer", "PrintersText"),
    ("MenstrualProducts", "menstrual", "MestrualProductsText"),
    ("LactationRooms", "lactation", "LactationRoomsText"),
    ("Dining", "dining", "DiningText"),
)


def building_resource_amenities(document: Mapping[str, Any]) -> list[Amenity]:
    out: list[Amenity] = []
    for index, feature in enumerate(document.get("features") or []):
        position = _point(feature)
        if position is None:
            continue
        properties = feature.get("properties") or {}
        label = _text(properties.get("Name")) or _text(properties.get("ID")) or ""
        identifier = _text(properties.get("ID")) or _text(properties.get("OBJECTID")) or str(index)
        for column, kind, text_column in RESOURCE_COLUMNS:
            # The flag is 1 or null — never 0 — so a truthiness test is right,
            # but it must not treat the descriptive text as the flag.
            if properties.get(column) != 1:
                continue
            out.append(
                Amenity(
                    id=f"{kind}:{identifier}",
                    kind=kind,
                    lng=position[0],
                    lat=position[1],
                    label=label,
                    detail=_detail(properties.get(text_column)),
                )
            )
    return out


def _rooms(value: Any) -> list[str]:
    """Split a pipe-delimited room list: `"114 | 116 | 201"` → three rooms."""
    text = _text(value)
    if text is None:
        return []
    return [room for room in (part.strip() for part in text.split("|")) if room]


#: The BioMed Center lists 37 restrooms. Printing all of them produced a
#: 245-character popover — and because that string is COMPOSED here rather
#: than read from a column, it bypassed `_detail`'s length cap entirely.
MAX_LISTED_ROOMS = 8


def _room_list(rooms: Sequence[str]) -> str:
    if len(rooms) <= MAX_LISTED_ROOMS:
        return ", ".join(rooms)
    shown = ", ".join(rooms[:MAX_LISTED_ROOMS])
    return f"{shown} +{len(rooms) - MAX_LISTED_ROOMS} more"


def restroom_amenities(document: Mapping[str, Any]) -> list[Amenity]:
    """One point per building, per restroom category it actually has."""
    out: list[Amenity] = []
    for index, feature in enumerate(document.get("features") or []):
        position = _point(feature)
        if position is None:
            continue
        properties = feature.get("properties") or {}
        code = _code(properties.get("Property_Code"))
        identifier = code or _text(properties.get("FID")) or str(index)
        label = _text(properties.get("Property_Name")) or "Restrooms"

        all_rooms = _rooms(properties.get("AlL_Restrooms___vlookup"))
        inclusive = _rooms(properties.get("Gender_Inclusive___vlookup"))
        single = _rooms(properties.get("single_occupancy___vlookup"))

        if all_rooms:
            details = [f"{len(all_rooms)} restroom{'s' if len(all_rooms) != 1 else ''}"]
            if single:
                details.append(f"{len(single)} single-occupancy")
            details.append(f"Rooms {_room_list(all_rooms)}")
            out.append(
                Amenity(
                    id=f"restroom:{identifier}",
                    kind="restroom",
                    lng=position[0],
                    lat=position[1],
                    label=label,
                    detail=_detail(" · ".join(details)),
                    property_code=code,
                )
            )
        if inclusive:
            out.append(
                Amenity(
                    id=f"restroom-inclusive:{identifier}",
                    kind="restroom-inclusive",
                    lng=position[0],
                    lat=position[1],
                    label=label,
                    detail=_detail(f"Rooms {_room_list(inclusive)}"),
                    property_code=code,
                )
            )
    return out


def bike_amenities(document: Mapping[str, Any]) -> list[Amenity]:
    out: list[Amenity] = []
    for index, feature in enumerate(document.get("features") or []):
        position = _point(feature)
        if position is None:
            continue
        properties = feature.get("properties") or {}
        label = _readable(
            _text(properties.get("Brown_Description"))
            or _text(properties.get("Brown_Address_1"))
            or _text(properties.get("Street_Name"))
            or "Bike rack"
        )
        spaces = properties.get("Spaces_Total")
        details = []
        if isinstance(spaces, (int, float)) and spaces > 0:
            details.append(f"{int(spaces)} space{'s' if spaces != 1 else ''}")
        rack = _text(properties.get("Rack_Type"))
        if rack:
            details.append(rack.lower())
        if str(properties.get("Inside_or_Outside") or "").strip().lower() == "inside":
            details.append("indoors")
        out.append(
            Amenity(
                id=f"bike:{_text(properties.get('OBJECTID')) or index}",
                kind="bike",
                lng=position[0],
                lat=position[1],
                label=label,
                detail=" · ".join(details) or None,
            )
        )
    return out


#: How far an amenity may sit from a building centroid and still adopt its
#: name. Brown's largest footprint spans ~120 m, so a point genuinely inside a
#: building can be this far from its centroid; beyond it the nearest building
#: is a neighbour, and inheriting its name would be a lie.
LABEL_SNAP_M = 60.0

_M_PER_DEG_LAT = 111_320.0


def _metres(a_lng: float, a_lat: float, b_lng: float, b_lat: float) -> float:
    """Equirectangular distance — exact enough at campus scale."""
    import math

    mid = math.radians((a_lat + b_lat) / 2)
    dx = (a_lng - b_lng) * _M_PER_DEG_LAT * math.cos(mid)
    dy = (a_lat - b_lat) * _M_PER_DEG_LAT
    return math.hypot(dx, dy)


def resolve_labels(
    amenities: Sequence[Amenity], buildings: Sequence[Any]
) -> tuple[list[Amenity], list[str]]:
    """Replace missing and asset-code labels with the owning building's name.

    Two paths, in order of trust:

    1. **By property code.** The blue-light and restroom layers carry Brown's
       own `Property_Code`, which is the buildings artifact's primary key. That
       is an exact join, not a guess.
    2. **By proximity.** `All_Building_Resources` has no code at all — its
       `Name` column holds internal asset codes ("KQARCHBRON") and is empty for
       27 of 127 rows. Those adopt the nearest building label within
       :data:`LABEL_SNAP_M`.

    An amenity that can be resolved by neither keeps whatever it had; the
    caller gates on how many are left unnamed.
    """
    by_code = {b.property_code: b.label for b in buildings if getattr(b, "property_code", None)}
    diagnostics: list[str] = []
    resolved: list[Amenity] = []
    unresolved = 0

    for amenity in amenities:
        label = amenity.label
        needs_name = not label or _is_asset_code(label)
        if not needs_name:
            resolved.append(amenity)
            continue

        exact = by_code.get(amenity.property_code) if amenity.property_code else None
        if exact:
            resolved.append(replace(amenity, label=exact))
            continue

        best, best_distance = None, LABEL_SNAP_M
        for building in buildings:
            distance = _metres(amenity.lng, amenity.lat, building.lng, building.lat)
            if distance < best_distance:
                best, best_distance = building, distance
        if best is not None:
            resolved.append(replace(amenity, label=best.label, property_code=best.property_code))
            continue

        unresolved += 1
        resolved.append(replace(amenity, label=label or "Campus"))

    if unresolved:
        diagnostics.append(f"{unresolved} amenity point(s) kept a placeholder label")
    return resolved, diagnostics


def attach_places(
    amenities: Sequence[Amenity], buildings_document: Mapping[str, Any]
) -> list[Amenity]:
    """Copy each owning building's `placeIds` onto its amenities."""
    by_code: dict[str, tuple[str, ...]] = {}
    for feature in buildings_document.get("features") or []:
        properties = feature.get("properties") or {}
        code = properties.get("propertyCode")
        if code:
            by_code[str(code)] = tuple(properties.get("placeIds") or ())
    return [
        replace(amenity, place_ids=by_code.get(amenity.property_code or "", ()))
        for amenity in amenities
    ]


def collect_amenities(root: Path | None = None) -> list[Amenity]:
    """Every amenity from every recorded layer, in a stable order."""
    amenities: list[Amenity] = []
    amenities += blue_light_amenities(load_layer("BlueLightEmergencyPhone_view.geojson", root))
    amenities += aed_amenities(load_layer("AED_NEW_view_for_base_map.geojson", root))
    amenities += building_resource_amenities(load_layer("All_Building_Resources.geojson", root))
    amenities += restroom_amenities(load_layer("All_Restrooms_VIEW.geojson", root))
    amenities += bike_amenities(load_layer("BikeRacks_view.geojson", root))
    # Sorted by (kind, id) so the artifact is byte-stable across runs and a
    # diff shows real data movement rather than ArcGIS row ordering.
    return sorted(amenities, key=lambda a: (a.kind, a.id))


def counts_by_kind(amenities: Iterable[Amenity]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for amenity in amenities:
        counts[amenity.kind] = counts.get(amenity.kind, 0) + 1
    return counts


def build_amenities_document(
    amenities: Sequence[Amenity], attribution: str
) -> dict[str, Any]:
    """GeoJSON FeatureCollection, one Point per amenity."""
    features = []
    for amenity in amenities:
        properties: dict[str, Any] = {
            "id": amenity.id,
            "kind": amenity.kind,
            "label": amenity.label,
        }
        if amenity.detail:
            properties["detail"] = amenity.detail
        if amenity.property_code:
            properties["propertyCode"] = amenity.property_code
        if amenity.place_ids:
            properties["placeIds"] = list(amenity.place_ids)
        features.append(
            {
                "type": "Feature",
                "id": amenity.id,
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        round(amenity.lng, COORD_PRECISION),
                        round(amenity.lat, COORD_PRECISION),
                    ],
                },
                "properties": properties,
            }
        )
    return {
        "type": "FeatureCollection",
        "attribution": attribution,
        "counts": counts_by_kind(amenities),
        "features": features,
    }


# -- job ---------------------------------------------------------------------

#: Per-kind floors. Set below the recorded counts with headroom for real
#: churn (a decommissioned phone, a rack removed for construction) but far
#: above zero — the failure this catches is a layer that starts returning an
#: empty FeatureCollection, which is silent in every other respect.
MIN_BY_KIND: dict[str, int] = {
    "blue-light": 120,
    "aed": 50,
    "narcan": 30,
    "restroom": 120,
    "restroom-inclusive": 60,
    "hydration": 35,
    "bike": 180,
    "menstrual": 20,
    "lactation": 8,
    "printer": 5,
    "dining": 8,
}

#: Share of points that must carry a real name rather than a placeholder.
MIN_NAMED_SHARE = 0.98

ATTRIBUTION = "Brown University Facilities Management (public ArcGIS FeatureServer)"


@dataclass(frozen=True)
class AmenitiesJobResult:
    amenities: tuple[Amenity, ...]
    document: dict[str, Any]
    gate_failures: tuple[str, ...]
    published_count: int | None
    diagnostics: tuple[str, ...]


def run_campus_amenities_job(
    *,
    seeds_dir: Path | str,
    staging_root: Path | str,
    fixtures_root: Path | None = None,
) -> AmenitiesJobResult:
    """Build and publish ``campus_amenities.geojson`` when every gate passes."""
    from brownsync_ingest.campus.arcgis import load_arcgis_geojson, normalize_features
    from brownsync_ingest.output import publish_json_document

    seeds_dir = Path(seeds_dir)
    collected = collect_amenities(fixtures_root)
    buildings, _ = normalize_features(load_arcgis_geojson())
    amenities, diagnostics = resolve_labels(collected, buildings)

    # The published buildings artifact is the ONLY place the code → places
    # mapping exists (conflation produced it). This job already runs after
    # `campus` for exactly this kind of reason.
    buildings_artifact = seeds_dir / "campus_buildings.geojson"
    if buildings_artifact.is_file():
        with buildings_artifact.open(encoding="utf-8") as handle:
            amenities = attach_places(amenities, json.load(handle))
    else:
        diagnostics.append(
            "campus_buildings.geojson absent — amenities published without placeIds; "
            "run `ingest run campus` first"
        )

    # GATES FIRST, before any document is assembled — same ordering rule as
    # the buildings job, for the same reason: fail-closed has to be structural.
    gate_failures: list[str] = []
    counts = counts_by_kind(amenities)
    for kind, floor in sorted(MIN_BY_KIND.items()):
        found = counts.get(kind, 0)
        if found < floor:
            gate_failures.append(f"{kind}: {found} < required {floor}")

    unknown = sorted(set(counts) - set(AMENITY_KINDS))
    if unknown:
        gate_failures.append(f"unknown amenity kind(s): {', '.join(unknown)}")

    named = sum(1 for a in amenities if a.label and a.label != "Campus")
    share = named / len(amenities) if amenities else 0.0
    if share < MIN_NAMED_SHARE:
        gate_failures.append(
            f"labels: only {share:.1%} of points carry a real name (required {MIN_NAMED_SHARE:.0%})"
        )

    document: dict[str, Any] = {}
    published_count: int | None = None
    if not gate_failures:
        document = build_amenities_document(amenities, ATTRIBUTION)
        publish_json_document(
            document, seeds_dir / "campus_amenities.geojson", Path(staging_root), compact=True
        )
        published_count = len(document["features"])

    return AmenitiesJobResult(
        amenities=tuple(amenities),
        document=document,
        gate_failures=tuple(gate_failures),
        published_count=published_count,
        diagnostics=tuple(diagnostics),
    )
