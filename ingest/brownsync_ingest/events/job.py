"""The events bootstrap job: two hash-pinned exports -> ``events.ndjson``
behind fail-closed gates.

Sources (both from the 2026-07-29 user-provided Codex CSV pack):

1. ``brown_upcoming_events.csv`` — 1,000 LiveWhale event instances,
   normalized poller-parity (``events/livewhale.py``): the TS poller
   refreshes these rows live post-deploy and upserts on
   ``(source, source_id)``, so the bootstrap converges instead of forking.
2. ``brown_academic_calendar_2026_2027.csv`` — registrar entries, emitted
   as ``source="registrar"`` / ``category="admin"``
   (``events/registrar.py``).

Publication gates (any failure publishes NOTHING; the previous seed file
stays authoritative):

- ``coords``: >= 300 non-canceled LiveWhale rows with both coordinates —
  the app handoff §4 Definition of Done ("≥ 300 upcoming LiveWhale events
  rendered with coords"); measured 379.
- ``livewhale_events``: >= 900 rows (0.9 × the 1,000-row pinned export);
- ``admin_events``: >= 100 registrar rows (110-row export minus its
  listed month-section duplicates; measured 106);
- ``vocabulary``: zero unknown ``online_type`` values — place-resolution
  behavior depends on that column, so drift fails loudly. Unknown
  ``event_types`` values are deliberately NOT a gate: the poller
  categorizes them by fall-through and parity wins (documented in
  ``mappings/categories.py``) — they are still counted and reported.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from brownsync_ingest.contract import EventRow
from brownsync_ingest.events.csv_source import (
    load_academic_calendar_csv,
    load_upcoming_events_csv,
)
from brownsync_ingest.events.livewhale import (
    SupportsResolve,
    UpcomingDecision,
    load_org_livewhale_groups,
    normalize_upcoming_event,
)
from brownsync_ingest.events.models import EventsGates, GateCheck
from brownsync_ingest.events.registrar import normalize_registrar_entries
from brownsync_ingest.output import publish_ndjson


MIN_COORDS = 300  # app handoff §4 DoD, fail-closed
MIN_LIVEWHALE_EVENTS = 900
MIN_ADMIN_EVENTS = 100


@dataclass(frozen=True)
class EventsJobResult:
    """Everything one run measured, produced, and decided."""

    rows: tuple[EventRow, ...]  # livewhale rows then registrar rows
    livewhale_count: int
    admin_count: int
    coords_count: int  # non-canceled livewhale rows with lat+lng
    canceled_count: int
    online_only_count: int
    hybrid_count: int
    org_attributed: int
    resolution_methods: Mapping[str, int]  # exact|exact-room|trigram
    unresolved_reasons: Mapping[str, int]  # below-threshold|ambiguous|…
    place_resolved: int
    unknown_event_types: tuple[tuple[str, int], ...]  # reported, not fatal
    unknown_vocabulary: tuple[str, ...]  # online_type drift — gate
    dropped_contact_counts: tuple[tuple[str, int], ...]
    registrar_duplicates_dropped: int
    cross_source_overlap: int  # registrar ids also present as livewhale ids
    gates: EventsGates
    published_count: int | None  # None: gates failed, seeds untouched


def _gates(
    *,
    coords_count: int,
    livewhale_count: int,
    admin_count: int,
    unknown_vocabulary: tuple[str, ...],
    min_coords: int,
    min_livewhale: int,
    min_admin: int,
) -> EventsGates:
    return EventsGates(
        checks=(
            GateCheck(
                name="coords",
                required=float(min_coords),
                actual=float(coords_count),
                passed=coords_count >= min_coords,
            ),
            GateCheck(
                name="livewhale_events",
                required=float(min_livewhale),
                actual=float(livewhale_count),
                passed=livewhale_count >= min_livewhale,
            ),
            GateCheck(
                name="admin_events",
                required=float(min_admin),
                actual=float(admin_count),
                passed=admin_count >= min_admin,
            ),
            GateCheck(
                name="vocabulary",
                required=0.0,
                actual=float(len(unknown_vocabulary)),
                passed=not unknown_vocabulary,
            ),
        )
    )


def run_events_job(
    events_csv_path: Path | str,
    calendar_csv_path: Path | str,
    *,
    org_groups_path: Path | str,
    resolver: SupportsResolve,
    seeds_path: Path | str,
    staging_root: Path | str,
    min_coords: int = MIN_COORDS,
    min_livewhale: int = MIN_LIVEWHALE_EVENTS,
    min_admin: int = MIN_ADMIN_EVENTS,
) -> EventsJobResult:
    """Run the whole pipeline; publish only when every gate passes."""
    org_by_group = load_org_livewhale_groups(org_groups_path)

    decisions: list[UpcomingDecision] = [
        normalize_upcoming_event(
            record, org_by_group=org_by_group, resolver=resolver
        )
        for record in load_upcoming_events_csv(events_csv_path)
    ]
    registrar = normalize_registrar_entries(
        load_academic_calendar_csv(calendar_csv_path)
    )

    coords_count = sum(
        1
        for decision in decisions
        if decision.row.lat is not None and not decision.row.is_canceled
    )
    resolution_methods: Counter[str] = Counter()
    unresolved_reasons: Counter[str] = Counter()
    for decision in decisions:
        if decision.resolution is None:
            continue
        if decision.resolution.place_id is not None:
            resolution_methods[decision.resolution.method] += 1
        else:
            unresolved_reasons[decision.resolution.reason or "unknown"] += 1
    unknown_types: Counter[str] = Counter()
    for decision in decisions:
        for value in decision.unknown_event_types:
            unknown_types[value] += 1
    unknown_vocabulary = tuple(
        sorted(
            {
                f"online_type={decision.unknown_online_type!r}"
                for decision in decisions
                if decision.unknown_online_type is not None
            }
        )
    )
    dropped_contacts: Counter[str] = Counter()
    for decision in decisions:
        for column in decision.dropped_contact_columns:
            dropped_contacts[column] += 1

    livewhale_ids = {
        decision.row.source_id.split(":", 1)[0] for decision in decisions
    }
    cross_source_overlap = sum(
        1 for row in registrar.rows if row.source_id in livewhale_ids
    )

    rows: tuple[EventRow, ...] = tuple(
        decision.row for decision in decisions
    ) + registrar.rows

    gates = _gates(
        coords_count=coords_count,
        livewhale_count=len(decisions),
        admin_count=len(registrar.rows),
        unknown_vocabulary=unknown_vocabulary,
        min_coords=min_coords,
        min_livewhale=min_livewhale,
        min_admin=min_admin,
    )

    published_count: int | None = None
    if gates.passed:
        published_count = publish_ndjson(
            rows, EventRow, Path(seeds_path), Path(staging_root)
        )

    return EventsJobResult(
        rows=rows,
        livewhale_count=len(decisions),
        admin_count=len(registrar.rows),
        coords_count=coords_count,
        canceled_count=sum(
            1 for decision in decisions if decision.row.is_canceled
        ),
        online_only_count=sum(
            1
            for decision in decisions
            if decision.row.raw is not None
            and isinstance(decision.row.raw, dict)
            and decision.row.raw.get("online_type") == "Online only"
        ),
        hybrid_count=sum(
            1
            for decision in decisions
            if decision.row.raw is not None
            and isinstance(decision.row.raw, dict)
            and decision.row.raw.get("online_type") == "Hybrid"
        ),
        org_attributed=sum(
            1 for decision in decisions if decision.org_attributed
        ),
        resolution_methods=dict(resolution_methods),
        unresolved_reasons=dict(unresolved_reasons),
        place_resolved=sum(resolution_methods.values()),
        unknown_event_types=tuple(sorted(unknown_types.items())),
        unknown_vocabulary=unknown_vocabulary,
        dropped_contact_counts=tuple(sorted(dropped_contacts.items())),
        registrar_duplicates_dropped=registrar.duplicates_dropped,
        cross_source_overlap=cross_source_overlap,
        gates=gates,
        published_count=published_count,
    )
