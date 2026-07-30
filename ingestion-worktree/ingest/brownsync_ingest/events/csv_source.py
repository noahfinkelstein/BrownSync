"""Strict loading of the two events CSVs (user-provided, hash-pinned).

Both exports are pinned in ``fixtures/manifest.json``; the loaders still
refuse structural surprises (header drift, ragged rows) loudly instead of
mis-parsing them. Values are kept verbatim; ``raw`` retains every column.
Parsing (epochs, coordinates, booleans, display dates) happens in the
normalizers, never here.
"""

from __future__ import annotations

import csv
from pathlib import Path

from brownsync_ingest.events.models import RegistrarEntry, UpcomingEventRecord


UPCOMING_EXPECTED_COLUMNS: tuple[str, ...] = (
    "event_id",
    "title",
    "start_date_iso",
    "end_date_iso",
    "display_date",
    "display_time",
    "timezone",
    "all_day",
    "repeats",
    "repeats_until",
    "series_start",
    "series_end",
    "canceled",
    "online",
    "online_type",
    "online_url",
    "location",
    "latitude",
    "longitude",
    "cost",
    "organizer",
    "event_types",
    "audiences",
    "campus_categories",
    "tags",
    "contact",
    "contact_emails",
    "registration_available",
    "registration_limit",
    "wait_list_available",
    "thumbnail_url",
    "thumbnail_alt",
    "source_url",
    "api_source_url",
)

CALENDAR_EXPECTED_COLUMNS: tuple[str, ...] = (
    "academic_term",
    "month",
    "start_date_display",
    "end_date_display",
    "event",
    "event_url",
    "source_url",
)


class EventsCsvError(ValueError):
    """An export does not have the measured structure."""


def _read_rows(
    path: Path | str, expected_columns: tuple[str, ...]
) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle)
        try:
            header = tuple(next(reader))
        except StopIteration:
            raise EventsCsvError("the export has no header row") from None
        if header != expected_columns:
            raise EventsCsvError(
                f"unexpected header: got {header!r}, expected the "
                f"{len(expected_columns)} measured column names"
            )
        rows: list[dict[str, str]] = []
        for line_number, cells in enumerate(reader, start=2):
            if not cells:
                continue  # a trailing blank line is not a record
            if len(cells) != len(expected_columns):
                raise EventsCsvError(
                    f"row {line_number}: {len(cells)} columns, "
                    f"expected {len(expected_columns)}"
                )
            rows.append(dict(zip(expected_columns, cells)))
    return rows


def load_upcoming_events_csv(
    path: Path | str,
) -> tuple[UpcomingEventRecord, ...]:
    """Load and validate the LiveWhale snapshot, records in source order."""
    return tuple(
        UpcomingEventRecord(
            event_id=raw["event_id"],
            title=raw["title"],
            start_date_iso=raw["start_date_iso"],
            end_date_iso=raw["end_date_iso"],
            all_day=raw["all_day"],
            canceled=raw["canceled"],
            online=raw["online"],
            online_type=raw["online_type"],
            location=raw["location"],
            latitude=raw["latitude"],
            longitude=raw["longitude"],
            cost=raw["cost"],
            organizer=raw["organizer"],
            event_types=raw["event_types"],
            tags=raw["tags"],
            source_url=raw["source_url"],
            raw=raw,
        )
        for raw in _read_rows(path, UPCOMING_EXPECTED_COLUMNS)
    )


def load_academic_calendar_csv(path: Path | str) -> tuple[RegistrarEntry, ...]:
    """Load and validate the registrar export, entries in source order."""
    return tuple(
        RegistrarEntry(
            academic_term=raw["academic_term"],
            month=raw["month"],
            start_date_display=raw["start_date_display"],
            end_date_display=raw["end_date_display"],
            event=raw["event"],
            event_url=raw["event_url"],
            source_url=raw["source_url"],
            raw=raw,
        )
        for raw in _read_rows(path, CALENDAR_EXPECTED_COLUMNS)
    )
