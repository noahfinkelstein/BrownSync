"""CSV source loading: exact header, verbatim cells, strict flags, dedupe."""

from __future__ import annotations

from pathlib import Path

import pytest

from brownsync_ingest.cab.csv_source import (
    EXPECTED_COLUMNS,
    CabCsvError,
    load_cab_csv,
)

CSV_PATH = (
    Path(__file__).resolve().parents[2]
    / "fixtures"
    / "user_provided"
    / "brown_fall_2026_classes_and_locations.csv"
)

HEADER = ",".join(EXPECTED_COLUMNS)


def quote(cell: str) -> str:
    if any(character in cell for character in ',"\n'):
        escaped = cell.replace('"', '""')
        return f'"{escaped}"'
    return cell


def row(
    *,
    crn: str = "15141",
    course_code: str = "AFRI 0090",
    title: str = "An Introduction to Africana Studies",
    schedule: str = "TTh 10:30am-11:50am",
    location: str = "CIT Center (Thomas Watson CIT) 227",
    status: str = "Physical location published",
    instructor: str = "K. Blain",
    cancelled: str = "false",
    term_code: str = "202610",
) -> str:
    cells = [
        "Fall 2026", term_code, course_code, title, "S01", crn,
        schedule, location, status, instructor, "S", "Active", "A",
        cancelled, "2026-09-09", "2026-12-21", f"{schedule} in {location}",
        "https://cab.brown.edu/",
    ]
    return ",".join(quote(cell) for cell in cells)


def write_csv(tmp_path: Path, *lines: str, header: str = HEADER, bom: str = "﻿") -> Path:
    path = tmp_path / "export.csv"
    path.write_text(bom + "\n".join([header, *lines]) + "\n", encoding="utf-8")
    return path


class TestHeader:
    def test_expected_columns_are_the_export_header(self) -> None:
        assert EXPECTED_COLUMNS == (
            "term",
            "term_code",
            "course_code",
            "course_title",
            "section",
            "crn",
            "meeting_schedule",
            "location",
            "location_status",
            "instructor",
            "schedule_type_code",
            "class_status",
            "cab_status_code",
            "cancelled",
            "start_date",
            "end_date",
            "cab_schedule_and_location",
            "source_url",
        )

    def test_bom_is_stripped_from_the_first_header_cell(self, tmp_path: Path) -> None:
        records, dropped = load_cab_csv(write_csv(tmp_path, row()))
        assert dropped == 0
        assert records[0].term == "Fall 2026"

    def test_header_without_bom_also_loads(self, tmp_path: Path) -> None:
        records, _ = load_cab_csv(write_csv(tmp_path, row(), bom=""))
        assert records[0].crn == "15141"

    def test_reordered_header_is_rejected(self, tmp_path: Path) -> None:
        shuffled = ",".join([EXPECTED_COLUMNS[1], EXPECTED_COLUMNS[0], *EXPECTED_COLUMNS[2:]])
        with pytest.raises(CabCsvError, match="header"):
            load_cab_csv(write_csv(tmp_path, row(), header=shuffled))

    def test_missing_column_is_rejected(self, tmp_path: Path) -> None:
        truncated = ",".join(EXPECTED_COLUMNS[:-1])
        with pytest.raises(CabCsvError, match="header"):
            load_cab_csv(write_csv(tmp_path, row(), header=truncated))


class TestCells:
    def test_quoted_commas_and_newlines_stay_verbatim(self, tmp_path: Path) -> None:
        records, _ = load_cab_csv(
            write_csv(
                tmp_path,
                row(
                    title="Listening Closely: Race, Religion and Radicalism",
                    location="Stephen Robert Hall, 280 Brook 101",
                ),
                row(crn="15901", title="\nBioarchaeology and Forensic Anthropology (ANTH 1775)"),
            )
        )
        assert records[0].course_title == "Listening Closely: Race, Religion and Radicalism"
        assert records[0].location == "Stephen Robert Hall, 280 Brook 101"
        assert records[1].course_title == "\nBioarchaeology and Forensic Anthropology (ANTH 1775)"

    def test_raw_maps_every_column_verbatim(self, tmp_path: Path) -> None:
        records, _ = load_cab_csv(write_csv(tmp_path, row()))
        raw = records[0].raw
        assert set(raw) == set(EXPECTED_COLUMNS)
        assert raw["cancelled"] == "false"
        assert raw["meeting_schedule"] == "TTh 10:30am-11:50am"

    def test_cancelled_parses_strictly(self, tmp_path: Path) -> None:
        records, _ = load_cab_csv(
            write_csv(tmp_path, row(cancelled="false"), row(crn="2", cancelled="true"))
        )
        assert [record.cancelled for record in records] == [False, True]

    @pytest.mark.parametrize("value", ["TRUE", "False", "yes", "", "1"])
    def test_non_boolean_cancelled_is_rejected(self, tmp_path: Path, value: str) -> None:
        with pytest.raises(CabCsvError, match="cancelled"):
            load_cab_csv(write_csv(tmp_path, row(cancelled=value)))

    @pytest.mark.parametrize(
        ("field", "kwarg"),
        [
            ("term_code", "term_code"),
            ("crn", "crn"),
            ("course_code", "course_code"),
            ("course_title", "title"),
        ],
    )
    def test_blank_identity_fields_are_rejected(
        self, tmp_path: Path, field: str, kwarg: str
    ) -> None:
        with pytest.raises(CabCsvError, match=field):
            load_cab_csv(write_csv(tmp_path, row(**{kwarg: "  "})))


class TestDedupe:
    def test_first_occurrence_wins_and_drops_are_counted(self, tmp_path: Path) -> None:
        records, dropped = load_cab_csv(
            write_csv(
                tmp_path,
                row(crn="10001", instructor="A. First"),
                row(crn="10001", instructor="B. Second"),
                row(crn="10002"),
            )
        )
        assert dropped == 1
        assert [record.crn for record in records] == ["10001", "10002"]
        assert records[0].instructor == "A. First"

    def test_same_crn_in_different_terms_is_not_a_duplicate(self, tmp_path: Path) -> None:
        records, dropped = load_cab_csv(
            write_csv(tmp_path, row(crn="10001"), row(crn="10001", term_code="202620"))
        )
        assert dropped == 0
        assert len(records) == 2


class TestRealExport:
    def test_the_pinned_export_loads_completely(self) -> None:
        records, dropped = load_cab_csv(CSV_PATH)
        assert len(records) == 5275
        assert dropped == 0
        assert {record.term_code for record in records} == {"202610"}
        assert sum(1 for record in records if record.cancelled) == 83
