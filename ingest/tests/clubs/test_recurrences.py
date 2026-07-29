"""Recurring club events demand full temporal evidence — or nothing.

Plan Task 7: a recurring club event requires source evidence for weekday,
local time, effective start date, bounded end, duration/end time, and a
physical venue; vague prose never becomes an event. The 2026-07-29 clubs
export carries NO structured temporal columns, so the measured outcome is
zero emissions — asserted here over every real record, including records
whose free-text description happens to mention meeting times.
"""

from __future__ import annotations

from pathlib import Path

from brownsync_ingest.clubs.csv_source import load_clubs_csv
from brownsync_ingest.clubs.models import ClubRecord
from brownsync_ingest.clubs.recurrences import (
    REQUIRED_EVIDENCE,
    RecurrenceDecision,
    evaluate_recurrence,
    evidence_from_record,
)

INGEST_ROOT = Path(__file__).resolve().parents[2]
REAL_CSV = INGEST_ROOT / "fixtures" / "user_provided" / "brown_all_student_groups.csv"

FULL_EVIDENCE = {
    "weekday": "F",
    "start_time_local": "17:00",
    "duration_or_end_time": "18:00",
    "effective_start": "2026-09-04",
    "bounded_end": "2026-12-11",
    "physical_venue": "Sayles Hall 105",
}


def make_record(description: str = "A club.") -> ClubRecord:
    columns = {
        "group_type": "Undergraduate student group",
        "name": "Example Club",
        "description": description,
        "contact_emails": "example@brown.edu",
        "advisor": "",
        "funding_category": "Category 2",
        "tags": "UCS Recognized Undergrad Student Groups",
        "website_url": "",
        "instagram_url": "",
        "facebook_url": "",
        "linkedin_url": "",
        "youtube_url": "",
        "twitter_url": "",
        "tiktok_url": "",
        "other_social_urls": "",
        "source_url": "https://example.org/club",
        "directory_source_url": "https://example.org/",
    }
    return ClubRecord(**columns, raw=columns)


class TestEvidenceGate:
    def test_the_required_evidence_names_all_six_plan_fields(self) -> None:
        assert REQUIRED_EVIDENCE == (
            "weekday",
            "start_time_local",
            "duration_or_end_time",
            "effective_start",
            "bounded_end",
            "physical_venue",
        )

    def test_full_evidence_permits_emission(self) -> None:
        decision = evaluate_recurrence(FULL_EVIDENCE)
        assert decision == RecurrenceDecision(emit=True, missing=())

    def test_each_missing_field_blocks_emission(self) -> None:
        for field in REQUIRED_EVIDENCE:
            partial = {**FULL_EVIDENCE, field: None}
            decision = evaluate_recurrence(partial)
            assert decision.emit is False
            assert decision.missing == (field,)

    def test_absent_keys_count_as_missing(self) -> None:
        decision = evaluate_recurrence({})
        assert decision.emit is False
        assert decision.missing == REQUIRED_EVIDENCE

    def test_blank_strings_are_not_evidence(self) -> None:
        decision = evaluate_recurrence({**FULL_EVIDENCE, "physical_venue": "   "})
        assert decision.emit is False
        assert decision.missing == ("physical_venue",)


class TestSourceExtraction:
    def test_the_export_has_no_structured_temporal_columns(self) -> None:
        evidence = evidence_from_record(make_record())
        assert set(evidence) == set(REQUIRED_EVIDENCE)
        assert all(value is None for value in evidence.values())

    def test_a_registered_structured_column_would_flow_through(
        self, monkeypatch: __import__("pytest").MonkeyPatch
    ) -> None:
        # The extraction seam is real: when the export ever grows a
        # structured temporal column and it is registered, its value flows —
        # blank cells still do not.
        from brownsync_ingest.clubs import recurrences

        monkeypatch.setitem(
            recurrences.EVIDENCE_COLUMNS, "weekday", ("meeting_weekday",)
        )
        record = make_record()
        with_column = dict(record.raw)
        with_column["meeting_weekday"] = " F "
        filled = ClubRecord(**{f: getattr(record, f) for f in record.raw}, raw=with_column)
        assert evidence_from_record(filled)["weekday"] == "F"
        with_blank = dict(record.raw)
        with_blank["meeting_weekday"] = "   "
        blank = ClubRecord(**{f: getattr(record, f) for f in record.raw}, raw=with_blank)
        assert evidence_from_record(blank)["weekday"] is None

    def test_prose_meeting_times_are_never_parsed_into_evidence(self) -> None:
        record = make_record(
            description=(
                "We meet every Friday at 5pm in Sayles Hall 105 from "
                "September 4 to December 11; meetings run one hour."
            )
        )
        evidence = evidence_from_record(record)
        assert all(value is None for value in evidence.values())
        assert evaluate_recurrence(evidence).emit is False


class TestRealExport:
    def test_zero_recurrences_emit_from_the_real_export(self) -> None:
        records, _ = load_clubs_csv(REAL_CSV)
        emitted = [
            record.name
            for record in records
            if evaluate_recurrence(evidence_from_record(record)).emit
        ]
        assert emitted == []
