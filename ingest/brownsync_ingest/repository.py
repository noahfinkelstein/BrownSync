"""Direct Postgres persistence for contract rows and source-run lifecycle.

Every statement is fully parameterized; values never appear in SQL text.
Rows are only ever inserted or updated in place — nothing is ever removed.
"""

from __future__ import annotations

from datetime import datetime
from typing import Collection, Iterator, Literal, Sequence
from contextlib import contextmanager

import psycopg
from psycopg.types.json import Json

from brownsync_ingest.contract import (
    CourseMeetingRow,
    EventRow,
    OrganizationRow,
    PlaceRow,
)


_PLACES_UPSERT = """\
INSERT INTO places (
    id, name, aliases, kind, lat, lng, polygon, address, osm_id, source
) VALUES (
    %s, %s, %s, %s, %s, %s, ST_Multi(ST_GeomFromText(%s, 4326)), %s, %s, %s
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    aliases = EXCLUDED.aliases,
    kind = EXCLUDED.kind,
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    polygon = EXCLUDED.polygon,
    address = EXCLUDED.address,
    osm_id = EXCLUDED.osm_id,
    source = EXCLUDED.source
"""

_ORGANIZATIONS_UPSERT = """\
INSERT INTO organizations (
    id, name, kind, category, description, url, instagram, default_place_id, source
) VALUES (
    %s, %s, %s, %s, %s, %s, %s, %s, %s
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    kind = EXCLUDED.kind,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    url = EXCLUDED.url,
    instagram = EXCLUDED.instagram,
    default_place_id = EXCLUDED.default_place_id,
    source = EXCLUDED.source
"""

_EVENT_BASE_COLUMNS = (
    "source", "source_id", "canonical_id", "title", "description", "start_ts",
    "end_ts", "is_all_day", "rrule", "location_raw", "place_id", "lat", "lng",
    "org_id", "category", "tags", "url", "cost", "confidence", "is_canceled", "raw",
)

_EVENTS_CONFLICT_REFRESH = """\
ON CONFLICT (source, source_id) DO UPDATE SET
    canonical_id = EXCLUDED.canonical_id,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    start_ts = EXCLUDED.start_ts,
    end_ts = EXCLUDED.end_ts,
    is_all_day = EXCLUDED.is_all_day,
    rrule = EXCLUDED.rrule,
    location_raw = EXCLUDED.location_raw,
    place_id = EXCLUDED.place_id,
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    org_id = EXCLUDED.org_id,
    category = EXCLUDED.category,
    tags = EXCLUDED.tags,
    url = EXCLUDED.url,
    cost = EXCLUDED.cost,
    confidence = EXCLUDED.confidence,
    last_seen_at = EXCLUDED.last_seen_at,
    is_canceled = EXCLUDED.is_canceled,
    raw = EXCLUDED.raw
"""

_COURSE_MEETINGS_UPSERT = """\
INSERT INTO course_meetings (
    id, srcdb, crn, course_code, title, instructor, days, start_time, end_time, location_raw, place_id, room, enrollment, raw
) VALUES (
    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
)
ON CONFLICT (id) DO UPDATE SET
    srcdb = EXCLUDED.srcdb,
    crn = EXCLUDED.crn,
    course_code = EXCLUDED.course_code,
    title = EXCLUDED.title,
    instructor = EXCLUDED.instructor,
    days = EXCLUDED.days,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    location_raw = EXCLUDED.location_raw,
    place_id = EXCLUDED.place_id,
    room = EXCLUDED.room,
    enrollment = EXCLUDED.enrollment,
    raw = EXCLUDED.raw
"""

_CANCEL_MISSING_EVENTS = """\
UPDATE events
SET is_canceled = true, last_seen_at = now()
WHERE source = %s
  AND start_ts >= %s
  AND start_ts < %s
  AND NOT (source_id = ANY(%s))
"""

_START_SOURCE_RUN = """\
INSERT INTO source_runs (source, started_at, status)
VALUES (%s, %s, %s)
RETURNING id
"""

_FINISH_SOURCE_RUN = """\
UPDATE source_runs
SET finished_at = %s, status = %s, items_upserted = %s, error = %s
WHERE id = %s
"""

_FINISH_STATUSES = ("ok", "partial", "error")


def _require_aware(value: datetime, name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")
    return value


def _adapt_json(value: object) -> Json | None:
    return None if value is None else Json(value)


class PostgresRepository:
    """Upsert contract rows and record source-run health over one connection."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._connection = connection

    @classmethod
    def connect(cls, database_url: str) -> PostgresRepository:
        return cls(psycopg.connect(database_url, autocommit=False))

    def close(self) -> None:
        self._connection.close()

    @contextmanager
    def _transaction(self) -> Iterator[psycopg.Cursor]:
        try:
            with self._connection.cursor() as cursor:
                yield cursor
        except BaseException:
            self._connection.rollback()
            raise
        else:
            self._connection.commit()

    def upsert_places(self, rows: Sequence[PlaceRow]) -> int:
        if not rows:
            return 0
        with self._transaction() as cursor:
            for row in rows:
                cursor.execute(
                    _PLACES_UPSERT,
                    (
                        row.id, row.name, list(row.aliases), row.kind, row.lat,
                        row.lng, row.polygon, row.address, row.osm_id, row.source,
                    ),
                )
        return len(rows)

    def upsert_organizations(self, rows: Sequence[OrganizationRow]) -> int:
        if not rows:
            return 0
        with self._transaction() as cursor:
            for row in rows:
                cursor.execute(
                    _ORGANIZATIONS_UPSERT,
                    (
                        row.id, row.name, row.kind, row.category, row.description,
                        row.url, row.instagram, row.default_place_id, row.source,
                    ),
                )
        return len(rows)

    def upsert_events(self, rows: Sequence[EventRow]) -> int:
        if not rows:
            return 0
        with self._transaction() as cursor:
            for row in rows:
                cursor.execute(*self._event_statement(row))
        return len(rows)

    def _event_statement(self, row: EventRow) -> tuple[str, tuple[object, ...]]:
        columns: list[str] = []
        params: list[object] = []
        if row.id is not None:
            columns.append("id")
            params.append(row.id)
        columns.extend(_EVENT_BASE_COLUMNS)
        params.extend(
            (
                row.source, row.source_id, row.canonical_id, row.title,
                row.description, row.start_ts, row.end_ts, row.is_all_day,
                row.rrule, row.location_raw, row.place_id, row.lat, row.lng,
                row.org_id, row.category, list(row.tags), row.url, row.cost,
                row.confidence, row.is_canceled, _adapt_json(row.raw),
            )
        )
        if row.first_seen_at is not None:
            columns.append("first_seen_at")
            params.append(row.first_seen_at)
        if row.last_seen_at is not None:
            columns.append("last_seen_at")
            params.append(row.last_seen_at)
        placeholders = ", ".join(["%s"] * len(columns))
        sql = (
            f"INSERT INTO events ({', '.join(columns)}) VALUES ({placeholders})\n"
            + _EVENTS_CONFLICT_REFRESH
        )
        return sql, tuple(params)

    def upsert_course_meetings(self, rows: Sequence[CourseMeetingRow]) -> int:
        if not rows:
            return 0
        with self._transaction() as cursor:
            for row in rows:
                cursor.execute(
                    _COURSE_MEETINGS_UPSERT,
                    (
                        row.id, row.srcdb, row.crn, row.course_code, row.title,
                        row.instructor, row.days, row.start_time, row.end_time,
                        row.location_raw, row.place_id, row.room, row.enrollment,
                        _adapt_json(row.raw),
                    ),
                )
        return len(rows)

    def cancel_missing_events(
        self,
        *,
        source: str,
        coverage_start: datetime,
        coverage_end: datetime,
        seen_source_ids: Collection[str],
        complete: bool,
    ) -> int:
        _require_aware(coverage_start, "coverage_start")
        _require_aware(coverage_end, "coverage_end")
        if coverage_end <= coverage_start:
            raise ValueError("coverage_end must be after coverage_start")
        if complete is not True:
            raise ValueError("cancellation requires an explicitly complete fetch")
        seen = sorted(set(seen_source_ids))
        with self._transaction() as cursor:
            cursor.execute(
                _CANCEL_MISSING_EVENTS,
                (source, coverage_start, coverage_end, seen),
            )
            return cursor.rowcount

    def start_source_run(self, source: str, started_at: datetime) -> int:
        _require_aware(started_at, "started_at")
        with self._transaction() as cursor:
            cursor.execute(_START_SOURCE_RUN, (source, started_at, "partial"))
            returned = cursor.fetchone()
            if returned is None:
                raise RuntimeError("source run insert returned no id")
            return int(returned[0])

    def finish_source_run(
        self,
        run_id: int,
        *,
        finished_at: datetime,
        status: Literal["ok", "partial", "error"],
        items_upserted: int,
        error: str | None,
    ) -> None:
        _require_aware(finished_at, "finished_at")
        if status not in _FINISH_STATUSES:
            raise ValueError("status must be one of 'ok', 'partial', 'error'")
        if items_upserted < 0:
            raise ValueError("items_upserted must be non-negative")
        with self._transaction() as cursor:
            cursor.execute(
                _FINISH_SOURCE_RUN,
                (finished_at, status, items_upserted, error, run_id),
            )
            if cursor.rowcount != 1:
                raise LookupError(f"source run {run_id} does not exist")
