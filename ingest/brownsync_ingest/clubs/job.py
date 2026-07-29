"""The clubs job: export records -> contract organization rows behind
fail-closed gates, plus the schema-v1 LiveWhale linkage sidecar.

Publication policy (plan Task 7, adapted to the user-provided export):

1. ``organizations``: >= 400 distinct validated organization rows
   (457 measured in the 2026-07-29 export);
2. ``vocabulary``: zero unknown ``group_type``/``funding_category``/``tags``
   values — source drift fails loudly, never nulls silently (see
   ``mappings/categories.py``).

Any gate failure publishes NOTHING: neither ``organizations.ndjson`` nor
the sidecar is touched, while linkage and evidence statistics are still
returned for reporting.

Emission rules (measured; task-7-brief.md):

- id: ``slugify(name)`` + ``unique_slug`` assigned in source order (the
  export is hash-pinned, so assignment is deterministic);
- kind/category via the explicit vocabulary tables; every current category
  is None-with-reasons — nothing is guessed from names or descriptions;
- url: ``website_url`` > org-specific ``source_url`` (differs from the
  shared directory URL) > None; instagram: ``instagram_url`` or None;
- description: stripped, empty -> None;
- source: ``studentactivities`` (undergraduate) / ``gsc`` (graduate);
- published directory contact data (``contact_emails``, ``advisor``) and
  socials without a contract column (``facebook_url`` etc.) are DROPPED
  with per-column counts — contract v1 has no field for them and inventing
  fields is forbidden;
- default_place_id: only through the linked LiveWhale group with >= 3
  resolved venue observations and >= 75% winner share (``default_place.py``);
- recurring events: only with full temporal evidence (``recurrences.py``) —
  the export carries none, so the measured emission count is zero.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Mapping

from brownsync_ingest.clubs.csv_source import load_clubs_csv
from brownsync_ingest.clubs.default_place import (
    SupportsResolve,
    compute_default_places,
    load_event_observations,
)
from brownsync_ingest.clubs.livewhale import (
    build_organization_sidecar,
    link_club,
    load_livewhale_groups,
)
from brownsync_ingest.clubs.models import (
    ClubRecord,
    ClubsGates,
    DefaultPlaceEvidence,
    GateCheck,
    LinkDecision,
)
from brownsync_ingest.clubs.recurrences import evaluate_recurrence, evidence_from_record
from brownsync_ingest.common.identifiers import slugify, unique_slug
from brownsync_ingest.contract import OrganizationRow
from brownsync_ingest.mappings.categories import (
    UnmappedSourceValueError,
    map_club_category,
    map_club_kind,
)
from brownsync_ingest.output import publish_json_document, publish_ndjson


MIN_ORGANIZATIONS = 400

SOURCE_BY_GROUP_TYPE = {
    "Undergraduate student group": "studentactivities",
    "Graduate student group": "gsc",
}

# Export columns with NO contract organization field: dropped, counted,
# reported — never silently and never invented into the row.
DROPPED_FIELD_COLUMNS: tuple[str, ...] = (
    "contact_emails",
    "advisor",
    "facebook_url",
    "linkedin_url",
    "youtube_url",
    "twitter_url",
    "tiktok_url",
    "other_social_urls",
)


@dataclass(frozen=True)
class ClubsJobResult:
    """Everything one run measured, produced, and decided."""

    rows: tuple[OrganizationRow, ...]
    duplicates_dropped: int
    link_decisions: tuple[LinkDecision, ...]
    default_place_evidence: Mapping[str, DefaultPlaceEvidence]
    event_skip_counts: Mapping[str, int]
    recurrence_emissions: int
    unknown_vocabulary: tuple[str, ...]  # sorted "column='value'" strings
    dropped_fields: tuple[tuple[str, int], ...]  # column -> non-empty count
    gates: ClubsGates
    published_count: int | None  # None: gates failed, seeds untouched
    sidecar_mappings: int | None  # None: gates failed, sidecar untouched


def _organization_url(record: ClubRecord) -> str | None:
    if record.website_url:
        return record.website_url
    if record.source_url and record.source_url != record.directory_source_url:
        return record.source_url
    return None


def _gates(
    row_count: int, unknown_vocabulary: tuple[str, ...], min_organizations: int
) -> ClubsGates:
    return ClubsGates(
        checks=(
            GateCheck(
                name="organizations",
                required=float(min_organizations),
                actual=float(row_count),
                passed=row_count >= min_organizations,
            ),
            GateCheck(
                name="vocabulary",
                required=0.0,
                actual=float(len(unknown_vocabulary)),
                passed=not unknown_vocabulary,
            ),
        )
    )


def run_clubs_job(
    clubs_csv_path: Path | str,
    *,
    groups_path: Path | str,
    events_csv_path: Path | str,
    resolver: SupportsResolve,
    seeds_path: Path | str,
    sidecar_path: Path | str,
    staging_root: Path | str,
    sidecar_staging_root: Path | str | None = None,
    min_organizations: int = MIN_ORGANIZATIONS,
    generated_at: datetime | None = None,
) -> ClubsJobResult:
    """Run the whole pipeline; publish only when every gate passes."""
    records, duplicates_dropped = load_clubs_csv(clubs_csv_path)
    groups = load_livewhale_groups(groups_path)
    group_titles = tuple(group.title for group in groups)

    # Slug assignment in source order; vocabulary drift is collected (not
    # raised) so the run reports EVERY unknown value in one pass.
    unknown_vocabulary: set[str] = set()
    prepared: list[tuple[ClubRecord, str]] = []  # (record, slug)
    taken: set[str] = set()
    for record in records:
        try:
            map_club_kind(record.group_type)
            map_club_category(
                funding_category=record.funding_category, tags=record.tags
            )
        except UnmappedSourceValueError as exc:
            unknown_vocabulary.add(f"{exc.column}={exc.value!r}")
            continue
        slug = unique_slug(slugify(record.name), taken)
        taken.add(slug)
        prepared.append((record, slug))

    link_decisions = tuple(
        link_club(slug, record.name, group_titles) for record, slug in prepared
    )
    observations, event_skip_counts = load_event_observations(events_csv_path)
    default_place_evidence = compute_default_places(
        link_decisions, observations, resolver
    )

    recurrence_emissions = sum(
        1
        for record, _ in prepared
        if evaluate_recurrence(evidence_from_record(record)).emit
    )

    rows: list[OrganizationRow] = []
    dropped_counts = {column: 0 for column in DROPPED_FIELD_COLUMNS}
    for record, slug in prepared:
        for column in DROPPED_FIELD_COLUMNS:
            if record.raw.get(column, "").strip():
                dropped_counts[column] += 1
        evidence = default_place_evidence.get(slug)
        rows.append(
            OrganizationRow(
                id=slug,
                name=record.name,
                kind=map_club_kind(record.group_type),
                category=map_club_category(
                    funding_category=record.funding_category, tags=record.tags
                ).category,
                description=record.description.strip() or None,
                url=_organization_url(record),
                instagram=record.instagram_url or None,
                default_place_id=(
                    evidence.winner_place_id
                    if evidence is not None and evidence.awarded
                    else None
                ),
                source=SOURCE_BY_GROUP_TYPE[record.group_type],
            )
        )

    gates = _gates(len(rows), tuple(sorted(unknown_vocabulary)), min_organizations)

    published_count: int | None = None
    sidecar_mappings: int | None = None
    if gates.passed:
        published_count = publish_ndjson(
            rows, OrganizationRow, Path(seeds_path), Path(staging_root)
        )
        document = build_organization_sidecar(
            link_decisions, generated_at=generated_at or datetime.now(UTC)
        )
        # The sidecar may live on a different filesystem than the row seeds
        # (postgres hybrid: rows go to a scratch dir, the sidecar stays in
        # db/seeds/), and os.replace demands same-filesystem staging.
        publish_json_document(
            document,
            Path(sidecar_path),
            Path(sidecar_staging_root if sidecar_staging_root is not None else staging_root),
        )
        sidecar_mappings = len(document["mappings"])  # type: ignore[arg-type]

    return ClubsJobResult(
        rows=tuple(rows),
        duplicates_dropped=duplicates_dropped,
        link_decisions=link_decisions,
        default_place_evidence=default_place_evidence,
        event_skip_counts=event_skip_counts,
        recurrence_emissions=recurrence_emissions,
        unknown_vocabulary=tuple(sorted(unknown_vocabulary)),
        dropped_fields=tuple(dropped_counts.items()),
        gates=gates,
        published_count=published_count,
        sidecar_mappings=sidecar_mappings,
    )
