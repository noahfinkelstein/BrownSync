"""Registrar academic-calendar entries -> contract EventRows.

Contract §1 declares ``events.source`` as an OPEN set (``'livewhale'|…|
'manual'|...``) and the app-side ``SeedEventSchema`` pins only
``z.string().min(1)`` — ``registrar`` is a permitted source value.
Category is ``admin`` (§4: deadlines, university ops) for every entry.

The export prints dates as ``"Www, Mmm D"`` with NO year; the year is
derived fail-closed by weekday validation: candidates are
``{term_year - 1, term_year}`` (end dates: ``{start_year,
start_year + 1}``, not before the start), and the weekday NAME printed by
the registrar must match exactly one candidate. Consecutive years can
never share a weekday for the same calendar date (the offset shifts by
1 or 2 days), so a match is provably unique; zero matches — or a
malformed display — raise instead of guessing. Measured: 110/110 rows
resolve, 2026-03-23 → 2027-05-29, and the Winter-2027 December rows land
in 2026 exactly as their printed weekdays prove.

Timestamps follow contract §2 (source-local is America/New_York):
all-day entries at 00:00 New York — LiveWhale's own all-day convention —
with ``zoneinfo`` handling EST/EDT.

``source_id`` is the numeric LiveWhale event id embedded in every
``event_url`` (``/event/<id>-slug``; 110/110 rows carry one). The same
entry listed under two month sections is a duplicate id — verified
non-divergent on (event, dates, term) and first-wins deduped with a
count; a DIVERGENT duplicate raises. 21 of the 106 distinct entries also
appear in the LiveWhale snapshot as ``livewhale``-source rows;
cross-source duplicates are the app lane's ``canonical_id`` concern
(contract §1) — reported, never suppressed here.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import re
from zoneinfo import ZoneInfo

from brownsync_ingest.contract import EventRow
from brownsync_ingest.events.models import RegistrarEntry


SOURCE = "registrar"
CATEGORY = "admin"

NEW_YORK = ZoneInfo("America/New_York")

_DISPLAY_DATE = re.compile(r"([A-Z][a-z]{2}), ([A-Z][a-z]{2}) (\d{1,2})")
_EVENT_URL_ID = re.compile(r"/event/(\d+)(?:-|$)")

_WEEKDAYS = {
    "Mon": 0,
    "Tue": 1,
    "Wed": 2,
    "Thu": 3,
    "Fri": 4,
    "Sat": 5,
    "Sun": 6,
}
_MONTHS = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}
_TERM = re.compile(r"^(?:Summer|Fall|Winter|Spring) (\d{4})$")


class RegistrarCalendarError(ValueError):
    """A calendar entry cannot be normalized without guessing."""


def term_year(academic_term: str) -> int:
    match = _TERM.fullmatch(academic_term.strip())
    if match is None:
        raise RegistrarCalendarError(
            f"unrecognized academic_term {academic_term!r}"
        )
    return int(match.group(1))


def resolve_display_date(
    display: str, candidate_years: tuple[int, int]
) -> date:
    """``"Www, Mmm D"`` -> the unique candidate-year date whose real
    weekday matches the printed weekday name; anything else raises."""
    match = _DISPLAY_DATE.fullmatch(display.strip())
    if match is None:
        raise RegistrarCalendarError(
            f"unparseable display date {display!r}"
        )
    weekday_name, month_name, day_text = match.groups()
    weekday = _WEEKDAYS.get(weekday_name)
    month = _MONTHS.get(month_name)
    if weekday is None or month is None:
        raise RegistrarCalendarError(
            f"unrecognized weekday or month in {display!r}"
        )
    matches: list[date] = []
    for year in candidate_years:
        try:
            candidate = date(year, month, int(day_text))
        except ValueError:
            continue  # e.g. Feb 29 outside a leap year
        if candidate.weekday() == weekday:
            matches.append(candidate)
    if len(matches) != 1:
        raise RegistrarCalendarError(
            f"display date {display!r} matches {len(matches)} of the "
            f"candidate years {candidate_years} by weekday — refusing to "
            "guess"
        )
    return matches[0]


def source_id_for(entry: RegistrarEntry) -> str:
    """The numeric LiveWhale event id embedded in ``event_url``."""
    match = _EVENT_URL_ID.search(entry.event_url)
    if match is None:
        raise RegistrarCalendarError(
            f"event_url {entry.event_url!r} carries no /event/<id> — no "
            "stable source_id can be derived"
        )
    return match.group(1)


def _midnight_new_york(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=NEW_YORK)


def normalize_registrar_entry(entry: RegistrarEntry) -> EventRow:
    """One calendar entry -> one contract EventRow (category admin)."""
    title = entry.event.strip()
    if not title:
        raise RegistrarCalendarError("a calendar entry has empty event text")
    year = term_year(entry.academic_term)
    start = resolve_display_date(entry.start_date_display, (year - 1, year))
    end: date | None = None
    if entry.end_date_display.strip():
        end = resolve_display_date(
            entry.end_date_display, (start.year, start.year + 1)
        )
        if end < start:
            raise RegistrarCalendarError(
                f"entry {entry.event_url!r}: end {end} precedes start {start}"
            )
    return EventRow(
        source=SOURCE,
        source_id=source_id_for(entry),
        title=title,
        description=None,
        start_ts=_midnight_new_york(start),
        end_ts=_midnight_new_york(end) if end is not None else None,
        is_all_day=True,
        rrule=None,
        location_raw=None,
        place_id=None,
        lat=None,
        lng=None,
        org_id=None,
        category=CATEGORY,
        tags=[],
        url=entry.event_url.strip() or None,
        cost=None,
        confidence=1.0,
        is_canceled=False,
        raw=dict(entry.raw),
    )


@dataclass(frozen=True)
class RegistrarNormalization:
    """Deduped rows plus what the dedupe measured."""

    rows: tuple[EventRow, ...]
    duplicates_dropped: int


def normalize_registrar_entries(
    entries: tuple[RegistrarEntry, ...],
) -> RegistrarNormalization:
    """Normalize all entries, first-wins deduping duplicate ids.

    The registrar lists a multi-month entry once per month section; those
    duplicates must agree on (event, start, end, term) — a DIVERGENT
    duplicate id is source drift and raises.
    """
    rows: list[EventRow] = []
    seen: dict[str, tuple[str, str, str, str]] = {}
    dropped = 0
    for entry in entries:
        source_id = source_id_for(entry)
        signature = (
            entry.event,
            entry.start_date_display,
            entry.end_date_display,
            entry.academic_term,
        )
        existing = seen.get(source_id)
        if existing is not None:
            if existing != signature:
                raise RegistrarCalendarError(
                    f"duplicate calendar id {source_id} diverges: "
                    f"{existing!r} vs {signature!r}"
                )
            dropped += 1
            continue
        seen[source_id] = signature
        rows.append(normalize_registrar_entry(entry))
    return RegistrarNormalization(
        rows=tuple(rows), duplicates_dropped=dropped
    )
