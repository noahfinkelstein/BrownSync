"""Behavioral tests for the CAB value objects' fail-closed invariants."""
from __future__ import annotations

from datetime import time

import pytest

from brownsync_ingest.cab.models import GateCheck, CabGates, MeetingPattern, ParsedSchedule


def _pattern(text: str = "MWF 9-9:50a") -> MeetingPattern:
    return MeetingPattern(
        days="MWF",
        start_time=time(9, 0),
        end_time=time(9, 50),
        embedded_location=None,
        date_bounds=None,
        text=text,
    )


class TestParsedScheduleInvariant:
    """Exactly one of patterns/skip_reason is set — the parser can never emit
    a schedule that is both parsed and skipped, or neither."""

    def test_patterns_without_skip_reason_is_a_valid_parse(self) -> None:
        schedule = ParsedSchedule(patterns=(_pattern(),))
        assert schedule.skip_reason is None
        assert schedule.patterns[0].days == "MWF"

    def test_skip_reason_without_patterns_is_a_valid_structured_skip(self) -> None:
        schedule = ParsedSchedule(skip_reason="arranged-tba")
        assert schedule.patterns == ()

    def test_a_schedule_with_both_patterns_and_skip_reason_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="exactly one of patterns/skip_reason"):
            ParsedSchedule(patterns=(_pattern(),), skip_reason="arranged-tba")

    def test_a_schedule_with_neither_patterns_nor_skip_reason_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="exactly one of patterns/skip_reason"):
            ParsedSchedule()


class TestCabGates:
    def test_gates_pass_only_when_every_check_passed(self) -> None:
        ok = GateCheck(name="subjects", required=50, actual=81, passed=True)
        bad = GateCheck(name="meeting-rows", required=1500, actual=1400, passed=False)
        assert CabGates(checks=(ok,)).passed is True
        assert CabGates(checks=(ok, bad)).passed is False
