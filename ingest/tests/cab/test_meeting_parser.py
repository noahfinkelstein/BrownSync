"""Meeting-schedule grammar tests.

Every vector in ``REAL_VECTORS`` is copied verbatim from
``ingest/fixtures/user_provided/brown_fall_2026_classes_and_locations.csv``
(the hash-pinned Task 6 source of record) and tagged with its CRN so the row
can be re-audited. Synthetic cases cover only shapes the export cannot
exhibit (malformed grammar, implausible times, 12am).
"""

from __future__ import annotations

import csv
from datetime import time
from pathlib import Path

import pytest

from brownsync_ingest.cab.meeting_parser import (
    MeetingScheduleError,
    parse_days,
    parse_meeting_schedule,
    parse_time_12h,
)

CSV_PATH = (
    Path(__file__).resolve().parents[2]
    / "fixtures"
    / "user_provided"
    / "brown_fall_2026_classes_and_locations.csv"
)

PUBLISHED = "Physical location published"
NOT_YET = "Physical location not yet published"


class TestParseTime12h:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("10:30am", time(10, 30)),
            ("11:50am", time(11, 50)),
            ("1pm", time(13, 0)),
            ("1:50pm", time(13, 50)),
            ("12pm", time(12, 0)),
            ("12:50pm", time(12, 50)),
            ("12am", time(0, 0)),
            ("9am", time(9, 0)),
            ("5:40pm", time(17, 40)),
        ],
    )
    def test_normalizes_twelve_hour_clock(self, text: str, expected: time) -> None:
        assert parse_time_12h(text) == expected

    @pytest.mark.parametrize("text", ["13pm", "0am", "25am", "1:60pm", "1:5pm", "1", "pm", "1 pm", ""])
    def test_rejects_malformed_times(self, text: str) -> None:
        with pytest.raises(MeetingScheduleError):
            parse_time_12h(text)


class TestParseDays:
    @pytest.mark.parametrize(
        "text", ["M", "T", "W", "Th", "F", "S", "Su", "MWF", "TTh", "MW", "MF", "MTh", "WF", "MTWTh", "MTThF", "MTWThF"]
    )
    def test_accepts_canonical_combinations_verbatim(self, text: str) -> None:
        assert parse_days(text) == text

    @pytest.mark.parametrize(
        "text",
        [
            "",  # empty
            "ThM",  # out of canonical order
            "TT",  # duplicate token
            "MM",  # duplicate token
            "XYZ",  # unknown letters
            "Mo",  # non-canonical token
            "SuS",  # out of canonical order
            "h",  # not a token
        ],
    )
    def test_rejects_non_canonical_day_strings(self, text: str) -> None:
        with pytest.raises(MeetingScheduleError):
            parse_days(text)


# (crn, meeting_schedule, location_status,
#  expected [(days, start, end, embedded_location, date_bounds)])
REAL_VECTORS = [
    ("15141", "TTh 10:30am-11:50am", PUBLISHED, [("TTh", time(10, 30), time(11, 50), None, None)]),
    ("15142", "MWF 1pm-1:50pm", PUBLISHED, [("MWF", time(13, 0), time(13, 50), None, None)]),
    ("15622", "TTh 2:30pm-3:50pm", PUBLISHED, [("TTh", time(14, 30), time(15, 50), None, None)]),
    # location column of this row is "Stephen Robert Hall, 280 Brook 101"
    # (quoted comma in the CSV); the schedule itself is plain.
    ("15258", "TTh 1pm-2:20pm", PUBLISHED, [("TTh", time(13, 0), time(14, 20), None, None)]),
    # sub-term halves of EDUC 2515/2535 carry explicit date bounds
    ("13610", "W 3pm-5:30pm (10/19 to 12/21)", PUBLISHED, [("W", time(15, 0), time(17, 30), None, ("10/19", "12/21"))]),
    ("13605", "W 3pm-5:30pm (9/9 to 10/16)", PUBLISHED, [("W", time(15, 0), time(17, 30), None, ("9/9", "10/16"))]),
    # cancelled=true row keeps parsing: cancellation is carried, not dropped
    (
        "13436",
        "MW 10am-10:50am | TTh 9am-10:20am",
        NOT_YET,
        [
            ("MW", time(10, 0), time(10, 50), None, None),
            ("TTh", time(9, 0), time(10, 20), None, None),
        ],
    ),
    (
        "13437",
        "MW 11am-11:50am | TTh 10:30am-11:50am",
        PUBLISHED,
        [
            ("MW", time(11, 0), time(11, 50), None, None),
            ("TTh", time(10, 30), time(11, 50), None, None),
        ],
    ),
    ("13564", "MTWTh 12pm-12:50pm", PUBLISHED, [("MTWTh", time(12, 0), time(12, 50), None, None)]),
    ("13536", "Su 12pm-12:50pm", PUBLISHED, [("Su", time(12, 0), time(12, 50), None, None)]),
    ("10097", "MTWThF 10:30am-12pm", NOT_YET, [("MTWThF", time(10, 30), time(12, 0), None, None)]),
    ("15687", "MF 9am-10:20am", PUBLISHED, [("MF", time(9, 0), time(10, 20), None, None)]),
    ("10020", "MTh 5:40pm-7pm", NOT_YET, [("MTh", time(17, 40), time(19, 0), None, None)]),
    ("14315", "MTThF 12pm-12:50pm", PUBLISHED, [("MTThF", time(12, 0), time(12, 50), None, None)]),
    ("14220", "WF 1pm-2:20pm", PUBLISHED, [("WF", time(13, 0), time(14, 20), None, None)]),
    # the 100 "Not published in CAB" rows embed the location in the schedule
    ("13993", "F 3pm-5:30pm in Nicholson House 101", NOT_YET, [("F", time(15, 0), time(17, 30), "Nicholson House 101", None)]),
    ("15530", "Th 9:30am-11am in Maddock Alumni Center 302", NOT_YET, [("Th", time(9, 30), time(11, 0), "Maddock Alumni Center 302", None)]),
    ("15568", "Th 1pm-3:30pm in 155 South Main Street - Packet 151", NOT_YET, [("Th", time(13, 0), time(15, 30), "155 South Main Street - Packet 151", None)]),
    # embedded location containing a comma
    ("15008", "TTh 10:30am-11:50am in 1 Euclid Ave, Nelson Ctr Entr 201", NOT_YET, [("TTh", time(10, 30), time(11, 50), "1 Euclid Ave, Nelson Ctr Entr 201", None)]),
    ("15196", "TTh 10:30am-11:50am in 271 Thayer Street 2NDFLOOR A", NOT_YET, [("TTh", time(10, 30), time(11, 50), "271 Thayer Street 2NDFLOOR A", None)]),
    ("16169", "T 4pm-6:30pm in National Press Building DC 975 968", NOT_YET, [("T", time(16, 0), time(18, 30), "National Press Building DC 975 968", None)]),
    ("13769", "F 12pm-12:50pm", PUBLISHED, [("F", time(12, 0), time(12, 50), None, None)]),
]

# (crn, meeting_schedule, location_status, expected skip reason)
REAL_SKIPS = [
    ("10162", "TBA", "TBA", "arranged-tba"),
    ("16294", "", "Online", "online-no-schedule"),
    ("15752", "", "Cross-listed reference", "cross-listed-reference"),
    # the one published row without any schedule (ARTS 1018, Granoff)
    ("15790", "", PUBLISHED, "empty-schedule"),
]


class TestRealScheduleVectors:
    @pytest.mark.parametrize(("crn", "schedule", "status", "expected"), REAL_VECTORS, ids=[v[0] for v in REAL_VECTORS])
    def test_parses_real_export_rows(
        self, crn: str, schedule: str, status: str, expected: list[tuple]
    ) -> None:
        parsed = parse_meeting_schedule(schedule, status)
        assert parsed.skip_reason is None
        got = [
            (p.days, p.start_time, p.end_time, p.embedded_location, p.date_bounds)
            for p in parsed.patterns
        ]
        assert got == expected

    @pytest.mark.parametrize(("crn", "schedule", "status", "reason"), REAL_SKIPS, ids=[v[0] for v in REAL_SKIPS])
    def test_structured_skips_carry_reasons(
        self, crn: str, schedule: str, status: str, reason: str
    ) -> None:
        parsed = parse_meeting_schedule(schedule, status)
        assert parsed.patterns == ()
        assert parsed.skip_reason == reason

    def test_pattern_text_is_the_verbatim_sub_pattern(self) -> None:
        parsed = parse_meeting_schedule("MW 10am-10:50am | TTh 9am-10:20am", NOT_YET)
        assert [p.text for p in parsed.patterns] == ["MW 10am-10:50am", "TTh 9am-10:20am"]


class TestSyntheticEdges:
    def test_whitespace_only_schedule_is_an_empty_schedule_skip(self) -> None:
        assert parse_meeting_schedule("   ", PUBLISHED).skip_reason == "empty-schedule"

    def test_tba_with_surrounding_whitespace_still_reads_as_arranged(self) -> None:
        assert parse_meeting_schedule(" TBA ", "TBA").skip_reason == "arranged-tba"

    @pytest.mark.parametrize(
        "schedule",
        [
            "MWF",  # no time range
            "1pm-2pm",  # no days
            "ThM 1pm-2pm",  # non-canonical day order
            "TT 1pm-2pm",  # duplicate day token
            "MWF 25am-26am",  # impossible hours
            "MWF 1pm–2pm",  # en dash, not the export's hyphen
            "MWF 1pm-2pm extra words",  # trailing junk without ' in '
            "tba",  # lowercase is not the export's TBA marker
        ],
    )
    def test_grammar_mismatch_is_an_unparseable_skip(self, schedule: str) -> None:
        parsed = parse_meeting_schedule(schedule, PUBLISHED)
        assert parsed.patterns == ()
        assert parsed.skip_reason == "unparseable-schedule"

    def test_one_bad_sub_pattern_skips_the_whole_section(self) -> None:
        parsed = parse_meeting_schedule("MWF 1pm-1:50pm | bogus", PUBLISHED)
        assert parsed.patterns == ()
        assert parsed.skip_reason == "unparseable-schedule"

    @pytest.mark.parametrize("schedule", ["M 2pm-1pm", "M 2pm-2pm", "M 1pm-12pm"])
    def test_non_positive_duration_is_an_implausible_times_skip(self, schedule: str) -> None:
        parsed = parse_meeting_schedule(schedule, PUBLISHED)
        assert parsed.patterns == ()
        assert parsed.skip_reason == "implausible-times"

    def test_twelve_am_normalizes_to_midnight(self) -> None:
        parsed = parse_meeting_schedule("Su 12am-1am", PUBLISHED)
        assert parsed.patterns[0].start_time == time(0, 0)
        assert parsed.patterns[0].end_time == time(1, 0)


class TestFullExportSweep:
    """Every scheduled row of the pinned export must parse: the grammar has

    no unexplained residue (0 unparseable / 0 implausible in the real data).
    """

    def test_every_real_schedule_parses_and_counts_match(self) -> None:
        with open(CSV_PATH, newline="", encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        assert len(rows) == 5275
        pattern_count = 0
        scheduled_rows = 0
        skip_reasons: dict[str, int] = {}
        for row in rows:
            parsed = parse_meeting_schedule(row["meeting_schedule"], row["location_status"])
            if parsed.skip_reason is not None:
                skip_reasons[parsed.skip_reason] = skip_reasons.get(parsed.skip_reason, 0) + 1
            else:
                scheduled_rows += 1
                pattern_count += len(parsed.patterns)
        assert scheduled_rows == 1774
        assert pattern_count == 1828
        assert skip_reasons == {
            "arranged-tba": 3328,
            "online-no-schedule": 72,
            "cross-listed-reference": 100,
            "empty-schedule": 1,
        }
