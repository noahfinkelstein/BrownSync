"""Loading and validating the user-provided CAB export CSV.

The export is UTF-8 with a BOM; quoted cells may hold commas and embedded
newlines (six course titles do). The header must match the known export
columns exactly — a changed export must fail loudly, never half-load.
"""

from __future__ import annotations

import csv
from pathlib import Path

from brownsync_ingest.cab.models import CabCsvRecord


EXPECTED_COLUMNS: tuple[str, ...] = (
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

_REQUIRED_NON_BLANK = ("term_code", "crn", "course_code", "course_title")
_BOOLEANS = {"true": True, "false": False}


class CabCsvError(ValueError):
    """The export does not match the known shape; nothing was loaded."""


def _record(row: dict[str, str], line: int) -> CabCsvRecord:
    if any(value is None for value in row.values()) or None in row:
        raise CabCsvError(f"row at data line {line} has the wrong number of cells")
    for field in _REQUIRED_NON_BLANK:
        if not row[field].strip():
            raise CabCsvError(f"row at data line {line} has a blank {field}")
    cancelled = _BOOLEANS.get(row["cancelled"])
    if cancelled is None:
        raise CabCsvError(
            f"row at data line {line} has non-boolean cancelled {row['cancelled']!r}"
        )
    return CabCsvRecord(
        term=row["term"],
        term_code=row["term_code"],
        course_code=row["course_code"],
        course_title=row["course_title"],
        section=row["section"],
        crn=row["crn"],
        meeting_schedule=row["meeting_schedule"],
        location=row["location"],
        location_status=row["location_status"],
        instructor=row["instructor"],
        schedule_type_code=row["schedule_type_code"],
        class_status=row["class_status"],
        cab_status_code=row["cab_status_code"],
        cancelled=cancelled,
        start_date=row["start_date"],
        end_date=row["end_date"],
        cab_schedule_and_location=row["cab_schedule_and_location"],
        source_url=row["source_url"],
        raw=dict(row),
    )


def load_cab_csv(path: Path | str) -> tuple[tuple[CabCsvRecord, ...], int]:
    """Load the export; return records deduped on (term_code, crn) + drops.

    The first occurrence of a ``(term_code, crn)`` identity wins; later
    occurrences are counted, never silently ignored.
    """
    with open(path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        header = tuple(reader.fieldnames or ())
        if header != EXPECTED_COLUMNS:
            raise CabCsvError(
                f"unexpected export header {header!r}; expected {EXPECTED_COLUMNS!r}"
            )
        records: list[CabCsvRecord] = []
        seen: set[tuple[str, str]] = set()
        dropped = 0
        for line, row in enumerate(reader, start=1):
            record = _record(row, line)
            identity = (record.term_code, record.crn)
            if identity in seen:
                dropped += 1
                continue
            seen.add(identity)
            records.append(record)
    if not records:
        raise CabCsvError("the export holds no data rows")
    return tuple(records), dropped
