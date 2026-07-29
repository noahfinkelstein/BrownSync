"""Registrar calendar normalization: weekday-validated years, admin rows."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest

from brownsync_ingest.events.csv_source import load_academic_calendar_csv
from brownsync_ingest.events.models import RegistrarEntry
from brownsync_ingest.events.registrar import (
    RegistrarCalendarError,
    normalize_registrar_entries,
    normalize_registrar_entry,
    resolve_display_date,
    source_id_for,
    term_year,
)


INGEST_ROOT = Path(__file__).resolve().parents[2]
REAL_CALENDAR = (
    INGEST_ROOT
    / "fixtures"
    / "user_provided"
    / "brown_academic_calendar_2026_2027.csv"
)


def entry(**overrides: str) -> RegistrarEntry:
    values: dict[str, str] = dict(
        academic_term="Fall 2026",
        month="September",
        start_date_display="Wed, Sep 9",
        end_date_display="",
        event="Classes begin",
        event_url=(
            "http://events.brown.edu/academic-calendar/"
            "event/328310-classes-begin"
        ),
        source_url=(
            "https://registrar.brown.edu/academic-calendar/"
            "2026-2027-academic-calendar"
        ),
    )
    values.update(overrides)
    return RegistrarEntry(**values, raw=dict(values))


class TestYearDerivation:
    def test_weekday_uniquely_selects_the_year(self) -> None:
        # Mar 23 is a Monday in 2026, a Tuesday in 2027
        assert resolve_display_date("Mon, Mar 23", (2025, 2026)) == date(
            2026, 3, 23
        )

    def test_winter_term_december_lands_in_the_prior_year(self) -> None:
        # Winter 2027's "Wed, Dec 16" is 2026 — the weekday proves it
        assert resolve_display_date("Wed, Dec 16", (2026, 2027)) == date(
            2026, 12, 16
        )

    def test_no_weekday_match_refuses_to_guess(self) -> None:
        # Mar 23 is a Sunday in 2025 and a Monday in 2026 — never a Wednesday
        with pytest.raises(RegistrarCalendarError, match="matches 0"):
            resolve_display_date("Wed, Mar 23", (2025, 2026))

    def test_malformed_display_fails_loudly(self) -> None:
        with pytest.raises(RegistrarCalendarError, match="unparseable"):
            resolve_display_date("March 23", (2025, 2026))
        with pytest.raises(RegistrarCalendarError, match="unrecognized"):
            resolve_display_date("Xyz, Mar 23", (2025, 2026))

    def test_feb_29_outside_a_leap_year_is_skipped_not_crashed(self) -> None:
        # Feb 29 exists in 2028 (a Tuesday); 2027 has no Feb 29
        assert resolve_display_date("Tue, Feb 29", (2027, 2028)) == date(
            2028, 2, 29
        )

    def test_term_year_parsing(self) -> None:
        assert term_year("Winter 2027") == 2027
        with pytest.raises(RegistrarCalendarError, match="unrecognized"):
            term_year("Trimester 2027")

    def test_consecutive_candidate_years_can_never_both_match(self) -> None:
        # the uniqueness argument the module relies on, checked by brute
        # force across a decade of dates
        for offset in range(0, 3650, 37):
            day = date(2020, 1, 1) + timedelta(days=offset)
            display = day.strftime("%a, %b ") + str(day.day)
            resolved = resolve_display_date(display, (day.year, day.year + 1))
            assert resolved == day


class TestNormalization:
    def test_admin_row_shape(self) -> None:
        row = normalize_registrar_entry(entry())
        assert row.source == "registrar"
        assert row.source_id == "328310"
        assert row.category == "admin"
        assert row.is_all_day is True
        assert row.title == "Classes begin"
        assert row.lat is None and row.lng is None and row.place_id is None
        assert row.url is not None and row.url.endswith("classes-begin")
        assert row.raw["academic_term"] == "Fall 2026"

    def test_start_is_midnight_new_york_stored_utc(self) -> None:
        row = normalize_registrar_entry(entry())
        # 2026-09-09 00:00 EDT == 04:00Z (contract §2 America/New_York)
        assert row.start_ts.isoformat() == "2026-09-09T04:00:00+00:00"

    def test_winter_midnight_is_est(self) -> None:
        row = normalize_registrar_entry(
            entry(
                academic_term="Winter 2027",
                start_date_display="Wed, Dec 16",
            )
        )
        assert row.start_ts.isoformat() == "2026-12-16T05:00:00+00:00"

    def test_end_date_range(self) -> None:
        row = normalize_registrar_entry(
            entry(
                start_date_display="Mon, Mar 30",
                end_date_display="Thu, Apr 9",
                academic_term="Summer 2026",
            )
        )
        assert row.start_ts.isoformat() == "2026-03-30T04:00:00+00:00"
        assert row.end_ts is not None
        assert row.end_ts.isoformat() == "2026-04-09T04:00:00+00:00"

    def test_end_before_start_fails_loudly(self) -> None:
        with pytest.raises(RegistrarCalendarError, match="precedes"):
            normalize_registrar_entry(
                entry(
                    start_date_display="Wed, Sep 9",
                    end_date_display="Tue, Sep 8",
                )
            )

    def test_event_url_without_id_fails_loudly(self) -> None:
        with pytest.raises(RegistrarCalendarError, match="no /event/<id>"):
            source_id_for(entry(event_url="https://registrar.brown.edu/x"))

    def test_empty_event_text_fails_loudly(self) -> None:
        with pytest.raises(RegistrarCalendarError, match="empty event text"):
            normalize_registrar_entry(entry(event=" "))


class TestDedupe:
    def test_month_section_duplicates_are_first_wins_deduped(self) -> None:
        first = entry(month="March")
        second = entry(month="April")
        result = normalize_registrar_entries((first, second))
        assert len(result.rows) == 1
        assert result.duplicates_dropped == 1

    def test_divergent_duplicate_ids_fail_loudly(self) -> None:
        with pytest.raises(RegistrarCalendarError, match="diverges"):
            normalize_registrar_entries(
                (entry(), entry(event="Something else"))
            )


class TestRealExport:
    def test_the_110_rows_normalize_to_106_admin_events(self) -> None:
        result = normalize_registrar_entries(
            load_academic_calendar_csv(REAL_CALENDAR)
        )
        assert len(result.rows) == 106
        assert result.duplicates_dropped == 4
        assert all(row.category == "admin" for row in result.rows)
        assert all(row.source == "registrar" for row in result.rows)
        starts = sorted(row.start_ts for row in result.rows)
        assert starts[0].date().isoformat() == "2026-03-23"
        assert starts[-1].date().isoformat() == "2027-05-29"
