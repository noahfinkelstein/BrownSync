"""The campus-buildings job: ArcGIS + gazetteer -> campus_buildings.geojson.

Publishes the artifact the web map renders as its own building layer, replacing
the basemap's nameless footprints. Protomaps basemaps v4 carries **no ``name``
attribute on ``buildings``** (verified against the committed extract), so every
campus label on the map originates here.

Publication policy matches the other jobs: gates run after the full output is
built, and any failure leaves the previous artifact untouched, records the run
``partial``, and exits non-zero. A degraded ArcGIS response can never overwrite
a good artifact.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from brownsync_ingest.campus.arcgis import (
    ATTRIBUTION,
    CampusBuilding,
    load_arcgis_geojson,
    normalize_features,
)
from brownsync_ingest.campus.conflate import ConflationResult, conflate, load_seed_places
from brownsync_ingest.campus.landmarks import (
    Landmark,
    bind_outdoor_places,
    build_landmarks_document,
    load_landmarks,
)
from brownsync_ingest.output import publish_json_document


#: Gate: a thin response must never replace a good artifact. 262 usable rows
#: today (263 minus one Ownership_Status='Sold').
MIN_BUILDINGS = 240

#: Gate: ``promoteId`` requires a unique, non-null id on every feature. When it
#: is missing, ``setFeatureState`` no-ops **silently** and the class-activity
#: tint just never appears — so this is checked rather than assumed.
REQUIRE_UNIQUE_PROPERTY_CODE = True

#: Gate: share of labels that must resolve above the address rung.
MIN_STRONG_LABEL_SHARE = 0.90

#: Gate: the greens are the map's most recognisable wayfinding anchors and the
#: six curated `outdoor` places have NO polygon of their own, so a landmarks
#: artifact that fails to bind them is not worth publishing.
MIN_LANDMARKS = 400
MIN_BOUND_OUTDOOR_PLACES = 4

#: Rank 0 thresholds. Both are measured signals, not taste: floor area from
#: Brown's own records, and *actual scheduled teaching* from the CAB export.
LANDMARK_GROSS_AREA = 60_000.0
LANDMARK_MEETING_COUNT = 30
LANDMARK_USES = frozenset({"Library", "Dining"})

#: rank -> the zoom at which its labels start drawing. Baked per feature so the
#: style filters on one number instead of evaluating a rule per feature.
#:
#: THESE MUST BE INTEGERS (except rank 0). MapLibre evaluates ``["zoom"]``
#: inside a **filter** at the integer tile zoom, not the fractional map zoom, so
#: the original 14.5/15.5/16.5 silently rounded UP to 15/16/17 — rank 1 was
#: hidden until z16 and rank 2 until z17, leaving 94 buildings labelled only
#: across 17.0-17.5 given MAX_ZOOM = 17.5. Rank 0 uses 0 and is gated by the
#: layer's own ``minzoom: 14.5``, which IS fractional-aware.
RANK_MIN_ZOOM = {0: 0, 1: 16, 2: 17, 3: 17}

SMALL_STRUCTURE_TYPES = frozenset({"HOUSE", "GARAGE", "SHED"})


@dataclass(frozen=True)
class CampusJobResult:
    buildings: tuple[CampusBuilding, ...]
    conflation: ConflationResult
    document: dict[str, Any]
    gate_failures: tuple[str, ...]
    published_count: int | None
    diagnostics: tuple[str, ...]
    landmarks: tuple[Landmark, ...] = ()
    landmarks_document: dict[str, Any] | None = None
    unbound_outdoor_places: tuple[str, ...] = ()


#: Gate: the CAB export currently yields 1,755 meeting rows. Rank 0 is
#: promoted partly by measured teaching load, so an absent or truncated
#: meetings file silently demotes real landmarks (Orwig falls to rank 2 and
#: disappears until z16.5) while every other gate still passes.
MIN_MEETING_ROWS = 1_200


def meeting_counts(course_meetings_path: Path | str) -> dict[str, int] | None:
    """place_id -> number of scheduled meetings, from the CAB export.

    This is the rank-0 signal that makes label prominence *measured* rather
    than a judgement call: a building where 200 course meetings happen is a
    landmark to students regardless of its floor area.
    """
    counts: Counter[str] = Counter()
    path = Path(course_meetings_path)
    if not path.exists():
        # NOT an empty dict: an absent file must be distinguishable from a file
        # with no resolved places, so the caller can fail closed rather than
        # publish degraded ranks over a good artifact.
        return None
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            place_id = json.loads(line).get("place_id")
            if place_id:
                counts[place_id] += 1
    return dict(counts)


def label_rank(
    building: CampusBuilding,
    *,
    place_ids: tuple[str, ...],
    meetings: Mapping[str, int],
) -> int:
    """Assign a label tier. Lower draws earlier and wins collisions."""
    teaching = sum(meetings.get(pid, 0) for pid in place_ids)
    if (
        (building.gross_area or 0) >= LANDMARK_GROSS_AREA
        or building.current_use in LANDMARK_USES
        or teaching >= LANDMARK_MEETING_COUNT
    ):
        return 0
    if building.building_type in SMALL_STRUCTURE_TYPES or building.label_rung >= 4:
        return 2
    if building.label_rung <= 2:
        return 1
    return 3


def build_document(
    buildings: tuple[CampusBuilding, ...],
    conflation: ConflationResult,
    meetings: Mapping[str, int],
) -> dict[str, Any]:
    """Assemble the GeoJSON FeatureCollection the web map fetches."""
    max_area = max((b.gross_area or 0.0) for b in buildings) or 1.0
    features: list[dict[str, Any]] = []

    for building in buildings:
        place_ids = conflation.all_places_by_code.get(building.property_code, ())
        rank = label_rank(building, place_ids=place_ids, meetings=meetings)
        # One float so larger buildings win collisions inside a tier. Lower
        # sorts first in MapLibre's symbol-sort-key.
        size_share = min((building.gross_area or 0.0) / max_area, 1.0)
        sort_key = round(rank + (1.0 - size_share) * 0.9, 4)

        features.append(
            {
                "type": "Feature",
                "id": building.property_code,
                "geometry": building.geometry,
                "properties": {
                    "propertyCode": building.property_code,
                    "label": building.label,
                    "rank": rank,
                    "sortKey": sort_key,
                    "labelMinZoom": RANK_MIN_ZOOM[rank],
                    "heightM": building.height_m,
                    "floors": building.floors,
                    "year": building.year_built,
                    "kind": building.kind,
                    "placeId": conflation.by_code.get(building.property_code),
                    "placeIds": list(place_ids),
                    "address": building.address,
                    "currentUse": building.current_use,
                    "buildingType": building.building_type,
                    "complex": building.complex_name,
                    "aliases": list(building.aliases),
                    "meetings": sum(meetings.get(pid, 0) for pid in place_ids),
                },
            }
        )

    features.sort(key=lambda f: f["properties"]["propertyCode"])
    return {
        "type": "FeatureCollection",
        "schema_version": 1,
        "attribution": ATTRIBUTION,
        "features": features,
    }


def run_campus_buildings_job(
    *,
    seeds_dir: Path | str,
    staging_root: Path | str,
    arcgis_path: Path | None = None,
    places_path: Path | None = None,
    course_meetings_path: Path | None = None,
    min_buildings: int = MIN_BUILDINGS,
) -> CampusJobResult:
    """Build and publish ``campus_buildings.geojson`` when every gate passes."""
    seeds_dir = Path(seeds_dir)
    places_file = Path(places_path) if places_path else seeds_dir / "places.ndjson"
    meetings_file = (
        Path(course_meetings_path) if course_meetings_path else seeds_dir / "course_meetings.ndjson"
    )

    buildings, diagnostics = normalize_features(load_arcgis_geojson(arcgis_path))
    places = load_seed_places(places_file)
    conflation = conflate(buildings, places)
    meetings = meeting_counts(meetings_file)
    landmarks, landmark_diagnostics, unbound_outdoor = bind_outdoor_places(
        load_landmarks(), places
    )

    # GATES RUN FIRST, before any document is assembled.
    #
    # build_document does `max(... for b in buildings)`, which raises
    # ValueError on an empty sequence — so with an empty ArcGIS response the
    # operator got a bare max() traceback and a `status=error` run, and the
    # MIN_BUILDINGS gate written for exactly that input was dead code. Ordering
    # the gates first makes fail-closed structural rather than incidental.
    gate_failures: list[str] = []
    if len(buildings) < min_buildings:
        gate_failures.append(f"buildings: {len(buildings)} < required {min_buildings}")

    codes = [b.property_code for b in buildings]
    if REQUIRE_UNIQUE_PROPERTY_CODE and (not all(codes) or len(set(codes)) != len(codes)):
        gate_failures.append("propertyCode: must be present and unique — promoteId depends on it")

    strong = sum(1 for b in buildings if b.label_rung <= 2)
    share = strong / len(buildings) if buildings else 0.0
    if share < MIN_STRONG_LABEL_SHARE:
        gate_failures.append(
            f"labels: only {share:.1%} resolved above the address rung "
            f"(required {MIN_STRONG_LABEL_SHARE:.0%})"
        )

    if conflation.ambiguities:
        gate_failures.append(
            "conflation-ambiguity: " + "; ".join(conflation.ambiguities[:5])
        )

    if meetings is None:
        gate_failures.append(
            f"meetings: {meetings_file} is missing — rank-0 promotion is driven by "
            "measured teaching load and would be wrong without it"
        )
    elif sum(meetings.values()) < MIN_MEETING_ROWS:
        gate_failures.append(
            f"meetings: {sum(meetings.values())} resolved rows < required {MIN_MEETING_ROWS} "
            "— the course export looks truncated"
        )

    if len(landmarks) < MIN_LANDMARKS:
        gate_failures.append(f"landmarks: {len(landmarks)} < required {MIN_LANDMARKS}")

    outdoor_total = sum(1 for p in places if p.kind == "outdoor")
    bound_outdoor = outdoor_total - len(unbound_outdoor)
    if bound_outdoor < MIN_BOUND_OUTDOOR_PLACES:
        gate_failures.append(
            f"outdoor-places: only {bound_outdoor}/{outdoor_total} curated greens "
            f"bound to a polygon (required {MIN_BOUND_OUTDOOR_PLACES})"
        )

    document: dict[str, Any] = {}
    landmarks_document: dict[str, Any] = {}
    published_count: int | None = None
    if not gate_failures:
        document = build_document(buildings, conflation, meetings or {})
        landmarks_document = build_landmarks_document(landmarks, ATTRIBUTION)
        publish_json_document(
            document,
            seeds_dir / "campus_buildings.geojson",
            Path(staging_root),
            compact=True,
        )
        publish_json_document(
            landmarks_document,
            seeds_dir / "campus_landmarks.geojson",
            Path(staging_root),
            compact=True,
        )
        published_count = len(document["features"]) + len(landmarks_document["features"])

    return CampusJobResult(
        buildings=buildings,
        conflation=conflation,
        document=document,
        gate_failures=tuple(gate_failures),
        published_count=published_count,
        diagnostics=tuple((*diagnostics, *conflation.diagnostics, *landmark_diagnostics)),
        landmarks=landmarks,
        landmarks_document=landmarks_document,
        unbound_outdoor_places=unbound_outdoor,
    )
