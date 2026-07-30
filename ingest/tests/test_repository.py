from __future__ import annotations

from datetime import UTC, datetime, time, timezone, timedelta
import inspect
from uuid import UUID

import pytest
from psycopg.types.json import Json

from brownsync_ingest import repository
from brownsync_ingest.contract import (
    CourseMeetingRow,
    EventRow,
    OrganizationRow,
    PlaceRow,
)
from brownsync_ingest.repository import PostgresRepository


class FakeCursor:
    def __init__(self, connection: FakeConnection) -> None:
        self._connection = connection
        self.rowcount = -1

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *exc_info: object) -> bool:
        return False

    def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
        connection = self._connection
        if connection.fail_at_execute is not None and len(connection.executed) == connection.fail_at_execute:
            raise RuntimeError("injected execute failure")
        connection.executed.append((sql, params))
        self.rowcount = connection.rowcounts.pop(0) if connection.rowcounts else 1

    def fetchone(self) -> tuple[object, ...] | None:
        return self._connection.fetchone_results.pop(0)


class FakeConnection:
    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple[object, ...] | None]] = []
        self.commits = 0
        self.rollbacks = 0
        self.closed = False
        self.fail_at_execute: int | None = None
        self.rowcounts: list[int] = []
        self.fetchone_results: list[tuple[object, ...] | None] = []

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        self.closed = True


def place(place_id: str, **overrides: object) -> PlaceRow:
    payload: dict[str, object] = {
        "id": place_id,
        "name": place_id.replace("-", " ").title(),
        "kind": "academic",
        "lat": 41.826,
        "lng": -71.405,
    }
    payload.update(overrides)
    return PlaceRow(**payload)


def organization(org_id: str, **overrides: object) -> OrganizationRow:
    payload: dict[str, object] = {
        "id": org_id,
        "name": org_id.replace("-", " ").title(),
        "kind": "club",
        "source": "clubs",
    }
    payload.update(overrides)
    return OrganizationRow(**payload)


def event(source_id: str, **overrides: object) -> EventRow:
    payload: dict[str, object] = {
        "source": "livewhale",
        "source_id": source_id,
        "title": source_id,
        "start_ts": datetime(2026, 9, 1, 9, tzinfo=UTC),
    }
    payload.update(overrides)
    return EventRow(**payload)


def meeting(meeting_id: str, **overrides: object) -> CourseMeetingRow:
    payload: dict[str, object] = {
        "id": meeting_id,
        "srcdb": "202710",
        "crn": "12345",
        "course_code": "CSCI 0150",
        "title": "Intro",
        "days": "MWF",
        "start_time": time(9, 0),
        "end_time": time(9, 50),
    }
    payload.update(overrides)
    return CourseMeetingRow(**payload)


def inserted_columns(sql: str) -> list[str]:
    inside = sql.split("(", 1)[1].split(")", 1)[0]
    return [column.strip() for column in inside.split(",")]


def refresh_assignments(sql: str) -> dict[str, str]:
    clause = sql.split("DO UPDATE SET", 1)[1]
    return {
        name.strip(): value.strip()
        for name, value in (part.split("=", 1) for part in clause.split(","))
    }


def test_connect_uses_psycopg_without_autocommit_and_close_closes_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = FakeConnection()
    captured: dict[str, object] = {}

    def fake_connect(conninfo: str, *, autocommit: bool) -> FakeConnection:
        captured["conninfo"] = conninfo
        captured["autocommit"] = autocommit
        return fake

    monkeypatch.setattr(repository.psycopg, "connect", fake_connect)

    repo = PostgresRepository.connect("postgresql://localhost/brownsync")

    assert captured == {"conninfo": "postgresql://localhost/brownsync", "autocommit": False}
    repo.close()
    assert fake.closed


def test_places_upsert_parameterizes_wkt_and_keeps_null_polygon_null() -> None:
    connection = FakeConnection()
    repo = PostgresRepository(connection)
    wkt = "MULTIPOLYGON(((0 0,0 1,1 1,0 0)))"

    count = repo.upsert_places(
        [
            place("barus-holley", polygon=wkt, aliases=["B&H", "BH"], address="184 Hope St"),
            place("sayles-hall"),
        ]
    )

    assert count == 2
    assert len(connection.executed) == 2
    first_sql, first_params = connection.executed[0]
    second_sql, second_params = connection.executed[1]
    assert first_sql == second_sql
    assert "ST_Multi(ST_GeomFromText(%s, 4326))" in first_sql
    assert wkt not in first_sql
    assert inserted_columns(first_sql) == [
        "id", "name", "aliases", "kind", "lat", "lng", "polygon", "address", "osm_id", "source",
    ]
    assert first_params == (
        "barus-holley", "Barus Holley", ["B&H", "BH"], "academic",
        41.826, -71.405, wkt, "184 Hope St", None, "osm",
    )
    assert second_params[6] is None
    assert connection.commits == 1
    assert connection.rollbacks == 0


def test_places_upsert_refreshes_every_source_owned_column_on_id_conflict() -> None:
    connection = FakeConnection()
    PostgresRepository(connection).upsert_places([place("barus-holley")])

    sql = connection.executed[0][0]
    assert "ON CONFLICT (id) DO UPDATE SET" in sql
    assignments = refresh_assignments(sql)
    assert set(assignments) == {
        "name", "aliases", "kind", "lat", "lng", "polygon", "address", "osm_id", "source",
    }
    assert all(value == f"EXCLUDED.{name}" for name, value in assignments.items())


def test_organizations_upsert_uses_exactly_the_contract_columns() -> None:
    connection = FakeConnection()
    repo = PostgresRepository(connection)

    count = repo.upsert_organizations(
        [
            organization(
                "brown-outing-club",
                category="club",
                url="https://boc.brown.edu",
                contact_emails=["president@brown.edu"],
                advisor="A. Advisor",
                funding_category="Category 2",
                website_url="https://brownoutingclub.example",
                instagram="https://instagram.com/brownoutingclub",
                facebook_url="https://facebook.com/brownoutingclub",
                linkedin_url="https://linkedin.com/company/brownoutingclub",
                youtube_url="https://youtube.com/@brownoutingclub",
                twitter_url="https://x.com/brownoutingclub",
                tiktok_url="https://tiktok.com/@brownoutingclub",
            )
        ]
    )

    assert count == 1
    sql, params = connection.executed[0]
    assert "raw" not in sql
    assert inserted_columns(sql) == [
        "id", "name", "kind", "category", "description", "url", "instagram",
        "contact_emails", "advisor", "funding_category", "website_url",
        "facebook_url", "linkedin_url", "youtube_url", "twitter_url", "tiktok_url",
        "default_place_id", "source",
    ]
    assert params == (
        "brown-outing-club", "Brown Outing Club", "club", "club", None,
        "https://boc.brown.edu", "https://instagram.com/brownoutingclub",
        ["president@brown.edu"], "A. Advisor", "Category 2",
        "https://brownoutingclub.example", "https://facebook.com/brownoutingclub",
        "https://linkedin.com/company/brownoutingclub",
        "https://youtube.com/@brownoutingclub", "https://x.com/brownoutingclub",
        "https://tiktok.com/@brownoutingclub", None, "clubs",
    )
    assert "ON CONFLICT (id) DO UPDATE SET" in sql
    assignments = refresh_assignments(sql)
    assert set(assignments) == {
        "name", "kind", "category", "description", "url", "instagram",
        "contact_emails", "advisor", "funding_category", "website_url",
        "facebook_url", "linkedin_url", "youtube_url", "twitter_url", "tiktok_url",
        "default_place_id", "source",
    }
    assert all(value == f"EXCLUDED.{name}" for name, value in assignments.items())
    assert connection.commits == 1


def test_events_upsert_omits_database_default_columns_for_fresh_sightings() -> None:
    connection = FakeConnection()
    PostgresRepository(connection).upsert_events([event("ev-1")])

    sql, params = connection.executed[0]
    columns = inserted_columns(sql)
    assert "id" not in columns
    assert "first_seen_at" not in columns
    assert "last_seen_at" not in columns
    assert columns == [
        "source", "source_id", "canonical_id", "title", "description", "start_ts",
        "end_ts", "is_all_day", "rrule", "location_raw", "place_id", "lat", "lng",
        "org_id", "category", "tags", "url", "cost", "confidence", "is_canceled", "raw",
    ]
    assert params == (
        "livewhale", "ev-1", None, "ev-1", None, datetime(2026, 9, 1, 9, tzinfo=UTC),
        None, False, None, None, None, None, None, None, None, [], None, None,
        1.0, False, None,
    )
    assert params[len(params) - 2] is False


def test_events_upsert_binds_explicit_identity_and_sighting_timestamps() -> None:
    connection = FakeConnection()
    row_id = UUID("a3b7e39e-0c6f-4ee0-a5a0-0486ef8bc5cc")
    first_seen = datetime(2026, 8, 1, 12, tzinfo=UTC)
    last_seen = datetime(2026, 8, 2, 12, tzinfo=UTC)

    PostgresRepository(connection).upsert_events(
        [event("ev-2", id=row_id, first_seen_at=first_seen, last_seen_at=last_seen)]
    )

    sql, params = connection.executed[0]
    columns = inserted_columns(sql)
    assert columns[0] == "id"
    assert columns[-2:] == ["first_seen_at", "last_seen_at"]
    assert params[0] == row_id
    assert params[-2:] == (first_seen, last_seen)


def test_events_upsert_conflicts_on_source_pair_and_never_reassigns_identity() -> None:
    connection = FakeConnection()
    PostgresRepository(connection).upsert_events([event("ev-3")])

    sql = connection.executed[0][0]
    assert "ON CONFLICT (source, source_id) DO UPDATE SET" in sql
    assignments = refresh_assignments(sql)
    assert set(assignments) == {
        "canonical_id", "title", "description", "start_ts", "end_ts", "is_all_day",
        "rrule", "location_raw", "place_id", "lat", "lng", "org_id", "category",
        "tags", "url", "cost", "confidence", "last_seen_at", "is_canceled", "raw",
    }
    assert "id" not in assignments
    assert "first_seen_at" not in assignments
    assert all(value == f"EXCLUDED.{name}" for name, value in assignments.items())
    assert assignments["is_canceled"] == "EXCLUDED.is_canceled"


def test_events_upsert_adapts_raw_json_and_binds_arrays_as_parameters() -> None:
    connection = FakeConnection()
    raw = {"id": 42, "types": ["lecture"], "nested": {"ok": True}}

    PostgresRepository(connection).upsert_events(
        [event("ev-4", tags=["free-food", "lecture"], raw=raw)]
    )

    params = connection.executed[0][1]
    tags_param = params[15]
    raw_param = params[20]
    assert tags_param == ["free-food", "lecture"]
    assert isinstance(raw_param, Json)
    assert raw_param.obj == raw


def test_course_meetings_upsert_refreshes_all_source_owned_columns_on_id() -> None:
    connection = FakeConnection()
    repo = PostgresRepository(connection)

    count = repo.upsert_course_meetings(
        [meeting("202710-12345-0", raw={"crn": "12345"}, enrollment=220)]
    )

    assert count == 1
    sql, params = connection.executed[0]
    assert inserted_columns(sql) == [
        "id", "srcdb", "crn", "course_code", "title", "instructor", "days",
        "start_time", "end_time", "location_raw", "place_id", "room",
        "enrollment", "raw",
    ]
    assert params[:9] == (
        "202710-12345-0", "202710", "12345", "CSCI 0150", "Intro", None, "MWF",
        time(9, 0), time(9, 50),
    )
    assert params[12] == 220
    assert isinstance(params[13], Json)
    assert params[13].obj == {"crn": "12345"}
    assert "ON CONFLICT (id) DO UPDATE SET" in sql
    assignments = refresh_assignments(sql)
    assert set(assignments) == {
        "srcdb", "crn", "course_code", "title", "instructor", "days", "start_time",
        "end_time", "location_raw", "place_id", "room", "enrollment", "raw",
    }
    assert all(value == f"EXCLUDED.{name}" for name, value in assignments.items())


def test_empty_batches_return_zero_without_touching_the_connection() -> None:
    connection = FakeConnection()
    repo = PostgresRepository(connection)

    assert repo.upsert_places([]) == 0
    assert repo.upsert_organizations([]) == 0
    assert repo.upsert_events([]) == 0
    assert repo.upsert_course_meetings([]) == 0

    assert connection.executed == []
    assert connection.commits == 0
    assert connection.rollbacks == 0


def test_mid_batch_failure_rolls_back_the_whole_batch_without_committing() -> None:
    connection = FakeConnection()
    connection.fail_at_execute = 1
    repo = PostgresRepository(connection)

    with pytest.raises(RuntimeError, match="injected execute failure"):
        repo.upsert_places([place("first"), place("second"), place("third")])

    assert len(connection.executed) == 1
    assert connection.commits == 0
    assert connection.rollbacks == 1


def test_cancel_missing_events_requires_a_complete_aware_increasing_window() -> None:
    connection = FakeConnection()
    repo = PostgresRepository(connection)
    aware_start = datetime(2026, 9, 1, tzinfo=UTC)
    aware_end = datetime(2026, 9, 8, tzinfo=UTC)

    with pytest.raises(ValueError, match="timezone-aware"):
        repo.cancel_missing_events(
            source="livewhale", coverage_start=datetime(2026, 9, 1),
            coverage_end=aware_end, seen_source_ids=[], complete=True,
        )
    with pytest.raises(ValueError, match="timezone-aware"):
        repo.cancel_missing_events(
            source="livewhale", coverage_start=aware_start,
            coverage_end=datetime(2026, 9, 8), seen_source_ids=[], complete=True,
        )
    with pytest.raises(ValueError, match="coverage_end"):
        repo.cancel_missing_events(
            source="livewhale", coverage_start=aware_end,
            coverage_end=aware_start, seen_source_ids=[], complete=True,
        )
    with pytest.raises(ValueError, match="coverage_end"):
        repo.cancel_missing_events(
            source="livewhale", coverage_start=aware_start,
            coverage_end=aware_start, seen_source_ids=[], complete=True,
        )
    with pytest.raises(ValueError, match="complete"):
        repo.cancel_missing_events(
            source="livewhale", coverage_start=aware_start,
            coverage_end=aware_end, seen_source_ids=["ev-1"], complete=False,
        )

    assert connection.executed == []
    assert connection.commits == 0
    assert connection.rollbacks == 0


def test_cancel_missing_events_updates_only_unseen_rows_inside_the_window() -> None:
    connection = FakeConnection()
    connection.rowcounts = [3]
    repo = PostgresRepository(connection)
    start = datetime(2026, 9, 1, tzinfo=UTC)
    end = datetime(2026, 9, 8, tzinfo=UTC)

    count = repo.cancel_missing_events(
        source="livewhale", coverage_start=start, coverage_end=end,
        seen_source_ids=["ev-9", "ev-1", "ev-9"], complete=True,
    )

    assert count == 3
    assert len(connection.executed) == 1
    sql, params = connection.executed[0]
    assert sql.startswith("UPDATE events")
    assert "SET is_canceled = true, last_seen_at = now()" in sql
    assert "WHERE source = %s" in sql
    assert "start_ts >= %s" in sql
    assert "start_ts < %s" in sql
    assert "NOT (source_id = ANY(%s))" in sql
    assert params == ("livewhale", start, end, ["ev-1", "ev-9"])
    assert connection.commits == 1


def test_cancel_missing_events_with_empty_seen_set_cancels_every_window_row() -> None:
    connection = FakeConnection()
    connection.rowcounts = [11]
    repo = PostgresRepository(connection)

    count = repo.cancel_missing_events(
        source="cab",
        coverage_start=datetime(2026, 9, 1, tzinfo=UTC),
        coverage_end=datetime(2026, 9, 8, tzinfo=UTC),
        seen_source_ids=[],
        complete=True,
    )

    assert count == 11
    assert connection.executed[0][1][3] == []


def test_cancel_missing_events_accepts_non_utc_aware_windows() -> None:
    connection = FakeConnection()
    eastern = timezone(timedelta(hours=-4))
    repo = PostgresRepository(connection)

    repo.cancel_missing_events(
        source="livewhale",
        coverage_start=datetime(2026, 9, 1, tzinfo=eastern),
        coverage_end=datetime(2026, 9, 8, tzinfo=eastern),
        seen_source_ids=["ev-1"],
        complete=True,
    )

    assert len(connection.executed) == 1


def test_start_source_run_inserts_partial_and_returns_the_generated_id() -> None:
    connection = FakeConnection()
    connection.fetchone_results = [(7,)]
    started = datetime(2026, 9, 1, 6, tzinfo=UTC)

    run_id = PostgresRepository(connection).start_source_run("livewhale", started)

    assert run_id == 7
    sql, params = connection.executed[0]
    assert sql.startswith("INSERT INTO source_runs")
    assert inserted_columns(sql) == ["source", "started_at", "status"]
    assert "RETURNING id" in sql
    assert params == ("livewhale", started, "partial")
    assert connection.commits == 1


def test_start_source_run_rejects_naive_timestamps_before_sql() -> None:
    connection = FakeConnection()

    with pytest.raises(ValueError, match="timezone-aware"):
        PostgresRepository(connection).start_source_run("livewhale", datetime(2026, 9, 1, 6))

    assert connection.executed == []
    assert connection.commits == 0


def test_finish_source_run_updates_exactly_the_one_existing_row() -> None:
    connection = FakeConnection()
    connection.rowcounts = [1]
    finished = datetime(2026, 9, 1, 7, tzinfo=UTC)

    PostgresRepository(connection).finish_source_run(
        7, finished_at=finished, status="ok", items_upserted=42, error=None
    )

    sql, params = connection.executed[0]
    assert sql.startswith("UPDATE source_runs")
    assert "SET finished_at = %s, status = %s, items_upserted = %s, error = %s" in sql
    assert "WHERE id = %s" in sql
    assert params == (finished, "ok", 42, None, 7)
    assert connection.commits == 1
    assert connection.rollbacks == 0


def test_finish_source_run_fails_and_rolls_back_when_the_run_id_is_unknown() -> None:
    connection = FakeConnection()
    connection.rowcounts = [0]

    with pytest.raises(LookupError, match="99"):
        PostgresRepository(connection).finish_source_run(
            99,
            finished_at=datetime(2026, 9, 1, 7, tzinfo=UTC),
            status="error",
            items_upserted=0,
            error="boom",
        )

    assert connection.commits == 0
    assert connection.rollbacks == 1


def test_finish_source_run_validates_status_count_and_timezone_before_sql() -> None:
    connection = FakeConnection()
    finished = datetime(2026, 9, 1, 7, tzinfo=UTC)
    repo = PostgresRepository(connection)

    with pytest.raises(ValueError, match="status"):
        repo.finish_source_run(7, finished_at=finished, status="done", items_upserted=0, error=None)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="items_upserted"):
        repo.finish_source_run(7, finished_at=finished, status="ok", items_upserted=-1, error=None)
    with pytest.raises(ValueError, match="timezone-aware"):
        repo.finish_source_run(
            7, finished_at=datetime(2026, 9, 1, 7), status="ok", items_upserted=0, error=None
        )

    assert connection.executed == []
    assert connection.commits == 0


def test_repository_defines_and_executes_no_row_removal_statement() -> None:
    source_text = inspect.getsource(repository)
    assert "DELETE" not in source_text.upper()

    connection = FakeConnection()
    connection.fetchone_results = [(1,)]
    repo = PostgresRepository(connection)
    repo.upsert_places([place("barus-holley", polygon="MULTIPOLYGON(((0 0,0 1,1 1,0 0)))")])
    repo.upsert_organizations([organization("brown-outing-club")])
    repo.upsert_events([event("ev-1"), event("ev-2", is_canceled=True)])
    repo.upsert_course_meetings([meeting("202710-12345-0")])
    repo.cancel_missing_events(
        source="livewhale",
        coverage_start=datetime(2026, 9, 1, tzinfo=UTC),
        coverage_end=datetime(2026, 9, 8, tzinfo=UTC),
        seen_source_ids=["ev-1"],
        complete=True,
    )
    run_id = repo.start_source_run("livewhale", datetime(2026, 9, 1, 6, tzinfo=UTC))
    repo.finish_source_run(
        run_id,
        finished_at=datetime(2026, 9, 1, 7, tzinfo=UTC),
        status="ok",
        items_upserted=5,
        error=None,
    )

    executed_sql = " ".join(sql for sql, _ in connection.executed).upper()
    assert connection.executed
    for forbidden in ("DELETE", "TRUNCATE", "DROP"):
        assert forbidden not in executed_sql
