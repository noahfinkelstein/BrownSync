"""CAB-internal value objects (never written to seed files directly)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time
from typing import Mapping


@dataclass(frozen=True)
class CabCsvRecord:
    """One logical row of the user-provided export, columns verbatim.

    ``cancelled`` is the only parsed field; ``raw`` preserves every column
    exactly as read (BOM-free header, quoted commas/newlines resolved by the
    CSV reader, cell text untouched).
    """

    term: str
    term_code: str
    course_code: str
    course_title: str
    section: str
    crn: str
    meeting_schedule: str
    location: str
    location_status: str
    instructor: str
    schedule_type_code: str
    class_status: str
    cab_status_code: str
    cancelled: bool
    start_date: str
    end_date: str
    cab_schedule_and_location: str
    source_url: str
    raw: Mapping[str, str]


@dataclass(frozen=True)
class MeetingPattern:
    """One weekly meeting pattern parsed out of ``meeting_schedule``."""

    days: str  # canonical contract tokens, verbatim from the source
    start_time: time
    end_time: time
    embedded_location: str | None  # the " in <location>" suffix, verbatim
    date_bounds: tuple[str, str] | None  # the " (m/d to m/d)" suffix
    text: str  # the sub-pattern exactly as written


@dataclass(frozen=True)
class ParsedSchedule:
    """The outcome of parsing one ``meeting_schedule`` cell.

    Exactly one of ``patterns`` (non-empty) or ``skip_reason`` is set: a
    schedule either yields meeting patterns or becomes a structured skip.
    """

    patterns: tuple[MeetingPattern, ...] = ()
    skip_reason: str | None = None

    def __post_init__(self) -> None:
        if bool(self.patterns) == (self.skip_reason is None):
            return
        raise ValueError("exactly one of patterns/skip_reason must be set")


@dataclass(frozen=True)
class SkippedSection:
    """A section that emitted no meeting rows, with its structured reason."""

    term_code: str
    crn: str
    course_code: str
    reason: str
    location_status: str
    meeting_schedule: str


@dataclass(frozen=True)
class GateCheck:
    """One fail-closed publication gate with its measured value."""

    name: str
    required: float
    actual: float
    passed: bool


@dataclass(frozen=True)
class CabGates:
    """All publication gates for one job run."""

    checks: tuple[GateCheck, ...]

    @property
    def passed(self) -> bool:
        return all(check.passed for check in self.checks)
