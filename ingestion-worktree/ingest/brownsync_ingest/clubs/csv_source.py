"""Strict loading of ``brown_all_student_groups.csv`` (user-provided).

The export is hash-pinned in ``fixtures/manifest.json``; this loader still
refuses structural surprises (header drift, ragged rows) loudly instead of
mis-parsing them. Values are kept verbatim; ``raw`` retains every column.
Duplicate ``(group_type, name)`` pairs are first-wins deduped with a drop
count — the same organization listed by BOTH directories (undergraduate and
graduate) is two distinct directory entries, not a duplicate.
"""

from __future__ import annotations

import csv
from pathlib import Path

from brownsync_ingest.clubs.models import ClubRecord


EXPECTED_COLUMNS: tuple[str, ...] = (
    "group_type",
    "name",
    "description",
    "contact_emails",
    "advisor",
    "funding_category",
    "tags",
    "website_url",
    "instagram_url",
    "facebook_url",
    "linkedin_url",
    "youtube_url",
    "twitter_url",
    "tiktok_url",
    "other_social_urls",
    "source_url",
    "directory_source_url",
)


class ClubsCsvError(ValueError):
    """The export does not have the measured structure."""


def load_clubs_csv(path: Path | str) -> tuple[tuple[ClubRecord, ...], int]:
    """Load, validate, and dedupe the export.

    Returns ``(records, duplicates_dropped)`` with records in source order.
    """
    with open(path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle)
        try:
            header = tuple(next(reader))
        except StopIteration:
            raise ClubsCsvError("the export has no header row") from None
        if header != EXPECTED_COLUMNS:
            raise ClubsCsvError(
                f"unexpected header: got {header!r}, expected the "
                f"{len(EXPECTED_COLUMNS)} measured column names"
            )
        records: list[ClubRecord] = []
        seen: set[tuple[str, str]] = set()
        dropped = 0
        for line_number, cells in enumerate(reader, start=2):
            if not cells:
                continue  # a trailing blank line is not a record
            if len(cells) != len(EXPECTED_COLUMNS):
                raise ClubsCsvError(
                    f"row {line_number}: {len(cells)} columns, "
                    f"expected {len(EXPECTED_COLUMNS)}"
                )
            raw = dict(zip(EXPECTED_COLUMNS, cells))
            key = (raw["group_type"], raw["name"])
            if key in seen:
                dropped += 1
                continue
            seen.add(key)
            records.append(ClubRecord(**raw, raw=raw))
    return tuple(records), dropped
