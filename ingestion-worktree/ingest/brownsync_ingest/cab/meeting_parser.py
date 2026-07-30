"""The ``meeting_schedule`` grammar of the Fall 2026 CAB export.

Measured grammar (see the Task 6 brief; every scheduled row of the pinned
export parses under it):

    schedule       := "TBA" | "" | pattern (" | " pattern)*
    pattern        := DAYS " " time "-" time [" in " location] [" (" m/d " to " m/d ")"]
    DAYS           := canonical contract tokens M,T,W,Th,F,S,Su, unique, in order
    time           := h[":"mm]("am"|"pm")

``TBA``, empty, malformed, and non-positive-duration schedules become
structured skips with explicit reasons — nothing is dropped silently.
"""

from __future__ import annotations

from datetime import time
import re

from brownsync_ingest.cab.models import MeetingPattern, ParsedSchedule
from brownsync_ingest.policy import validate_cab_temporal_plausibility


SKIP_ARRANGED = "arranged-tba"
SKIP_ONLINE = "online-no-schedule"
SKIP_CROSS_LISTED = "cross-listed-reference"
SKIP_EMPTY = "empty-schedule"
SKIP_UNPARSEABLE = "unparseable-schedule"
SKIP_IMPLAUSIBLE = "implausible-times"

_PATTERN_SEPARATOR = " | "
_TIME = re.compile(r"(?P<hour>\d{1,2})(?::(?P<minute>[0-5]\d))?(?P<meridiem>am|pm)\Z")
_PATTERN = re.compile(
    r"(?P<days>[A-Za-z]+)"
    r" (?P<start>\d{1,2}(?::[0-5]\d)?(?:am|pm))"
    r"-(?P<end>\d{1,2}(?::[0-5]\d)?(?:am|pm))"
    r"(?: in (?P<location>.+?))?"
    r"(?: \((?P<bound_start>\d{1,2}/\d{1,2}) to (?P<bound_end>\d{1,2}/\d{1,2})\))?"
    r"\Z"
)

_DAY_TOKENS = ("M", "T", "W", "Th", "F", "S", "Su")
_LONGEST_FIRST = ("Th", "Su", "M", "T", "W", "F", "S")


class MeetingScheduleError(ValueError):
    """A schedule fragment that does not fit the measured grammar."""


def parse_time_12h(text: str) -> time:
    """Normalize a 12-hour clock reading (``10:30am``, ``1pm``) to a time."""
    match = _TIME.fullmatch(text)
    if match is None:
        raise MeetingScheduleError(f"malformed 12-hour time {text!r}")
    hour = int(match.group("hour"))
    minute = int(match.group("minute") or 0)
    if not 1 <= hour <= 12:
        raise MeetingScheduleError(f"12-hour clock hour out of range in {text!r}")
    if match.group("meridiem") == "pm":
        if hour != 12:
            hour += 12
    elif hour == 12:
        hour = 0
    return time(hour, minute)


def parse_days(text: str) -> str:
    """Validate canonical contract day tokens; return the string verbatim."""
    cursor = 0
    last_index = -1
    while cursor < len(text):
        token = next(
            (candidate for candidate in _LONGEST_FIRST if text.startswith(candidate, cursor)),
            None,
        )
        if token is None:
            raise MeetingScheduleError(f"unknown day token in {text!r}")
        token_index = _DAY_TOKENS.index(token)
        if token_index <= last_index:
            raise MeetingScheduleError(f"day tokens out of canonical order in {text!r}")
        last_index = token_index
        cursor += len(token)
    if last_index == -1:
        raise MeetingScheduleError("empty day string")
    return text


def _skip_reason_for_blank(schedule: str, location_status: str) -> str:
    if schedule == "TBA":
        return SKIP_ARRANGED
    if location_status == "Online":
        return SKIP_ONLINE
    if location_status == "Cross-listed reference":
        return SKIP_CROSS_LISTED
    return SKIP_EMPTY


def _parse_pattern(text: str) -> MeetingPattern:
    match = _PATTERN.fullmatch(text)
    if match is None:
        raise MeetingScheduleError(f"schedule pattern {text!r} does not fit the grammar")
    days = parse_days(match.group("days"))
    start = parse_time_12h(match.group("start"))
    end = parse_time_12h(match.group("end"))
    bounds = (
        (match.group("bound_start"), match.group("bound_end"))
        if match.group("bound_start")
        else None
    )
    return MeetingPattern(
        days=days,
        start_time=start,
        end_time=end,
        embedded_location=match.group("location"),
        date_bounds=bounds,
        text=text,
    )


def parse_meeting_schedule(text: str, location_status: str) -> ParsedSchedule:
    """Parse one ``meeting_schedule`` cell into patterns or a structured skip."""
    stripped = text.strip()
    if not stripped or stripped == "TBA":
        return ParsedSchedule(skip_reason=_skip_reason_for_blank(stripped, location_status))
    patterns: list[MeetingPattern] = []
    for fragment in stripped.split(_PATTERN_SEPARATOR):
        try:
            pattern = _parse_pattern(fragment)
        except MeetingScheduleError:
            # one bad sub-pattern skips the whole section: emitting half a
            # section would be silent data loss
            return ParsedSchedule(skip_reason=SKIP_UNPARSEABLE)
        try:
            validate_cab_temporal_plausibility(
                pattern.days, pattern.start_time, pattern.end_time
            )
        except ValueError:
            return ParsedSchedule(skip_reason=SKIP_IMPLAUSIBLE)
        patterns.append(pattern)
    return ParsedSchedule(patterns=tuple(patterns))
