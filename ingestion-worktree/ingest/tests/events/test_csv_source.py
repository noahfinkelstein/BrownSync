"""Strict structural loading of the two hash-pinned events exports."""

from __future__ import annotations

from pathlib import Path

import pytest

from brownsync_ingest.events.csv_source import (
    CALENDAR_EXPECTED_COLUMNS,
    EventsCsvError,
    UPCOMING_EXPECTED_COLUMNS,
    load_academic_calendar_csv,
    load_upcoming_events_csv,
)


INGEST_ROOT = Path(__file__).resolve().parents[2]
REAL_UPCOMING = (
    INGEST_ROOT / "fixtures" / "user_provided" / "brown_upcoming_events.csv"
)
REAL_CALENDAR = (
    INGEST_ROOT
    / "fixtures"
    / "user_provided"
    / "brown_academic_calendar_2026_2027.csv"
)


def upcoming_csv(tmp_path: Path, *rows: str, header: str | None = None) -> Path:
    path = tmp_path / "upcoming.csv"
    lines = [header if header is not None else ",".join(UPCOMING_EXPECTED_COLUMNS)]
    lines.extend(rows)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def upcoming_row(**overrides: str) -> str:
    values = {column: "" for column in UPCOMING_EXPECTED_COLUMNS}
    values.update(
        event_id="334851",
        title="Workshop",
        start_date_iso="2026-07-29T00:00:00-04:00",
        all_day="true",
        canceled="false",
        online="false",
        organizer="Carney Institute for Brain Science",
        source_url="https://events.brown.edu/live/events/334851",
    )
    values.update(overrides)
    return ",".join(values[column] for column in UPCOMING_EXPECTED_COLUMNS)


class TestUpcomingLoader:
    def test_loads_records_in_source_order_with_raw_retained(
        self, tmp_path: Path
    ) -> None:
        path = upcoming_csv(
            tmp_path,
            upcoming_row(event_id="1", title="A"),
            upcoming_row(event_id="2", title="B"),
        )
        records = load_upcoming_events_csv(path)
        assert [record.event_id for record in records] == ["1", "2"]
        assert records[0].title == "A"
        assert records[0].raw["title"] == "A"
        assert set(records[0].raw) == set(UPCOMING_EXPECTED_COLUMNS)

    def test_header_drift_fails_loudly(self, tmp_path: Path) -> None:
        path = upcoming_csv(tmp_path, header="event_id,title")
        with pytest.raises(EventsCsvError, match="unexpected header"):
            load_upcoming_events_csv(path)

    def test_ragged_row_fails_loudly(self, tmp_path: Path) -> None:
        path = upcoming_csv(tmp_path, "334851,truncated")
        with pytest.raises(EventsCsvError, match="row 2"):
            load_upcoming_events_csv(path)

    def test_empty_file_fails_loudly(self, tmp_path: Path) -> None:
        path = tmp_path / "empty.csv"
        path.write_text("", encoding="utf-8")
        with pytest.raises(EventsCsvError, match="no header row"):
            load_upcoming_events_csv(path)

    def test_trailing_blank_line_is_not_a_record(self, tmp_path: Path) -> None:
        path = upcoming_csv(tmp_path, upcoming_row(), "")
        assert len(load_upcoming_events_csv(path)) == 1

    def test_real_export_loads_the_measured_1000_rows(self) -> None:
        records = load_upcoming_events_csv(REAL_UPCOMING)
        assert len(records) == 1000


class TestCalendarLoader:
    def test_loads_entries_with_raw_retained(self, tmp_path: Path) -> None:
        path = tmp_path / "calendar.csv"
        path.write_text(
            ",".join(CALENDAR_EXPECTED_COLUMNS)
            + "\n"
            + 'Fall 2026,September,"Wed, Sep 9",,Classes begin,'
            "http://events.brown.edu/academic-calendar/event/1-classes,"
            "https://registrar.brown.edu/x\n",
            encoding="utf-8",
        )
        entries = load_academic_calendar_csv(path)
        assert len(entries) == 1
        assert entries[0].academic_term == "Fall 2026"
        assert entries[0].start_date_display == "Wed, Sep 9"
        assert entries[0].raw["event"] == "Classes begin"

    def test_header_drift_fails_loudly(self, tmp_path: Path) -> None:
        path = tmp_path / "calendar.csv"
        path.write_text("term,month\n", encoding="utf-8")
        with pytest.raises(EventsCsvError, match="unexpected header"):
            load_academic_calendar_csv(path)

    def test_real_export_loads_the_measured_110_rows(self) -> None:
        assert len(load_academic_calendar_csv(REAL_CALENDAR)) == 110
