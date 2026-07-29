"""Evidence gate for recurring club events (plan Task 7).

A recurring club event may be emitted ONLY with source evidence for every
one of: weekday, local start time, effective start date, bounded end,
duration (or end time), and a physical venue. Evidence comes exclusively
from STRUCTURED source columns — free-text descriptions are never parsed,
so vague prose ("we meet Fridays at 5") can never become an event.

The 2026-07-29 clubs export (``brown_all_student_groups.csv``) carries no
structured temporal columns at all, so :func:`evidence_from_record` returns
all-``None`` for every record and the job emits zero events. No rrule
builder exists on this branch: the plan's DST/expiration handling applies
to an emission path no current source can legitimately exercise, and
speculative machinery with no real input would be untestable against
production data. It lands with the first source that carries genuine
temporal evidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from brownsync_ingest.clubs.models import ClubRecord


# The six plan-mandated evidence fields, in plan order.
REQUIRED_EVIDENCE: tuple[str, ...] = (
    "weekday",
    "start_time_local",
    "duration_or_end_time",
    "effective_start",
    "bounded_end",
    "physical_venue",
)

# Structured export columns that could ever carry each evidence field.
# Measured against the 17-column export: NONE exist, hence every tuple is
# empty. Growing a tuple here (when the export grows a real column) is the
# only way evidence can appear — descriptions are not in any tuple by design.
EVIDENCE_COLUMNS: dict[str, tuple[str, ...]] = {field: () for field in REQUIRED_EVIDENCE}


@dataclass(frozen=True)
class RecurrenceDecision:
    """Whether full temporal evidence exists, and what is missing."""

    emit: bool
    missing: tuple[str, ...]


def evaluate_recurrence(evidence: Mapping[str, object | None]) -> RecurrenceDecision:
    """Emit only when every required field has non-blank evidence."""
    missing = tuple(
        field
        for field in REQUIRED_EVIDENCE
        if evidence.get(field) is None
        or (isinstance(evidence.get(field), str) and not str(evidence.get(field)).strip())
    )
    return RecurrenceDecision(emit=not missing, missing=missing)


def evidence_from_record(record: ClubRecord) -> dict[str, str | None]:
    """Extract structured temporal evidence from one export record.

    Only the columns registered in :data:`EVIDENCE_COLUMNS` are consulted;
    the description is deliberately never read.
    """
    evidence: dict[str, str | None] = {}
    for field in REQUIRED_EVIDENCE:
        value: str | None = None
        for column in EVIDENCE_COLUMNS[field]:
            candidate = record.raw.get(column, "").strip()
            if candidate:
                value = candidate
                break
        evidence[field] = value
    return evidence
