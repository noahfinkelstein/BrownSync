"""The events job: fail-closed gates, atomic publication, honest stats."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path

import pytest

from brownsync_ingest.events.csv_source import (
    CALENDAR_EXPECTED_COLUMNS,
    UPCOMING_EXPECTED_COLUMNS,
)
from brownsync_ingest.events.job import run_events_job
from brownsync_ingest.gazetteer.resolver import Resolution


@dataclass
class FakeResolver:
    outcomes: dict[str, Resolution] = field(default_factory=dict)
    queries: list[str] = field(default_factory=list)

    def resolve(self, value: str) -> Resolution:
        self.queries.append(value)
        return self.outcomes.get(
            value,
            Resolution(
                query=value,
                place_id=None,
                room=None,
                method="unresolved",
                reason="below-threshold",
                score=0.0,
                candidates=(),
            ),
        )


def resolved(place_id: str, query: str, method: str = "exact") -> Resolution:
    return Resolution(
        query=query,
        place_id=place_id,
        room=None,
        method=method,
        reason=None,
        score=None,
        candidates=(),
    )


def upcoming_row(**overrides: str) -> str:
    values = {column: "" for column in UPCOMING_EXPECTED_COLUMNS}
    values.update(
        event_id="1",
        title="Event",
        start_date_iso="2026-07-29T10:00:00-04:00",
        all_day="false",
        canceled="false",
        online="false",
        organizer="Athletics",
        source_url="https://events.brown.edu/live/events/1",
    )
    values.update(overrides)
    return ",".join(
        '"{}"'.format(values[column].replace('"', '""'))
        for column in UPCOMING_EXPECTED_COLUMNS
    )


def calendar_row(**overrides: str) -> str:
    values = dict(
        academic_term="Fall 2026",
        month="September",
        start_date_display="Wed, Sep 9",
        end_date_display="",
        event="Classes begin",
        event_url=(
            "http://events.brown.edu/academic-calendar/"
            "event/328310-classes-begin"
        ),
        source_url="https://registrar.brown.edu/academic-calendar",
    )
    values.update(overrides)
    return ",".join(
        '"{}"'.format(values[column].replace('"', '""'))
        for column in CALENDAR_EXPECTED_COLUMNS
    )


@pytest.fixture()
def paths(tmp_path: Path) -> dict[str, Path]:
    return {
        "events_csv": tmp_path / "upcoming.csv",
        "calendar_csv": tmp_path / "calendar.csv",
        "sidecar": tmp_path / "organization_livewhale_groups.json",
        "seeds": tmp_path / "seeds" / "events.ndjson",
        "staging": tmp_path / "staging",
    }


def write_events(paths: dict[str, Path], *rows: str) -> None:
    paths["events_csv"].write_text(
        ",".join(UPCOMING_EXPECTED_COLUMNS) + "\n" + "\n".join(rows) + "\n",
        encoding="utf-8",
    )


def write_calendar(paths: dict[str, Path], *rows: str) -> None:
    paths["calendar_csv"].write_text(
        ",".join(CALENDAR_EXPECTED_COLUMNS) + "\n" + "\n".join(rows) + "\n",
        encoding="utf-8",
    )


def run(
    paths: dict[str, Path],
    *,
    resolver: FakeResolver | None = None,
    min_coords: int = 0,
    min_livewhale: int = 1,
    min_admin: int = 1,
):
    return run_events_job(
        paths["events_csv"],
        paths["calendar_csv"],
        org_groups_path=paths["sidecar"],
        resolver=resolver or FakeResolver(),
        seeds_path=paths["seeds"],
        staging_root=paths["staging"],
        min_coords=min_coords,
        min_livewhale=min_livewhale,
        min_admin=min_admin,
    )


def read_seeds(paths: dict[str, Path]) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in paths["seeds"].read_text(encoding="utf-8").splitlines()
    ]


class TestPublication:
    def test_publishes_both_sources_sorted_by_identity(
        self, paths: dict[str, Path]
    ) -> None:
        write_events(
            paths,
            upcoming_row(
                event_id="2",
                latitude="41.83",
                longitude="-71.40",
            ),
            upcoming_row(event_id="1"),
        )
        write_calendar(paths, calendar_row())
        result = run(paths)
        assert result.published_count == 3
        published = read_seeds(paths)
        # 2026-07-29T10:00:00-04:00 == epoch 1785333600 (14:00Z)
        assert [(row["source"], row["source_id"]) for row in published] == [
            ("livewhale", "1:1785333600"),
            ("livewhale", "2:1785333600"),
            ("registrar", "328310"),
        ]

    def test_registrar_rows_are_admin_all_day(
        self, paths: dict[str, Path]
    ) -> None:
        write_events(paths, upcoming_row())
        write_calendar(paths, calendar_row())
        run(paths)
        registrar = [
            row for row in read_seeds(paths) if row["source"] == "registrar"
        ]
        assert registrar[0]["category"] == "admin"
        assert registrar[0]["is_all_day"] is True
        assert registrar[0]["start_ts"] == "2026-09-09T04:00:00Z"

    def test_published_rows_carry_no_contact_columns(
        self, paths: dict[str, Path]
    ) -> None:
        write_events(
            paths,
            upcoming_row(
                contact="someone@brown.edu",
                contact_emails="someone@brown.edu",
            ),
        )
        write_calendar(paths, calendar_row())
        result = run(paths)
        assert result.dropped_contact_counts == (
            ("contact", 1),
            ("contact_emails", 1),
        )
        text = paths["seeds"].read_text(encoding="utf-8")
        assert "someone@brown.edu" not in text


class TestGates:
    def test_coords_gate_counts_only_non_canceled_rows_with_both_coords(
        self, paths: dict[str, Path]
    ) -> None:
        write_events(
            paths,
            upcoming_row(event_id="1", latitude="41.8", longitude="-71.4"),
            upcoming_row(
                event_id="2",
                latitude="41.8",
                longitude="-71.4",
                canceled="true",
            ),
            upcoming_row(event_id="3"),
        )
        write_calendar(paths, calendar_row())
        result = run(paths, min_coords=2)
        assert result.coords_count == 1
        assert result.published_count is None
        assert not paths["seeds"].exists()
        failed = [c for c in result.gates.checks if not c.passed]
        assert [c.name for c in failed] == ["coords"]

    def test_livewhale_and_admin_row_gates(
        self, paths: dict[str, Path]
    ) -> None:
        write_events(paths, upcoming_row())
        write_calendar(paths, calendar_row())
        result = run(paths, min_livewhale=2)
        assert result.published_count is None
        result = run(paths, min_admin=2)
        assert result.published_count is None
        result = run(paths)
        assert result.published_count == 2

    def test_unknown_online_type_is_a_vocabulary_gate_failure(
        self, paths: dict[str, Path]
    ) -> None:
        write_events(
            paths,
            upcoming_row(online="true", online_type="Metaverse"),
        )
        write_calendar(paths, calendar_row())
        result = run(paths)
        assert result.unknown_vocabulary == ("online_type='Metaverse'",)
        assert result.published_count is None
        assert not paths["seeds"].exists()

    def test_gate_failure_leaves_the_previous_seed_untouched(
        self, paths: dict[str, Path]
    ) -> None:
        paths["seeds"].parent.mkdir(parents=True)
        paths["seeds"].write_text("previous\n", encoding="utf-8")
        write_events(paths, upcoming_row())
        write_calendar(paths, calendar_row())
        result = run(paths, min_coords=5)
        assert result.published_count is None
        assert paths["seeds"].read_text(encoding="utf-8") == "previous\n"


class TestStats:
    def test_resolution_and_org_stats(self, paths: dict[str, Path]) -> None:
        paths["sidecar"].write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "generated_at": "2026-07-29T00:00:00Z",
                    "mappings": [
                        {
                            "organization_id": "athletics",
                            "livewhale_group": "Athletics",
                            "match_method": "exact",
                            "score": 100,
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        resolver = FakeResolver(
            outcomes={"Sayles Hall": resolved("sayles-hall", "Sayles Hall")}
        )
        write_events(
            paths,
            upcoming_row(event_id="1", location="Sayles Hall"),
            upcoming_row(event_id="2", location="Mystery Basement"),
            upcoming_row(
                event_id="3", latitude="41.8", longitude="-71.4"
            ),
            upcoming_row(
                event_id="4", online="true", online_type="Online only"
            ),
        )
        write_calendar(paths, calendar_row())
        result = run(paths, resolver=resolver)
        assert result.place_resolved == 1
        assert result.resolution_methods == {"exact": 1}
        assert result.unresolved_reasons == {"below-threshold": 1}
        assert result.org_attributed == 4  # every row's organizer is linked
        assert result.online_only_count == 1
        assert sorted(resolver.queries) == ["Mystery Basement", "Sayles Hall"]
        published = read_seeds(paths)
        sayles = next(
            row for row in published if row["source_id"].startswith("1:")
        )
        assert sayles["place_id"] == "sayles-hall"
        assert all(
            row["org_id"] == "athletics"
            for row in published
            if row["source"] == "livewhale"
        )

    def test_cross_source_overlap_is_counted_not_suppressed(
        self, paths: dict[str, Path]
    ) -> None:
        write_events(paths, upcoming_row(event_id="328310"))
        write_calendar(paths, calendar_row())  # same LiveWhale id 328310
        result = run(paths)
        assert result.cross_source_overlap == 1
        assert result.published_count == 2  # both rows still published

    def test_unknown_event_types_are_reported_with_counts(
        self, paths: dict[str, Path]
    ) -> None:
        write_events(
            paths,
            upcoming_row(event_id="1", event_types="Novel Type"),
            upcoming_row(event_id="2", event_types="Novel Type"),
        )
        write_calendar(paths, calendar_row())
        result = run(paths)
        assert result.unknown_event_types == (("Novel Type", 2),)
        assert result.published_count == 3  # reported, never fatal
