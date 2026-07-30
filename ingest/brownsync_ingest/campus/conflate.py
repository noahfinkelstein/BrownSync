"""Match Brown's 263 ArcGIS buildings to the 174 curated gazetteer places.

The two sets describe the same campus from different directions:

* ``db/seeds/places.ndjson`` — 174 hand-curated places with slugs that
  **1,755 ``course_meetings`` rows and ``athletics_venues.json`` reference by
  foreign key**. Their ids are load-bearing and can never be renamed.
* The ArcGIS layer — 262 usable buildings with authoritative footprints,
  official names, addresses, and areas, but no slug and no history.

So conflation is one-directional: ArcGIS **enriches** places, never replaces
them. The join is **spatial first**, because names are exactly what disagree
between the two sets ("Pizzitola" vs "Pizzitola Sports Ctr" vs "Pitz").

Trigram matching over the merged alias set is available as corroboration and a
tiebreak, but is **never sole evidence for a merge** — the OSM export in this
repo already proves name matching pulls in RISD buildings (Chace Center,
Metcalf Building) that a name-only rule would wrongly claim as Brown's.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Sequence

from brownsync_ingest.campus.arcgis import CampusBuilding


@dataclass(frozen=True)
class SeedPlace:
    """The subset of a curated place row conflation needs."""

    id: str
    name: str
    kind: str
    lat: float
    lng: float
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class Match:
    """One ArcGIS building bound to one curated place."""

    property_code: str
    place_id: str
    method: str  # 'centroid-in-footprint' | 'nearest-within-tolerance'
    distance_m: float


@dataclass(frozen=True)
class ConflationResult:
    matches: tuple[Match, ...]
    #: property_code -> the PRIMARY place id (click-through target).
    by_code: Mapping[str, str]
    #: property_code -> every place inside that building, sorted. One building
    #: routinely hosts several places; see MANY_PLACES_PER_BUILDING below.
    all_places_by_code: Mapping[str, tuple[str, ...]]
    #: place ids that matched nothing — reported, never guessed at.
    unmatched_places: tuple[str, ...]
    #: Buildings with no curated place. Expected and fine: the layer covers
    #: garages and sheds the gazetteer never curated.
    unmatched_buildings: tuple[str, ...]
    ambiguities: tuple[str, ...]
    diagnostics: tuple[str, ...]


#: A curated centroid this far outside every footprint is treated as unmatched
#: rather than snapped to whatever is closest. Curated centroids were derived
#: from OSM footprints, so a real correspondence lands inside or within metres.
NEAREST_TOLERANCE_M = 25.0

#: MANY_PLACES_PER_BUILDING.
#:
#: A first draft of this module treated two places inside one footprint as an
#: ambiguity and dropped both. Running it against real data showed that is
#: simply how campus works — measured, every one of these is correct:
#:
#:   Andrews Commons (dining)  inside  Andrews Hall (residence)
#:   Blue Room (dining)        inside  Stephen Robert '62 Campus Center
#:   Ivy Room (dining)         inside  Sharpe Refectory
#:   Josiah's (dining)         inside  Vartan Gregorian Quad B
#:   Coleman Aquatics Center   inside  the Nelson Fitness Center complex
#:
#: So the relationship is many-places-to-one-building. Every place inside a
#: footprint is retained in ``all_places_by_code`` (that is what drives the
#: class-activity tint — any active place should light the building), and one
#: is chosen as ``primary`` for click-through by :data:`PRIMARY_KIND_ORDER`.
#:
#: Dining venues sort last deliberately: "the Ratty" is a room inside a
#: building whose name people use for the building, so tapping the footprint
#: should land on the containing hall.
PRIMARY_KIND_ORDER = (
    "academic",
    "residence",
    "library",
    "athletic",
    "admin",
    "other",
    "outdoor",
    "dining",
)

#: Kinds excluded from stage-2 nearest matching. An outdoor place is a green or
#: a quad — it has no building, so the nearest footprint is by definition the
#: wrong answer. (Measured: without this, the Ruth J. Simmons Quadrangle bound
#: to "Saint Stephen'S Church" 20 m away.) Greens are served by the separate
#: landmarks layer instead.
NEAREST_EXCLUDED_KINDS = frozenset({"outdoor"})


def load_seed_places(path: Path | str) -> tuple[SeedPlace, ...]:
    """Read ``db/seeds/places.ndjson`` into the fields conflation uses."""
    places: list[SeedPlace] = []
    with Path(path).open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            places.append(
                SeedPlace(
                    id=row["id"],
                    name=row["name"],
                    kind=row.get("kind", "other"),
                    lat=float(row["lat"]),
                    lng=float(row["lng"]),
                    aliases=tuple(row.get("aliases") or ()),
                )
            )
    return tuple(places)


def _point_in_ring(lng: float, lat: float, ring: Sequence[Sequence[float]]) -> bool:
    """Ray-casting point-in-polygon. Ring coordinates are [lng, lat]."""
    inside = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        if (y0 > lat) != (y1 > lat):
            x_at = x0 + (lat - y0) * (x1 - x0) / (y1 - y0)
            if lng < x_at:
                inside = not inside
    return inside


def point_in_geometry(lng: float, lat: float, geometry: Mapping[str, object]) -> bool:
    """True when the point falls inside a (Multi)Polygon, holes respected."""
    kind = geometry.get("type")
    polygons = (
        [geometry["coordinates"]] if kind == "Polygon" else geometry["coordinates"]  # type: ignore[index]
    )
    for polygon in polygons:  # type: ignore[union-attr]
        rings = list(polygon)
        if not rings:
            continue
        if not _point_in_ring(lng, lat, rings[0]):
            continue
        if any(_point_in_ring(lng, lat, hole) for hole in rings[1:]):
            continue  # in a hole — not inside this polygon
        return True
    return False


def _normalize_name(value: str) -> set[str]:
    """Lowercase word set with common building noise removed."""
    noise = {"the", "hall", "center", "centre", "ctr", "building", "house", "of", "and"}
    words = "".join(c if c.isalnum() else " " for c in value.lower()).split()
    kept = {w for w in words if w not in noise}
    return kept or set(words)


def _name_similarity(a: str, b: str) -> float:
    """Jaccard over normalized word sets — 0.0 (unrelated) to 1.0 (same)."""
    sa, sb = _normalize_name(a), _normalize_name(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def _metres_between(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Equirectangular approximation — exact enough at campus scale."""
    import math

    mean_lat = math.radians((lat1 + lat2) / 2)
    dx = math.radians(lng2 - lng1) * math.cos(mean_lat)
    dy = math.radians(lat2 - lat1)
    return math.hypot(dx, dy) * 6_371_000


def conflate(
    buildings: Iterable[CampusBuilding],
    places: Iterable[SeedPlace],
    *,
    nearest_tolerance_m: float = NEAREST_TOLERANCE_M,
) -> ConflationResult:
    """Bind curated places to ArcGIS footprints.

    Stage 1 — **containment**: the curated centroid falls inside the footprint.
    This is the strong signal and resolves the large majority.

    Stage 2 — **nearest within tolerance**: for places whose centroid missed
    every footprint (greens, or a centroid sitting in a courtyard), bind to the
    closest building centroid within :data:`NEAREST_TOLERANCE_M`.

    A place matching two footprints, or two places landing in one footprint, is
    an **ambiguity: reported, not resolved**. Guessing here would silently move
    1,755 course meetings to the wrong building.
    """
    buildings = list(buildings)
    places = list(places)
    diagnostics: list[str] = []
    ambiguities: list[str] = []

    contained: dict[str, list[str]] = {}
    for place in places:
        hits = [b.property_code for b in buildings if point_in_geometry(place.lng, place.lat, b.geometry)]
        if hits:
            contained[place.id] = hits

    place_by_id = {p.id: p for p in places}
    matches: list[Match] = []
    occupants: dict[str, list[str]] = {}
    matched_places: set[str] = set()

    for place_id, hits in sorted(contained.items()):
        if len(hits) > 1:
            # One centroid inside several footprints is genuinely ambiguous
            # (overlapping polygons); refuse rather than guess.
            ambiguities.append(
                f"place {place_id!r} centroid falls inside {len(hits)} footprints: {sorted(hits)}"
            )
            continue
        code = hits[0]
        occupants.setdefault(code, []).append(place_id)
        matched_places.add(place_id)
        matches.append(Match(code, place_id, "centroid-in-footprint", 0.0))

    by_code_lookup = {b.property_code: b for b in buildings}

    # Stage 2 assigns GLOBALLY BY ASCENDING DISTANCE, not first-come.
    #
    # The first version iterated `places` in file order and skipped any
    # building already in `occupants`. Measured consequence: the umbrella place
    # `vartan-gregorian-quad` reached stage 2 first, found its true nearest
    # (100061, 19.3 m) already occupied, and took 100036 at 20.7 m — starving
    # `vartan-gregorian-quad-a`, whose centroid is **1.0 m** from 100036 and
    # which then shipped in `unmatched_places`, absent from every feature's
    # `placeIds`. So the click-through target and the class tint pointed at the
    # wrong building, and the binding flipped if `places.ndjson` row order
    # changed — a file the places job regenerates.
    #
    # Sorting every candidate pair by distance makes the outcome deterministic
    # and gives each footprint to its closest claimant.
    candidates: list[tuple[float, str, str]] = []
    for place in places:
        if place.id in matched_places or place.id in contained:
            continue
        if place.kind in NEAREST_EXCLUDED_KINDS:
            diagnostics.append(
                f"place {place.id!r} (kind={place.kind}) left unmatched — outdoor places "
                "have no footprint and are served by the landmarks layer"
            )
            continue
        for building in buildings:
            distance = _metres_between(place.lat, place.lng, building.lat, building.lng)
            if distance <= nearest_tolerance_m:
                candidates.append((distance, place.id, building.property_code))

    # (distance, place_id, property_code) — the id terms only break exact ties.
    for distance, place_id, code in sorted(candidates):
        if place_id in matched_places:
            continue
        if code in occupants:
            # Stage 1 already put a place inside this footprint. Unlike stage 1
            # (which honours MANY_PLACES_PER_BUILDING), a stage-2 claim is a
            # guess from outside the polygon, so it defers rather than piling on.
            continue
        occupants.setdefault(code, []).append(place_id)
        matched_places.add(place_id)
        matches.append(Match(code, place_id, "nearest-within-tolerance", round(distance, 1)))
        diagnostics.append(
            f"place {place_id!r} bound to {code!r} "
            f"({by_code_lookup[code].label!r}) at {distance:.1f} m — centroid outside every footprint"
        )

    def primary_key(code: str, place_id: str) -> tuple[float, int, str]:
        """Rank candidates for the click-through target of one building.

        Name similarity leads, kind breaks ties. The building's own label is
        the best evidence for which of its occupants *is* the building:
        footprint 100276 is labelled "Sharpe Refectory", so the Ratty wins over
        the Ivy Room inside it — even though both are ``dining`` and a
        kind-then-alphabetical rule picks the Ivy Room.
        """
        place = place_by_id[place_id]
        label = by_code_lookup[code].label
        similarity = -_name_similarity(place.name, label)
        order = (
            PRIMARY_KIND_ORDER.index(place.kind)
            if place.kind in PRIMARY_KIND_ORDER
            else len(PRIMARY_KIND_ORDER)
        )
        return (similarity, order, place_id)

    all_places = {code: tuple(sorted(ids)) for code, ids in occupants.items()}
    by_code = {
        code: sorted(ids, key=lambda pid, c=code: primary_key(c, pid))[0]
        for code, ids in occupants.items()
    }
    for code, ids in sorted(occupants.items()):
        if len(ids) > 1:
            diagnostics.append(
                f"building {code!r} hosts {len(ids)} places {sorted(ids)}; "
                f"primary={by_code[code]!r}"
            )

    matches.sort(key=lambda m: (m.property_code, m.place_id))
    unmatched_places = tuple(sorted(p.id for p in places if p.id not in matched_places))
    unmatched_buildings = tuple(
        sorted(b.property_code for b in buildings if b.property_code not in occupants)
    )

    return ConflationResult(
        matches=tuple(matches),
        by_code=by_code,
        all_places_by_code=all_places,
        unmatched_places=unmatched_places,
        unmatched_buildings=unmatched_buildings,
        ambiguities=tuple(ambiguities),
        diagnostics=tuple(diagnostics),
    )
