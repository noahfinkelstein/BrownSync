"""Brown-owned/operated buildings sidecar (enrichment round, Codex drop).

Closes the deferred map-tint item — handoff section 5, "Brown-owned
buildings slightly lighter". The app consumes
``db/seeds/brown_owned_buildings.json`` to tint the OSM building footprints
it renders; its consumption is a declared cross-workstream dependency
(``reports/app_side_dependencies.md``) and ingestion never claims the app
reads it until a consumer test exists in the app lane. The artifact is not
yet listed in ``db/seeds/manifest.json`` — the bundle manifest is
regenerated in the concurrent orgs round, and adding this sidecar to the
bundle registry is recorded there as an explicit follow-up.

Classification is evidence-only, from
``fixtures/user_provided/brown_college_hill_buildings.csv`` (2,150 OSM
building ways, collected by Codex from Overpass, delivered by the user
2026-07-29):

* **tier 1 — direct**: the row's ``operator`` or ``owner`` tag contains
  "Brown University" (case-insensitive);
* **tier 2 — catalog**: the way appears in the export and backs a curated
  gazetteer place whose kind asserts an institutional campus function
  (:data:`INSTITUTIONAL_KINDS`).
  Every such place was itself grounded in Brown-only evidence (CAB
  sections, Brown LiveWhale events, Brown athletics feeds) in Tasks 4, 6B,
  8, 10 and the enrichment round.

``brown_relevant_hint`` is corroboration only and never classifies — the
drop itself proves the hint name-matches RISD buildings (Chace Center,
Metcalf Building). Catalog places of kind ``other`` (campus center,
Hillel, retail, commercial complexes, RISD's Chace Center) are the
**reported ambiguous middle**: they stay out of the sidecar rather than
being guessed in, unless tier-1 operator evidence puts their way in
(Soldiers Memorial Gate). A non-Brown operator on a tier-2 way is an
evidence conflict and fails the job closed.

``place_ids`` carries the curated places matching the Brown-owned ways plus
the institutional-kind places backed by OSM *relations* (Kassar House,
Barbour Hall, Verney-Woolley) — relations cannot appear in ``osm_way_ids``,
but the app can tint them through their published place polygons.

Way ids, footprints and tags are OpenStreetMap data (ODbL); the sidecar
document carries the attribution.
"""

from __future__ import annotations

import csv
import json
import os
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable, Mapping

from brownsync_ingest.contract import PlaceRow
from brownsync_ingest.gazetteer.catalog import build_catalog_from_files


INSTITUTIONAL_KINDS = frozenset(
    {"academic", "residence", "dining", "athletic", "library", "admin"}
)
BROWN_MARKER = "brown university"
MIN_CSV_ROWS = 2000

ATTRIBUTION = (
    "Building way ids © OpenStreetMap contributors, licensed under the "
    "Open Database License (ODbL) 1.0 — https://www.openstreetmap.org/copyright"
)

BROWN_OWNED_SIDECAR_KEYS = frozenset(
    {"schema_version", "generated_at", "attribution", "osm_way_ids", "place_ids"}
)

DEFAULT_CSV_PATH = (
    Path(__file__).resolve().parents[1]
    / "fixtures"
    / "user_provided"
    / "brown_college_hill_buildings.csv"
)


@dataclass(frozen=True)
class BuildingRow:
    """One OSM building way from the user-provided Overpass export."""

    way_id: int
    name: str | None
    operator: str | None
    owner: str | None
    brown_relevant_hint: bool
    building_type: str | None


def load_buildings_csv(path: Path | str) -> tuple[BuildingRow, ...]:
    """Load and validate the buildings export: ways only, unique ids."""
    rows: list[BuildingRow] = []
    seen: set[int] = set()
    with Path(path).open(encoding="utf-8-sig", newline="") as handle:
        for line, record in enumerate(csv.DictReader(handle), start=2):
            osm_type = record.get("osm_type")
            if osm_type != "way":
                raise ValueError(
                    f"line {line}: osm_type must be 'way', got {osm_type!r}"
                )
            way_id = int(record["osm_id"])
            if way_id in seen:
                raise ValueError(f"line {line}: duplicate way id {way_id}")
            seen.add(way_id)
            hint = (record.get("brown_relevant_hint") or "").strip().lower()
            rows.append(
                BuildingRow(
                    way_id=way_id,
                    name=(record.get("name") or "").strip() or None,
                    operator=(record.get("operator") or "").strip() or None,
                    owner=(record.get("owner") or "").strip() or None,
                    brown_relevant_hint=hint == "true",
                    building_type=(record.get("building_type") or "").strip() or None,
                )
            )
    return tuple(rows)


def _is_brown(value: str | None) -> bool:
    return value is not None and BROWN_MARKER in value.casefold()


def _way_number(osm_id: str | None) -> int | None:
    if osm_id and osm_id.startswith("way/"):
        return int(osm_id.split("/", 1)[1])
    return None


@dataclass(frozen=True)
class Classification:
    """The evidence-tiered Brown-owned building set, plus everything reported."""

    way_ids: tuple[int, ...]  # sorted union of the two tiers — the payload
    direct_way_ids: tuple[int, ...]  # tier 1: operator/owner evidence
    catalog_way_ids: tuple[int, ...]  # tier 2: institutional curated footprints
    place_ids: tuple[str, ...]  # way-matched + institutional relation-backed
    conflict_way_ids: tuple[int, ...]  # tier-2 way with a non-Brown operator
    catalog_ways_missing_from_export: tuple[int, ...]  # snapshot drift signal
    ambiguous_hint_way_ids: tuple[int, ...]  # hint=true without evidence
    ambiguous_other_place_ids: tuple[str, ...]  # catalog kind=other, unproven


def classify_buildings(
    rows: Iterable[BuildingRow], places: Iterable[PlaceRow]
) -> Classification:
    """Apply the two evidence tiers; report — never guess — the middle."""
    rows = tuple(rows)
    places = tuple(places)
    by_way: Mapping[int, BuildingRow] = {row.way_id: row for row in rows}

    direct = {
        row.way_id for row in rows if _is_brown(row.operator) or _is_brown(row.owner)
    }

    catalog: set[int] = set()
    conflicts: set[int] = set()
    missing_from_export: set[int] = set()
    place_by_way: dict[int, str] = {}
    relation_place_ids: set[str] = set()
    other_place_ids: set[str] = set()
    for place in places:
        way_id = _way_number(place.osm_id)
        if way_id is not None:
            place_by_way[way_id] = place.id
        if place.kind in INSTITUTIONAL_KINDS:
            if way_id is not None:
                row = by_way.get(way_id)
                if row is None:
                    # A curated Brown footprint the export does not know —
                    # cross-snapshot drift, surfaced and gated, never assumed.
                    missing_from_export.add(way_id)
                    continue
                conflicting = (
                    row.operator is not None and not _is_brown(row.operator)
                ) or (row.owner is not None and not _is_brown(row.owner))
                if conflicting:
                    conflicts.add(way_id)
                else:
                    catalog.add(way_id)
            elif place.osm_id and place.osm_id.startswith("relation/"):
                relation_place_ids.add(place.id)
        elif place.kind == "other" and way_id is not None:
            other_place_ids.add(place.id)

    way_ids = direct | catalog
    place_ids = {
        place_by_way[way_id] for way_id in way_ids if way_id in place_by_way
    } | relation_place_ids

    ambiguous_hint = {
        row.way_id
        for row in rows
        if row.brown_relevant_hint and row.way_id not in way_ids
    }
    ambiguous_other = other_place_ids - place_ids

    return Classification(
        way_ids=tuple(sorted(way_ids)),
        direct_way_ids=tuple(sorted(direct)),
        catalog_way_ids=tuple(sorted(catalog)),
        place_ids=tuple(sorted(place_ids)),
        conflict_way_ids=tuple(sorted(conflicts)),
        catalog_ways_missing_from_export=tuple(sorted(missing_from_export)),
        ambiguous_hint_way_ids=tuple(sorted(ambiguous_hint)),
        ambiguous_other_place_ids=tuple(sorted(ambiguous_other)),
    )


def build_sidecar(
    classification: Classification, *, generated_at: datetime | None = None
) -> dict[str, object]:
    """The sidecar document, schema v1, deterministically ordered."""
    moment = generated_at or datetime.now(UTC)
    if moment.tzinfo is None:
        raise ValueError("generated_at must be timezone-aware")
    timestamp = moment.astimezone(UTC).isoformat().replace("+00:00", "Z")
    return {
        "schema_version": 1,
        "generated_at": timestamp,
        "attribution": ATTRIBUTION,
        "osm_way_ids": list(classification.way_ids),
        "place_ids": list(classification.place_ids),
    }


@dataclass(frozen=True)
class SnapshotDrift:
    """Way-id drift between the CSV export and the recorded fixture."""

    csv_only: tuple[int, ...]
    fixture_only: tuple[int, ...]


def snapshot_drift(
    csv_way_ids: Iterable[int], fixture_way_ids: Iterable[int]
) -> SnapshotDrift:
    csv_set = set(csv_way_ids)
    fixture_set = set(fixture_way_ids)
    return SnapshotDrift(
        csv_only=tuple(sorted(csv_set - fixture_set)),
        fixture_only=tuple(sorted(fixture_set - csv_set)),
    )


@dataclass(frozen=True)
class BrownOwnedBuildingsJobResult:
    """Everything one run measured, produced, and decided."""

    classification: Classification
    gate_failures: tuple[str, ...]  # empty means every gate passed
    published_count: int | None  # None: gates failed or dry run; file untouched


def _atomic_write_json(
    document: dict[str, object], destination: Path, staging_root: Path
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging_root.mkdir(parents=True, exist_ok=True)
    staging_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=staging_root,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as staging_file:
            staging_path = Path(staging_file.name)
            json.dump(
                document, staging_file, indent=2, ensure_ascii=False, allow_nan=False
            )
            staging_file.write("\n")
            staging_file.flush()
            os.fsync(staging_file.fileno())
        os.replace(staging_path, destination)
    finally:
        if staging_path is not None:
            staging_path.unlink(missing_ok=True)


def run_brown_owned_buildings_job(
    *,
    csv_path: Path | str = DEFAULT_CSV_PATH,
    sidecar_path: Path | str | None,
    staging_root: Path | str | None,
    aliases_path: Path | None = None,
    overpass_path: Path | None = None,
    min_rows: int = MIN_CSV_ROWS,
) -> BrownOwnedBuildingsJobResult:
    """Classify the export; publish the sidecar only on green gates.

    ``sidecar_path=None`` is a dry run: gates are still evaluated but
    nothing is written. Gates fail closed — a thin export, an empty
    classification, an operator conflict on a curated way, or a dropped
    catalog entry blocks publication and leaves any existing sidecar
    untouched.
    """
    rows = load_buildings_csv(csv_path)
    build = build_catalog_from_files(aliases_path, overpass_path)
    classification = classify_buildings(rows, build.rows)

    gate_failures: list[str] = []
    if len(rows) < min_rows:
        gate_failures.append(f"csv-rows: {len(rows)} < required {min_rows}")
    if not classification.way_ids:
        gate_failures.append("empty-classification: no Brown-owned ways found")
    if classification.conflict_way_ids:
        gate_failures.append(
            "operator-conflict: "
            + ", ".join(str(way_id) for way_id in classification.conflict_way_ids)
        )
    if classification.catalog_ways_missing_from_export:
        gate_failures.append(
            "catalog-ways-missing-from-export: "
            + ", ".join(
                str(way_id)
                for way_id in classification.catalog_ways_missing_from_export
            )
        )
    dropped = [diagnostic for diagnostic in build.diagnostics if diagnostic.dropped]
    if dropped:
        gate_failures.append(
            "dropped-catalog-entries: "
            + ", ".join(diagnostic.place_id for diagnostic in dropped)
        )

    published_count: int | None = None
    if not gate_failures and sidecar_path is not None:
        if staging_root is None:
            raise ValueError("staging_root is required to publish the sidecar")
        document = build_sidecar(classification)
        _atomic_write_json(document, Path(sidecar_path), Path(staging_root))
        published_count = len(classification.way_ids)

    return BrownOwnedBuildingsJobResult(
        classification=classification,
        gate_failures=tuple(gate_failures),
        published_count=published_count,
    )
