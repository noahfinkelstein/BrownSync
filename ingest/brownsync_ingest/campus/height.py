"""Derive a renderable building height from Brown Facilities' area fields.

Why this exists: the Protomaps v4 basemap carries ``height`` on only **13.6%**
of Providence buildings (121 of 889 in the campus z15 tile), so the map's
``coalesce(height, 12)`` fallback is doing the work for ~86% of them. That
uniform 12 m fallback is exactly why the massing reads flat.

Brown's own layer has no height column either, but it does expose
``Gross_area__Property_`` (total floor area) and ``Shape__Area`` (footprint
area, RI State Plane **feet**). Their ratio is a floor count.

Measured over the recorded fixture (n=237 rows with both fields)::

    min 0.07   p50 3.54   p90 5.12   max 19.23
    below 0.5: 1 row      above 14: 1 row

so the ratio is a well-behaved floor count for essentially the whole layer,
with two outliers that clamping handles.

Rejected alternative, recorded so nobody re-tries it: Brown also publishes
``3D_Buildings_08425/FeatureServer/9`` (``Enclosed3DBuildings``,
``esriGeometryMultiPatch``, ``hasZ: true``). The standard query endpoint
**flattens it to Z=0 rings** — sampled features return ``zmin == zmax == 0``.
Real geometry lives only in the I3S SceneServer, which is a much heavier
dependency. Heights must be derived, not read.
"""

from __future__ import annotations

from dataclasses import dataclass


#: Metres per storey. Ordinary institutional floor-to-floor.
METRES_PER_FLOOR = 3.5

#: Parapet / rooftop mechanical. Without it, flat roofs render as bare slabs.
PARAPET_M = 1.2

#: Floor-count clamp. The low bound kills ratio outliers (a parking property
#: measured 0.07); the high bound is set at the Sciences Library, which
#: genuinely is ~14 storeys and is the tallest thing on campus.
MIN_FLOORS = 1
MAX_FLOORS = 14

#: `Shape__Area` is RI State Plane SQUARE FEET.
SQFT_PER_SQM = 10.7639

#: An ASPECT CLAMP, because a floor count alone produces towers out of sheds.
#:
#: Measured before this existed: "Main Accumulation Area Shed" (11 m² footprint,
#: 1,025 sq ft gross) hit ratio 8.56 -> 9 floors -> **32.7 m**, the joint
#: second-tallest structure on campus and taller than the Rock, rendered as a
#: 3.3 m x 3.3 m column. Nineteen further sub-80 m² structures took the 3-floor
#: default and became 11.7 m pillars.
#:
#: A building cannot be much taller than a few times its own width, so the
#: footprint's side length bounds the plausible floor count.
ASPECT_FLOORS_PER_SIDE_METRE = 1 / 1.5

#: OSM ``levels`` disagreeing with the derived count by more than this many
#: floors is worth a diagnostic — a human tagged one of them.
FLOOR_DISAGREEMENT = 2


@dataclass(frozen=True)
class HeightEstimate:
    """A derived height plus the evidence that produced it."""

    height_m: float
    floors: int
    #: 'area-ratio' | 'osm-levels' | 'default'
    source: str
    diagnostics: tuple[str, ...] = ()


def aspect_max_floors(footprint_area: float | None) -> int:
    """Most floors a footprint of this size can plausibly carry."""
    if not footprint_area or footprint_area <= 0:
        return MAX_FLOORS
    side_m = (footprint_area / SQFT_PER_SQM) ** 0.5
    return max(MIN_FLOORS, min(MAX_FLOORS, int(side_m * ASPECT_FLOORS_PER_SIDE_METRE)))


def floors_from_area(gross_area: float | None, footprint_area: float | None) -> int | None:
    """Floor count from total floor area / footprint area, or None."""
    if not gross_area or not footprint_area or footprint_area <= 0:
        return None
    ratio = gross_area / footprint_area
    if ratio <= 0:
        return None
    return min(_clamp_floors(round(ratio)), aspect_max_floors(footprint_area))


def _clamp_floors(floors: int) -> int:
    return max(MIN_FLOORS, min(MAX_FLOORS, floors))


def estimate_height(
    *,
    gross_area: float | None,
    footprint_area: float | None,
    osm_levels: int | None = None,
    default_floors: int = 3,
) -> HeightEstimate:
    """Best available height, preferring measured area over tagged levels.

    Precedence:

    1. **area ratio** — Brown's own numbers, available for 237/263 rows.
    2. **OSM ``levels``** — 133 rows in the College Hill export carry it. Used
       when the area ratio is unavailable, and used to *corroborate* it
       otherwise: a disagreement greater than :data:`FLOOR_DISAGREEMENT` takes
       the OSM value, because a human deliberately tagged that one.
    3. **default** — 3 floors, the fixture median (3.54) rounded down. Applies
       to the 26 rows with no area data.
    """
    diagnostics: list[str] = []
    derived = floors_from_area(gross_area, footprint_area)
    levels = _clamp_floors(osm_levels) if osm_levels and osm_levels > 0 else None

    if derived is not None and levels is not None and abs(derived - levels) > FLOOR_DISAGREEMENT:
        diagnostics.append(
            f"area ratio implies {derived} floors but OSM levels says {levels}; "
            "taking the tagged value"
        )
        return HeightEstimate(_height(levels), levels, "osm-levels", tuple(diagnostics))

    if derived is not None:
        return HeightEstimate(_height(derived), derived, "area-ratio", tuple(diagnostics))

    if levels is not None:
        capped = min(levels, aspect_max_floors(footprint_area))
        return HeightEstimate(_height(capped), capped, "osm-levels", tuple(diagnostics))

    # The default is also aspect-clamped: an 8 m² pump shed must not get three
    # storeys just because its area fields are missing.
    floors = min(_clamp_floors(default_floors), aspect_max_floors(footprint_area))
    diagnostics.append("no area or levels data; using the default floor count")
    return HeightEstimate(_height(floors), floors, "default", tuple(diagnostics))


def _height(floors: int) -> float:
    return round(floors * METRES_PER_FLOOR + PARAPET_M, 2)
