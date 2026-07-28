# Task 2B: Postgres upserts and source-run lifecycle

## Context

This packet supplies direct Postgres persistence for contract rows and the run-health lifecycle used by every later job. It consumes Task 1 contract/output interfaces; Task 2A networking is independent.

## Binding constraints

- Work only in `/Users/noah_finkelstein/Developer/BrownSync/ingestion-worktree`.
- Edit only the files listed below and the task report.
- Never create tables in production code, hard-delete rows, interpolate values into SQL, stage, commit, switch branches, or touch app-side files.
- Postgres target is version 15+ with PostGIS and pg_trgm.
- Events upsert on `(source, source_id)`, preserve `id` and `first_seen_at`, refresh every source-owned mutable field and `last_seen_at`, and clear cancellation on a new non-cancelled sighting.
- Places, organizations, and course meetings upsert on `id` and refresh all source-owned mutable columns.
- Missing-event cancellation runs only after an explicitly complete fetch with an explicit coverage window. Partial/unknown coverage can never cancel.
- Every job starts exactly one `source_runs` record as `partial` and finalizes it to `ok`, `partial`, or `error`, including exception paths.
- NDJSON source-run logging is an ingestion extension: atomic append/update with monotonically increasing integer IDs.
- Tests are offline unless explicitly marked `postgres`. The marked integration suite skips when `TEST_DATABASE_URL` is absent and uses an isolated temporary schema when present.
- Strict TDD with captured RED/GREEN evidence is required.
- Run uv with `UV_CACHE_DIR=/private/tmp/brownsync-uv-cache`.

## Files

- Modify `ingest/pyproject.toml`
- Modify `ingest/uv.lock`
- Create `ingest/brownsync_ingest/repository.py`
- Create `ingest/brownsync_ingest/run_log.py`
- Create `ingest/tests/test_repository.py`
- Create `ingest/tests/test_run_log.py`
- Create `ingest/tests/test_repository_postgres.py`

## Exact interfaces

```python
class PostgresRepository:
    @classmethod
    def connect(cls, database_url: str) -> PostgresRepository: ...
    def close(self) -> None: ...
    def upsert_places(self, rows: Sequence[PlaceRow]) -> int: ...
    def upsert_organizations(self, rows: Sequence[OrganizationRow]) -> int: ...
    def upsert_events(self, rows: Sequence[EventRow]) -> int: ...
    def upsert_course_meetings(self, rows: Sequence[CourseMeetingRow]) -> int: ...
    def cancel_missing_events(
        self,
        *,
        source: str,
        coverage_start: datetime,
        coverage_end: datetime,
        seen_source_ids: Collection[str],
        complete: bool,
    ) -> int: ...
    def start_source_run(self, source: str, started_at: datetime) -> int: ...
    def finish_source_run(
        self,
        run_id: int,
        *,
        finished_at: datetime,
        status: Literal["ok", "partial", "error"],
        items_upserted: int,
        error: str | None,
    ) -> None: ...
```

```python
class NdjsonSourceRunLog:
    def __init__(self, destination: Path, staging_root: Path) -> None: ...
    def start(self, source: str, started_at: datetime) -> int: ...
    def finish(
        self,
        run_id: int,
        *,
        finished_at: datetime,
        status: RunStatus,
        items_upserted: int,
        error: str | None,
    ) -> None: ...
```

```python
class SourceRunRecorder:
    def __init__(
        self,
        sink: SourceRunSink,
        source: str,
        *,
        clock: Callable[[], datetime],
    ) -> None: ...
    def __enter__(self) -> SourceRunRecorder: ...
    def add_items(self, count: int) -> None: ...
    def mark_partial(self, reason: str) -> None: ...
    def __exit__(self, exc_type, exc, traceback) -> bool: ...
```

The recorder re-raises job exceptions (`__exit__` returns `False`) after finalizing `error`.

## SQL behavior to prove

### Places

Insert/update every contract column. Convert non-null WKT with parameterized `ST_Multi(ST_GeomFromText(%s, 4326))`; null remains SQL null.

### Organizations

Insert/update exactly the contract columns. There is no `raw`.

### Events

- Rows without `id`, `first_seen_at`, or `last_seen_at` omit those columns so DB defaults apply.
- Rows with explicit values may bind them.
- Conflict target is `(source, source_id)`.
- Conflict update refreshes `canonical_id,title,description,start_ts,end_ts,is_all_day,rrule,location_raw,place_id,lat,lng,org_id,category,tags,url,cost,confidence,last_seen_at,is_canceled,raw`.
- It never assigns `id` or `first_seen_at` in the conflict update.
- A normal incoming sighting with `is_canceled=False` clears a prior cancellation.
- JSON raw uses psycopg JSON adaptation; arrays bind safely.

### Course meetings

Insert/update every source-owned column on `id`.

### Cancellation

- Reject naive or non-increasing windows.
- If `complete=False`, raise `ValueError` before executing SQL.
- Update only canonical/source rows for the named source whose `start_ts >= coverage_start` and `< coverage_end` and whose `source_id` is absent from the seen set.
- Empty seen set cancels every in-window row for that source.
- Set `is_canceled=true` and `last_seen_at=now()`; never delete.

### Transactions

Each batch method is one transaction. Injected failure rolls back the whole batch. Empty sequences return zero without opening a transaction.

## Source-run behavior to prove

- `start_source_run` inserts `source,started_at,status='partial'` and returns `id`.
- `finish_source_run` updates exactly one existing ID with finished/status/count/error.
- Recorder success -> `ok`; explicit `mark_partial` -> `partial`; exception -> `error` with bounded `str(exc)`, then re-raises.
- Exactly one start and one finish occur per recorder.
- `add_items` rejects negative counts.
- NDJSON start reads existing valid rows, assigns `max(id)+1` (starting at 1), appends a partial row, and publishes atomically.
- NDJSON finish replaces exactly the matching row atomically; missing/duplicate IDs fail without changing the file.
- Use an advisory lock file so two processes cannot allocate the same ID; lock evidence is not included in seeds.
- Corrupt existing NDJSON fails closed and remains unchanged.

## Tests

1. Recording fake connection tests every SQL statement/parameter set and all column refresh rules.
2. Fake transaction injects a mid-batch error and proves rollback/no partial success.
3. Static assertion/recorded operations prove no `DELETE` statement exists or executes.
4. Source-run fake sink proves exactly-one lifecycle across success/partial/error.
5. NDJSON tests prove monotonic IDs, atomic update, lock serialization, corruption handling, and prior-file preservation.
6. `@pytest.mark.postgres` suite:
   - skips with a clear reason when `TEST_DATABASE_URL` is absent;
   - creates a unique temporary schema and applies extensions/table shapes from the contract;
   - verifies real insert/conflict behavior, UUID/first-seen preservation, mutable-column refresh, WKT/PostGIS geometry, transaction rollback, full/partial cancellation, and source-run error finalization;
   - drops only its own temporary schema in cleanup.

## Required test cycle

1. `cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_repository.py -q` — RED then GREEN.
2. `cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_run_log.py -q` — RED then GREEN.
3. `cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_repository_postgres.py -q` — skip or GREEN, never false success.
4. `cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_contract.py tests/test_policy.py tests/test_output.py tests/common tests/test_repository.py tests/test_run_log.py -q` — final offline regression.

## Report

Write `reports/sdd/brownsync-ingestion/task-2b-report.md` with changed files, exact RED/GREEN commands/output, Postgres-test disposition, totals, self-review, and concerns. Do not edit the ledger.
