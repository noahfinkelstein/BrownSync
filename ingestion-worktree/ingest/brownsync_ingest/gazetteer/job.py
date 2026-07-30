"""The places job: curated catalog + recorded OSM footprints -> places.ndjson.

Publication policy (plan Tasks 4/10, seam added in Task 6B): the seeds file
is replaced only when every gate passes —

1. ``places``: at least ``MIN_PLACES`` validated rows (the Task 4 catalog
   floor of 120);
2. ``dropped-entries``: no curated entry may have been dropped for missing
   coordinates — a drop means the catalog and fixture disagree and must be
   reconciled, never silently published around.

Geometry, addresses, and osm ids are ODbL-licensed OpenStreetMap data; the
catalog attribution string rides on the result for report and (Task 9)
manifest consumers. The CLI and ``db/seeds/manifest.json`` bundling remain
Task 9 — this seam owns exactly the one NDJSON publication.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from brownsync_ingest.contract import PlaceRow
from brownsync_ingest.gazetteer.catalog import build_catalog_from_files
from brownsync_ingest.gazetteer.models import PlaceDiagnostic
from brownsync_ingest.output import publish_ndjson


MIN_PLACES = 120


@dataclass(frozen=True)
class PlacesJobResult:
    """Everything one run measured, produced, and decided."""

    rows: tuple[PlaceRow, ...]
    diagnostics: tuple[PlaceDiagnostic, ...]
    attribution: str
    gate_failures: tuple[str, ...]  # empty means every gate passed
    published_count: int | None  # None: gates failed, seeds untouched


def run_places_job(
    *,
    seeds_path: Path | str,
    staging_root: Path | str,
    aliases_path: Path | None = None,
    overpass_path: Path | None = None,
    min_places: int = MIN_PLACES,
) -> PlacesJobResult:
    """Build the gazetteer; publish seeds only when every gate passes."""
    build = build_catalog_from_files(aliases_path, overpass_path)
    dropped = [diagnostic for diagnostic in build.diagnostics if diagnostic.dropped]

    gate_failures: list[str] = []
    if len(build.rows) < min_places:
        gate_failures.append(f"places: {len(build.rows)} < required {min_places}")
    if dropped:
        gate_failures.append(
            "dropped-entries: "
            + ", ".join(diagnostic.place_id for diagnostic in dropped)
        )

    published_count: int | None = None
    if not gate_failures:
        published_count = publish_ndjson(
            build.rows, PlaceRow, Path(seeds_path), Path(staging_root)
        )

    return PlacesJobResult(
        rows=tuple(build.rows),
        diagnostics=tuple(build.diagnostics),
        attribution=build.attribution,
        gate_failures=tuple(gate_failures),
        published_count=published_count,
    )
