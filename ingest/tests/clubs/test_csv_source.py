"""Strict loading of the user-provided student-groups export."""

from __future__ import annotations

from pathlib import Path

import pytest

from brownsync_ingest.clubs.csv_source import (
    EXPECTED_COLUMNS,
    ClubsCsvError,
    load_clubs_csv,
)

INGEST_ROOT = Path(__file__).resolve().parents[2]
REAL_CSV = INGEST_ROOT / "fixtures" / "user_provided" / "brown_all_student_groups.csv"

HEADER = (
    "group_type,name,description,contact_emails,advisor,funding_category,tags,"
    "website_url,instagram_url,facebook_url,linkedin_url,youtube_url,twitter_url,"
    "tiktok_url,other_social_urls,source_url,directory_source_url"
)


def row(
    *,
    group_type: str = "Undergraduate student group",
    name: str = "Example Club",
    description: str = "We do things.",
    contact_emails: str = "example@brown.edu",
    advisor: str = "A. Advisor",
    funding_category: str = "Category 2",
    tags: str = "UCS Recognized Undergrad Student Groups",
    website_url: str = "",
    instagram_url: str = "",
    source_url: str = "https://studentactivities.brown.edu/organizations/example-club",
    directory_source_url: str = "https://studentactivities.brown.edu/student-groups/undergraduate-student-groups",
) -> str:
    cells = [
        group_type, name, description, contact_emails, advisor, funding_category,
        tags, website_url, instagram_url, "", "", "", "", "", "",
        source_url, directory_source_url,
    ]
    return ",".join(
        f'"{cell}"' if ("," in cell or '"' in cell or "\n" in cell) else cell
        for cell in cells
    )


def write_csv(tmp_path: Path, *rows: str, header: str = HEADER, bom: bool = True) -> Path:
    path = tmp_path / "groups.csv"
    prefix = "﻿" if bom else ""
    path.write_text(prefix + header + "\n" + "\n".join(rows) + "\n", encoding="utf-8")
    return path


class TestHeaderAndShape:
    def test_expected_columns_are_the_seventeen_measured_names(self) -> None:
        assert EXPECTED_COLUMNS == (
            "group_type", "name", "description", "contact_emails", "advisor",
            "funding_category", "tags", "website_url", "instagram_url",
            "facebook_url", "linkedin_url", "youtube_url", "twitter_url",
            "tiktok_url", "other_social_urls", "source_url", "directory_source_url",
        )

    def test_utf8_bom_header_is_accepted(self, tmp_path: Path) -> None:
        records, dropped = load_clubs_csv(write_csv(tmp_path, row()))
        assert dropped == 0
        assert records[0].group_type == "Undergraduate student group"

    def test_missing_bom_is_accepted_too(self, tmp_path: Path) -> None:
        records, _ = load_clubs_csv(write_csv(tmp_path, row(), bom=False))
        assert len(records) == 1

    def test_wrong_header_is_refused(self, tmp_path: Path) -> None:
        with pytest.raises(ClubsCsvError) as excinfo:
            load_clubs_csv(write_csv(tmp_path, row(), header=HEADER.replace("advisor", "adviser")))
        assert "header" in str(excinfo.value)

    def test_short_data_row_is_refused(self, tmp_path: Path) -> None:
        with pytest.raises(ClubsCsvError) as excinfo:
            load_clubs_csv(write_csv(tmp_path, "Undergraduate student group,Only Two"))
        assert "column" in str(excinfo.value)

    def test_missing_file_is_a_loud_error(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            load_clubs_csv(tmp_path / "absent.csv")


class TestRecords:
    def test_values_are_verbatim_and_raw_keeps_every_column(self, tmp_path: Path) -> None:
        records, _ = load_clubs_csv(
            write_csv(tmp_path, row(name="Abhinaya, Brown", website_url="https://example.org"))
        )
        record = records[0]
        assert record.name == "Abhinaya, Brown"
        assert record.website_url == "https://example.org"
        assert record.facebook_url == ""
        assert dict(record.raw)["name"] == "Abhinaya, Brown"
        assert set(record.raw) == set(EXPECTED_COLUMNS)

    def test_quoted_embedded_newlines_stay_one_logical_record(self, tmp_path: Path) -> None:
        records, _ = load_clubs_csv(
            write_csv(tmp_path, row(description="line one\nline two"))
        )
        assert len(records) == 1
        assert records[0].description == "line one\nline two"

    def test_records_keep_source_order(self, tmp_path: Path) -> None:
        records, _ = load_clubs_csv(
            write_csv(tmp_path, row(name="Zeta"), row(name="Alpha"))
        )
        assert [record.name for record in records] == ["Zeta", "Alpha"]


class TestDedupe:
    def test_same_name_and_group_type_first_wins(self, tmp_path: Path) -> None:
        records, dropped = load_clubs_csv(
            write_csv(
                tmp_path,
                row(name="Twice Club", description="first"),
                row(name="Twice Club", description="second"),
            )
        )
        assert dropped == 1
        assert [record.description for record in records] == ["first"]

    def test_same_name_across_group_types_is_not_a_duplicate(self, tmp_path: Path) -> None:
        records, dropped = load_clubs_csv(
            write_csv(
                tmp_path,
                row(name="Chinese Students and Scholars Association"),
                row(
                    name="Chinese Students and Scholars Association",
                    group_type="Graduate student group",
                    funding_category="",
                    tags="Graduate Student Council recognized group",
                ),
            )
        )
        assert dropped == 0
        assert len(records) == 2


class TestRealExport:
    def test_the_real_export_loads_with_the_measured_shape(self) -> None:
        records, dropped = load_clubs_csv(REAL_CSV)
        assert dropped == 0
        assert len(records) == 457
        by_type: dict[str, int] = {}
        for record in records:
            by_type[record.group_type] = by_type.get(record.group_type, 0) + 1
        assert by_type == {
            "Undergraduate student group": 424,
            "Graduate student group": 33,
        }
        assert all(record.name.strip() == record.name for record in records)
