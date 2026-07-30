"""Campus greens, quads and athletic fields — the non-building landmarks.

Why this matters more than it looks: the six `outdoor` places in the curated
gazetteer (Main Green, Quiet Green, Ruth Simmons Quad, Pembroke Green, Wriston
Quad, Van Wickle Gates) have **no polygon at all** — `db/seeds/places.ndjson`
carries 156 polygons across 174 places and every one of the greens is in the
missing 18. They are also, unavoidably, unmatched by building conflation: a
green has no footprint, so `conflate.py` deliberately excludes `outdoor` kinds
from nearest-building matching (without that guard the Ruth J. Simmons
Quadrangle bound to "Saint Stephen's Church" 20 m away).

Brown publishes the geometry we are missing:

    Green_Spaces_view      524 polygons, 25 with `GreenSpaceName`
    Athletic_Fields_view    28 polygons, all with `Athletic_F`

The named ones close the gazetteer gap and give the map its most recognisable
labels — a named, outlined Main Green is probably the single biggest "this is
Brown" legibility win after building labels. The 499 unnamed ones are lawn and
planting beds; they carry no label but they are what makes campus read as green
space rather than undifferentiated dark.

`Campus_Walkways_view` (151 polygons, 31,638 vertices, 73 kB gzipped) is
deliberately NOT included: it is unnamed, Protomaps already carries some paths,
and it is pure decoration at a cost comparable to every green combined.
Revisit only with a simplification pass.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping

from brownsync_ingest.campus.arcgis import _ring_centroid, round_geometry
from brownsync_ingest.campus.conflate import SeedPlace, point_in_geometry


GREENS_FIXTURE = "Green_Spaces_view.geojson"
FIELDS_FIXTURE = "Athletic_Fields_view.geojson"

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "recorded" / "arcgis"

#: Landmark labels sit in the same tier as rank-0 buildings: a green is a
#: primary wayfinding anchor, not a detail. The threshold is 0, not 14.5,
#: because MapLibre evaluates ``["zoom"]`` inside a FILTER at the integer tile
#: zoom — a fractional threshold there fires a whole zoom level late. The
#: layer's own ``minzoom`` (which IS fractional-aware) does the real gating.
LANDMARK_RANK = 0
LANDMARK_MIN_ZOOM = 0

#: Names the source uses that are not really landmark names. "Lower"/"Upper"
#: are fragments of a split polygon; a blank is a data-entry artifact.
NAME_NOISE = frozenset({"", " ", "lower", "upper", "n/a", "none"})


@dataclass(frozen=True)
class Landmark:
    """One named or unnamed campus open space."""

    id: str
    kind: str  # 'green' | 'field'
    name: str | None
    geometry: dict[str, Any]
    lat: float
    lng: float
    place_id: str | None = None


def _clean_name(raw: Any) -> str | None:
    value = (raw or "").strip() if isinstance(raw, str) else None
    if not value or value.lower() in NAME_NOISE:
        return None
    return value


def load_landmarks(fixture_dir: Path | None = None) -> tuple[Landmark, ...]:
    """Read the recorded green-space and athletic-field layers."""
    directory = fixture_dir or FIXTURE_DIR
    landmarks: list[Landmark] = []

    for filename, kind, name_field in (
        (GREENS_FIXTURE, "green", "GreenSpaceName"),
        (FIELDS_FIXTURE, "field", "Athletic_F"),
    ):
        path = directory / filename
        if not path.exists():
            continue
        document = json.loads(path.read_text(encoding="utf-8"))
        for index, feature in enumerate(document.get("features", [])):
            geometry = feature.get("geometry")
            if not geometry:
                continue
            props = feature.get("properties") or {}
            name = _clean_name(props.get(name_field))
            lat, lng = _ring_centroid(geometry)
            landmarks.append(
                Landmark(
                    id=f"{kind}:{props.get('FID', index)}",
                    kind=kind,
                    name=name,
                    geometry=round_geometry(geometry),
                    lat=lat,
                    lng=lng,
                )
            )

    landmarks.sort(key=lambda item: item.id)
    return tuple(landmarks)


def _approx_area(geometry: Mapping[str, Any]) -> float:
    """Planar |shoelace| over outer rings — relative sizes only, so units
    (square degrees) do not matter."""
    kind = geometry.get("type")
    if kind == "Polygon":
        rings = [geometry["coordinates"][0]]
    elif kind == "MultiPolygon":
        rings = [poly[0] for poly in geometry["coordinates"]]
    else:
        return 0.0
    total = 0.0
    for ring in rings:
        acc = 0.0
        for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
            acc += x0 * y1 - x1 * y0
        total += abs(acc) * 0.5
    return total


def _name_tokens(value: str) -> set[str]:
    """Lowercase word set. Parentheticals are flattened, not dropped.

    The source names greens as "College Green (Main Green)" and "Simmons
    Quadrangle (Lower Green)", so the parenthetical is often the name people
    actually use. Only genuinely contentless words are removed — NOT "green",
    "field" or "quad", because those are exactly what distinguishes Pembroke
    Field from Pembroke Green.
    """
    cleaned = value.replace("(", " ").replace(")", " ").replace(".", " ").lower()
    drop = {"the", "at", "of", "university", "brown"}
    words = {w for w in cleaned.split() if w not in drop}
    return words or set(cleaned.split())


def _name_similarity(a: str, b: str) -> float:
    ta, tb = _name_tokens(a), _name_tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


#: Words naming the KIND of open space. Two landmarks whose type words both
#: exist but disagree are different places even when the rest of the name
#: matches — this is the single discriminator that separates
#: "Pembroke Field" from "Pembroke Green".
TYPE_TOKENS = frozenset(
    {"green", "field", "quad", "quadrangle", "park", "plaza", "terrace", "garden", "court"}
)


def names_agree(a: str | None, b: str | None) -> bool:
    """True when two names denote the same open space.

    Jaccard alone cannot do this job. Measured on the real pairs:

        "Simmons Quadrangle (Lower Green)" vs "Ruth J. Simmons Quadrangle" -> 0.33
        "Pembroke Field"                   vs "Pembroke Green"             -> 0.33

    Identical scores, opposite answers. What actually separates them is the
    TYPE word: Quadrangle matches Quadrangle, while Field contradicts Green.
    So: the type words must not disagree, and at least one distinctive
    (non-type) word must be shared.
    """
    if not a or not b:
        return False
    ta, tb = _name_tokens(a), _name_tokens(b)
    types_a, types_b = ta & TYPE_TOKENS, tb & TYPE_TOKENS
    if types_a and types_b and not (types_a & types_b):
        return False
    return bool((ta - TYPE_TOKENS) & (tb - TYPE_TOKENS))


#: Minimum name overlap to bind WITHOUT containment evidence. Calibrated
#: against the real pairs: "College Green (Main Green)" vs "The College Green"
#: scores 0.67 and must bind; "Pembroke Field" vs "Pembroke Green" scores 0.33
#: and must NOT — an earlier version dropped "field"/"green" as noise, leaving
#: only "pembroke", and bound an athletic field to a green.
NAME_ONLY_THRESHOLD = 0.5


def bind_outdoor_places(
    landmarks: Iterable[Landmark], places: Iterable[SeedPlace]
) -> tuple[tuple[Landmark, ...], tuple[str, ...], tuple[str, ...]]:
    """Attach curated `outdoor` place ids to the landmark polygons.

    Iterates **places**, not landmarks, and scores every candidate — because
    iterating landmarks binds whichever polygon happens to come first in file
    order, which in practice meant the Ruth J. Simmons Quadrangle claimed an
    unnamed lawn patch before reaching the polygon literally called "Simmons
    Quadrangle (Lower Green)".

    Evidence, strongest first:
      3. centroid inside the polygon AND the names agree
      2. centroid inside the polygon, polygon is named
      1. centroid inside the polygon (unnamed polygon — geometry only)
      0. names agree strongly, no containment

    Returns (landmarks, diagnostics, still_unbound_place_ids).
    """
    landmarks = list(landmarks)
    outdoor = [p for p in places if p.kind == "outdoor"]
    diagnostics: list[str] = []
    claimed: dict[str, str] = {}  # landmark id -> place id

    for place in sorted(outdoor, key=lambda p: p.id):
        best: tuple[int, float, float, str] | None = None
        for landmark in landmarks:
            if landmark.id in claimed:
                continue
            inside = point_in_geometry(place.lng, place.lat, landmark.geometry)
            similarity = _name_similarity(landmark.name, place.name) if landmark.name else 0.0
            if landmark.name and names_agree(landmark.name, place.name):
                # A polygon that CARRIES THE NAME outranks any containment.
                # Measured: the Ruth J. Simmons Quadrangle was binding to a
                # 530 m² unnamed planting bed that happened to contain its
                # centroid, while the 3,195 m² polygon literally named
                # "Simmons Quadrangle (Lower Green)" shipped beside it with no
                # placeId — two "Simmons Quadrangle" labels ~50 m apart, and
                # feature-state highlighting the wrong shape.
                tier = 4 if inside else 3
            elif inside and landmark.name:
                tier = 2
            elif inside:
                tier = 1
            else:
                continue
            # Area breaks ties inside a tier: a quad is the big polygon, not the
            # flower bed in the middle of it.
            candidate = (tier, similarity, _approx_area(landmark.geometry), landmark.id)
            if best is None or candidate > best:
                best = candidate
        if best is None:
            continue
        tier, similarity, _area, landmark_id = best
        claimed[landmark_id] = place.id
        if tier == 3:
            diagnostics.append(
                f"place {place.id!r} bound to landmark {landmark_id!r} by name only "
                f"(similarity {similarity:.2f}); no containment evidence"
            )

    result: list[Landmark] = []
    for landmark in landmarks:
        place_id = claimed.get(landmark.id)
        name = landmark.name
        if place_id and not name:
            # An unnamed polygon that a curated green sits inside: the curated
            # name is the best label available, and without it Wriston Quad and
            # the Ruth J. Simmons Quadrangle would render unlabelled.
            name = next((p.name for p in outdoor if p.id == place_id), None)
            if name:
                diagnostics.append(
                    f"landmark {landmark.id!r} takes its label from place {place_id!r} ({name!r})"
                )
        result.append(
            Landmark(
                id=landmark.id,
                kind=landmark.kind,
                name=name,
                geometry=landmark.geometry,
                lat=landmark.lat,
                lng=landmark.lng,
                place_id=place_id,
            )
        )

    unbound = tuple(sorted({p.id for p in outdoor} - set(claimed.values())))
    return tuple(result), tuple(diagnostics), unbound


def dedupe_labels(landmarks: Iterable[Landmark]) -> tuple[Landmark, ...]:
    """Keep the largest polygon for any repeated name; the rest lose the label.

    Measured: "Pembroke Field" shipped twice — `field:9` and `green:510`, two
    overlapping polygons ~35 m apart, both `rank: 0` with an identical
    `sortKey: 0.0`. With no tiebreak MapLibre flickers between them on pan.
    Geometry is kept either way; only the duplicate label is dropped.
    """
    landmarks = list(landmarks)
    best: dict[frozenset[str], tuple[float, str]] = {}
    for landmark in landmarks:
        if not landmark.name:
            continue
        key = frozenset(_name_tokens(landmark.name))
        area = _approx_area(landmark.geometry)
        if key not in best or area > best[key][0]:
            best[key] = (area, landmark.id)

    keep = {landmark_id for _, landmark_id in best.values()}
    return tuple(
        landmark
        if not landmark.name or landmark.id in keep
        else Landmark(
            id=landmark.id,
            kind=landmark.kind,
            name=None,
            geometry=landmark.geometry,
            lat=landmark.lat,
            lng=landmark.lng,
            place_id=landmark.place_id,
        )
        for landmark in landmarks
    )


def build_landmarks_document(landmarks: Iterable[Landmark], attribution: str) -> dict[str, Any]:
    """GeoJSON the map fetches for green/field fills and their labels."""
    features: list[dict[str, Any]] = []
    for landmark in dedupe_labels(landmarks):
        properties: dict[str, Any] = {"kind": landmark.kind}
        if landmark.name:
            properties.update(
                {
                    "label": landmark.name,
                    "rank": LANDMARK_RANK,
                    "sortKey": float(LANDMARK_RANK),
                    "labelMinZoom": LANDMARK_MIN_ZOOM,
                }
            )
        if landmark.place_id:
            properties["placeId"] = landmark.place_id
        features.append(
            {
                "type": "Feature",
                "id": landmark.id,
                "geometry": landmark.geometry,
                "properties": properties,
            }
        )
    features.sort(key=lambda f: str(f["id"]))
    return {
        "type": "FeatureCollection",
        "schema_version": 1,
        "attribution": attribution,
        "features": features,
    }
