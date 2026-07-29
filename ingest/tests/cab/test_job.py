"""CAB job tests: identity, resolution wiring, gates, fail-closed publication."""

from __future__ import annotations

from datetime import time
import json
from pathlib import Path

import pytest

from brownsync_ingest.cab.job import (
    MIN_MEETING_ROWS,
    MIN_SUBJECTS,
    RESOLUTION_GATE,
    format_instructor,
    run_cab_csv_job,
)
from brownsync_ingest.common.identifiers import slugify
from brownsync_ingest.contract import CourseMeetingRow
from brownsync_ingest.gazetteer.models import CuratedCatalog, CuratedPlace
from brownsync_ingest.gazetteer.resolver import PlaceResolver

CSV_PATH = (
    Path(__file__).resolve().parents[2]
    / "fixtures"
    / "user_provided"
    / "brown_fall_2026_classes_and_locations.csv"
)

HEADER = (
    "term,term_code,course_code,course_title,section,crn,meeting_schedule,"
    "location,location_status,instructor,schedule_type_code,class_status,"
    "cab_status_code,cancelled,start_date,end_date,cab_schedule_and_location,"
    "source_url"
)

PUBLISHED = "Physical location published"
NOT_YET = "Physical location not yet published"


def quote(cell: str) -> str:
    if any(character in cell for character in ',"\n'):
        escaped = cell.replace('"', '""')
        return f'"{escaped}"'
    return cell


def row(
    *,
    crn: str,
    course_code: str = "AFRI 0090",
    title: str = "An Introduction to Africana Studies",
    schedule: str = "TTh 10:30am-11:50am",
    location: str = "Sayles Hall 105",
    status: str = PUBLISHED,
    instructor: str = "K. Blain",
    cancelled: str = "false",
) -> str:
    cells = [
        "Fall 2026", "202610", course_code, title, "S01", crn,
        schedule, location, status, instructor, "S", "Active", "A",
        cancelled, "2026-09-09", "2026-12-21", f"{schedule} in {location}",
        "https://cab.brown.edu/",
    ]
    return ",".join(quote(cell) for cell in cells)


def write_csv(tmp_path: Path, *lines: str) -> Path:
    path = tmp_path / "export.csv"
    path.write_text("\n".join([HEADER, *lines]) + "\n", encoding="utf-8")
    return path


def place(name: str, *extra_aliases: str) -> CuratedPlace:
    return CuratedPlace(
        id=slugify(name),
        name=name,
        kind="academic",
        aliases=(name, *extra_aliases),
        osm_name=name,
        lat=None,
        lng=None,
    )


@pytest.fixture()
def resolver() -> PlaceResolver:
    catalog = CuratedCatalog(
        places=(
            place("Sayles Hall", "Sayles"),
            place("Nicholson House"),
            place("Salomon Center"),
        ),
        attribution="(c) OpenStreetMap contributors, ODbL 1.0",
    )
    return PlaceResolver(catalog)


def run_job(tmp_path: Path, resolver: PlaceResolver, csv_path: Path, **overrides):
    defaults = dict(
        resolver=resolver,
        seeds_path=tmp_path / "seeds" / "course_meetings.ndjson",
        report_path=tmp_path / "reports" / "cab_place_resolution.md",
        staging_root=tmp_path / "staging",
    )
    defaults.update(overrides)
    return run_cab_csv_job(csv_path, **defaults)


LOW_GATES = dict(min_subjects=1, min_meeting_rows=1, resolution_gate=0.5)


class TestFormatInstructor:
    @pytest.mark.parametrize(
        ("source", "expected"),
        [
            ("K. Blain", "K. Blain"),
            ("Meeks/Dawes", "Meeks; Dawes"),
            ("Giardina Papa/Li", "Giardina Papa; Li"),
            ("Korotkov/Roloff/Korotkov", "Korotkov; Roloff"),  # source-order dedupe
            ("", None),
            ("  ", None),
        ],
    )
    def test_splits_verbatim_dedupes_and_joins(self, source: str, expected: str | None) -> None:
        assert format_instructor(source) == expected


class TestRowConstruction:
    def test_multi_pattern_row_emits_deterministic_indexed_ids(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(
            tmp_path,
            row(crn="10001", schedule="MW 10am-10:50am | TTh 9am-10:20am"),
        )
        result = run_job(tmp_path, resolver, csv_path, **LOW_GATES)
        assert [meeting.id for meeting in result.rows] == [
            "202610-10001-0",
            "202610-10001-1",
        ]
        first, second = result.rows
        assert (first.srcdb, first.crn, first.course_code) == ("202610", "10001", "AFRI 0090")
        assert (first.days, first.start_time, first.end_time) == ("MW", time(10, 0), time(10, 50))
        assert (second.days, second.start_time, second.end_time) == ("TTh", time(9, 0), time(10, 20))
        assert first.location_raw == "Sayles Hall 105"
        assert first.place_id == "sayles-hall"
        assert first.room == "105"
        assert first.enrollment is None

    def test_raw_carries_the_verbatim_record_pattern_and_cancelled_flag(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(
            tmp_path,
            row(crn="10001", schedule="MW 10am-10:50am | TTh 9am-10:20am", cancelled="true"),
        )
        result = run_job(tmp_path, resolver, csv_path, **LOW_GATES)
        raw = result.rows[1].raw
        assert raw["csv"]["crn"] == "10001"
        assert raw["csv"]["cancelled"] == "true"
        assert raw["cancelled"] is True
        assert raw["pattern"] == "TTh 9am-10:20am"
        assert raw["pattern_index"] == 1

    def test_date_bounds_survive_into_raw(self, tmp_path: Path, resolver: PlaceResolver) -> None:
        csv_path = write_csv(
            tmp_path, row(crn="10001", schedule="W 3pm-5:30pm (9/9 to 10/16)")
        )
        result = run_job(tmp_path, resolver, csv_path, **LOW_GATES)
        assert result.rows[0].raw["date_bounds"] == ["9/9", "10/16"]

    def test_title_is_stripped_but_raw_keeps_the_export_value(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(
            tmp_path, row(crn="10001", title="\nDemocratic Erosion (POLS 1820X)")
        )
        result = run_job(tmp_path, resolver, csv_path, **LOW_GATES)
        assert result.rows[0].title == "Democratic Erosion (POLS 1820X)"
        assert result.rows[0].raw["csv"]["course_title"] == "\nDemocratic Erosion (POLS 1820X)"

    def test_instructors_join_with_semicolons(self, tmp_path: Path, resolver: PlaceResolver) -> None:
        csv_path = write_csv(tmp_path, row(crn="10001", instructor="Meeks/Dawes"))
        result = run_job(tmp_path, resolver, csv_path, **LOW_GATES)
        assert result.rows[0].instructor == "Meeks; Dawes"


class TestLocationResolution:
    def test_embedded_location_resolves_and_is_reported_outside_the_gate(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(
            tmp_path,
            row(
                crn="10001",
                schedule="F 3pm-5:30pm in Nicholson House 101",
                location="Not published in CAB",
                status=NOT_YET,
            ),
            row(crn="10002"),  # one published row keeps the gate evaluable
        )
        result = run_job(tmp_path, resolver, csv_path, **LOW_GATES)
        embedded = next(meeting for meeting in result.rows if meeting.crn == "10001")
        assert embedded.location_raw == "Nicholson House 101"
        assert embedded.place_id == "nicholson-house"
        assert embedded.room == "101"
        assert result.report.by_source["cab-embedded"].total == 1
        # the CAB gate denominator counts only published sections
        assert result.report.cab_sections_total == 1

    def test_non_physical_locations_never_reach_the_resolver(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(
            tmp_path,
            row(crn="10001", location="TBD", status=NOT_YET),
            row(crn="10002", location="Online", status="Online"),
        )
        result = run_job(tmp_path, resolver, csv_path, **LOW_GATES)
        by_crn = {meeting.crn: meeting for meeting in result.rows}
        assert by_crn["10001"].location_raw == "TBD"
        assert by_crn["10001"].place_id is None
        assert by_crn["10001"].room is None
        assert by_crn["10002"].location_raw == "Online"
        assert "cab" not in result.report.by_source
        assert result.report.cab_sections_total == 0

    def test_published_sections_without_schedules_still_count_in_the_gate(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(
            tmp_path,
            row(crn="10001", schedule="", location="Sayles Hall"),
            row(crn="10002", location="Sayles Hall 105"),
        )
        result = run_job(tmp_path, resolver, csv_path, **LOW_GATES)
        assert result.report.cab_sections_total == 2
        assert result.report.cab_sections_resolved == 2

    def test_unresolved_published_sections_lower_the_section_rate(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(
            tmp_path,
            row(crn="10001"),
            row(crn="10002", location="Building With No Alias Anywhere 999"),
        )
        result = run_job(tmp_path, resolver, csv_path, **LOW_GATES)
        assert result.report.cab_sections_total == 2
        assert result.report.cab_sections_resolved == 1
        assert result.report.cab_section_rate == 0.5


class TestSkipsAndDedupe:
    def test_schedule_less_rows_become_structured_skips(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(
            tmp_path,
            row(crn="10001"),
            row(crn="10002", schedule="TBA", location="TBA", status="TBA"),
            row(crn="10003", schedule="", location="Online", status="Online"),
        )
        result = run_job(tmp_path, resolver, csv_path, **LOW_GATES)
        assert [meeting.crn for meeting in result.rows] == ["10001"]
        skips = {skip.crn: skip for skip in result.skips}
        assert skips["10002"].reason == "arranged-tba"
        assert skips["10002"].term_code == "202610"
        assert skips["10003"].reason == "online-no-schedule"

    def test_duplicate_crns_are_deduped_first_wins(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(
            tmp_path,
            row(crn="10001", instructor="A. First"),
            row(crn="10001", instructor="B. Second"),
        )
        result = run_job(tmp_path, resolver, csv_path, **LOW_GATES)
        assert result.duplicates_dropped == 1
        assert len(result.rows) == 1
        assert result.rows[0].instructor == "A. First"


class TestGates:
    def test_default_thresholds_are_the_adapted_plan_gates(self) -> None:
        assert MIN_SUBJECTS == 50
        assert MIN_MEETING_ROWS == 2000
        assert RESOLUTION_GATE == 0.90

    def test_passing_gates_publish_contract_valid_seeds_atomically(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(
            tmp_path,
            row(crn="10001", course_code="AFRI 0090"),
            row(crn="10002", course_code="CSCI 0150", location="Salomon Center 001"),
        )
        result = run_job(tmp_path, resolver, csv_path, min_subjects=2, min_meeting_rows=2, resolution_gate=0.9)
        assert result.gates.passed
        assert result.published_count == 2
        seeds_path = tmp_path / "seeds" / "course_meetings.ndjson"
        lines = seeds_path.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 2
        parsed = [CourseMeetingRow.model_validate(json.loads(line)) for line in lines]
        assert [meeting.id for meeting in parsed] == ["202610-10001-0", "202610-10002-0"]
        assert not list((tmp_path / "staging").iterdir()), "staging must be clean"
        assert (tmp_path / "reports" / "cab_place_resolution.md").is_file()

    def test_subject_gate_counts_distinct_course_code_prefixes(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(
            tmp_path,
            row(crn="10001", course_code="AFRI 0090"),
            row(crn="10002", course_code="AFRI 1111"),
            row(crn="10003", course_code="CSCI 0150"),
        )
        result = run_job(tmp_path, resolver, csv_path, **LOW_GATES)
        assert result.subjects == ("AFRI", "CSCI")
        subjects_gate = next(check for check in result.gates.checks if check.name == "subjects")
        assert subjects_gate.actual == 2

    def test_failing_any_gate_publishes_report_only(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(tmp_path, row(crn="10001"))
        seeds_path = tmp_path / "seeds" / "course_meetings.ndjson"
        seeds_path.parent.mkdir(parents=True)
        seeds_path.write_text("PREVIOUS PUBLICATION\n", encoding="utf-8")
        result = run_job(tmp_path, resolver, csv_path)  # default gates: must fail
        assert not result.gates.passed
        assert result.published_count is None
        assert seeds_path.read_text(encoding="utf-8") == "PREVIOUS PUBLICATION\n", (
            "a failed run must never touch existing seeds"
        )
        report_text = (tmp_path / "reports" / "cab_place_resolution.md").read_text(encoding="utf-8")
        assert "Gate" in report_text
        assert "FAIL" in result.report_markdown or "PASS" in result.report_markdown

    def test_resolution_gate_fails_closed_when_no_published_sections_exist(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(tmp_path, row(crn="10001", location="TBD", status=NOT_YET))
        result = run_job(tmp_path, resolver, csv_path, min_subjects=1, min_meeting_rows=1)
        resolution_gate = next(
            check for check in result.gates.checks if check.name == "section-resolution"
        )
        assert not resolution_gate.passed
        assert not result.gates.passed
        assert result.published_count is None

    def test_gate_failure_reasons_are_measurable(
        self, tmp_path: Path, resolver: PlaceResolver
    ) -> None:
        csv_path = write_csv(
            tmp_path,
            row(crn="10001"),
            row(crn="10002", location="Building With No Alias Anywhere 999"),
        )
        result = run_job(tmp_path, resolver, csv_path, min_subjects=1, min_meeting_rows=1)
        by_name = {check.name: check for check in result.gates.checks}
        assert by_name["meeting-rows"].passed  # 2 >= 1
        assert by_name["subjects"].passed  # 1 >= 1
        assert not by_name["section-resolution"].passed  # 0.5 < 0.9
        assert by_name["section-resolution"].actual == 0.5


class TestRealExportRegression:
    """The full pinned export through the real curated catalog.

    These numbers are the Task 6 record: they pin the fail-closed outcome
    (rows and resolution below gate) until Task 10 grows aliases from the
    unresolved evidence.
    """

    @pytest.fixture(scope="class")
    def real_result(self, tmp_path_factory: pytest.TempPathFactory):
        tmp_path = tmp_path_factory.mktemp("real-cab")
        return run_job(tmp_path, PlaceResolver.from_files(), CSV_PATH), tmp_path

    def test_emission_identity_and_skip_totals(self, real_result) -> None:
        result, _ = real_result
        assert len(result.rows) == 1828
        assert len({meeting.id for meeting in result.rows}) == 1828
        assert result.duplicates_dropped == 0
        assert len(result.skips) == 3501
        emitting_sections = {meeting.crn for meeting in result.rows}
        assert len(emitting_sections) == 1774
        # every record is accounted for: emitted or structured skip, never both
        assert len(emitting_sections) + len(result.skips) == 5275
        assert emitting_sections.isdisjoint({skip.crn for skip in result.skips})

    def test_gates_fail_closed_on_the_real_export(self, real_result) -> None:
        result, tmp_path = real_result
        by_name = {check.name: check for check in result.gates.checks}
        assert by_name["subjects"].passed  # 81 subjects >= 50
        assert by_name["subjects"].actual == 81
        assert not by_name["meeting-rows"].passed  # 1828 < 2000
        assert by_name["meeting-rows"].actual == 1828
        assert not by_name["section-resolution"].passed  # 83.5% < 90%
        assert result.report.cab_sections_total == 1501
        assert result.report.cab_sections_resolved == 1253
        assert not result.gates.passed
        assert result.published_count is None
        assert not (tmp_path / "seeds" / "course_meetings.ndjson").exists()
        assert (tmp_path / "reports" / "cab_place_resolution.md").is_file()

    def test_every_emitted_row_is_contract_valid_with_cab_plausible_times(
        self, real_result
    ) -> None:
        from brownsync_ingest.policy import validate_cab_temporal_plausibility

        result, _ = real_result
        for meeting in result.rows:
            CourseMeetingRow.model_validate(meeting.model_dump())
            validate_cab_temporal_plausibility(
                meeting.days, meeting.start_time, meeting.end_time
            )

    def test_cancelled_rows_are_carried_not_dropped(self, real_result) -> None:
        result, _ = real_result
        cancelled = [meeting for meeting in result.rows if meeting.raw["cancelled"] is True]
        # 83 cancelled sections; 72 have parseable schedules, one of which
        # (ARAB 0100, crn 13436) meets in two weekly patterns -> 73 rows
        assert len(cancelled) == 73
        assert len({meeting.crn for meeting in cancelled}) == 72
