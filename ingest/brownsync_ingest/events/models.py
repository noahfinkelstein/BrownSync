"""Records and result shapes for the events bootstrap job."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class UpcomingEventRecord:
    """One row of ``brown_upcoming_events.csv``, values verbatim."""

    event_id: str
    title: str
    start_date_iso: str
    end_date_iso: str
    all_day: str
    canceled: str
    online: str
    online_type: str
    location: str
    latitude: str
    longitude: str
    cost: str
    organizer: str
    event_types: str
    tags: str
    source_url: str
    raw: dict[str, str]


@dataclass(frozen=True)
class RegistrarEntry:
    """One row of ``brown_academic_calendar_2026_2027.csv``, verbatim."""

    academic_term: str
    month: str
    start_date_display: str
    end_date_display: str
    event: str
    event_url: str
    source_url: str
    raw: dict[str, str]


@dataclass(frozen=True)
class GateCheck:
    """One named publication gate with its threshold and measured value."""

    name: str
    required: float
    actual: float
    passed: bool


@dataclass(frozen=True)
class EventsGates:
    checks: tuple[GateCheck, ...]

    @property
    def passed(self) -> bool:
        return all(check.passed for check in self.checks)
