# Task 2B Report: Postgres upserts and source-run lifecycle

Date: 2026-07-28

## Status

Complete. The ingestion package now persists contract rows directly to
Postgres with strict upsert semantics, guarded missing-event cancellation,
and an exactly-once source-run lifecycle available both as SQL and as the
NDJSON ingestion extension. Only the files listed in the Task 2B brief were
changed, plus this report and the progress ledger lines the controller
requested.

## Changed files

- `ingest/pyproject.toml`
- `ingest/uv.lock`
- `ingest/brownsync_ingest/repository.py`
- `ingest/brownsync_ingest/run_log.py`
- `ingest/tests/test_repository.py`
- `ingest/tests/test_run_log.py`
- `ingest/tests/test_repository_postgres.py`
- `reports/sdd/brownsync-ingestion/task-2b-report.md`
- `reports/sdd/brownsync-ingestion/progress.md`

## Implementation

- `PostgresRepository` wraps one non-autocommit psycopg connection. Every
  batch method is a single transaction: any failure rolls the whole batch
  back, and empty sequences return zero without touching the connection.
  All SQL is fully parameterized; no value is ever interpolated into SQL
  text, including WKT, which binds through
  `ST_Multi(ST_GeomFromText(%s, 4326))` (a null WKT parameter stays SQL
  null through the same expression).
- Places, organizations, and course meetings upsert on `id` and refresh
  every source-owned mutable column via `EXCLUDED`. Organizations bind
  exactly the contract columns and have no `raw`.
- Events upsert on `(source, source_id)`. Rows without `id`,
  `first_seen_at`, or `last_seen_at` omit those columns so database
  defaults apply; explicit values bind when present. The conflict update
  refreshes exactly the twenty source-owned mutable columns including
  `last_seen_at` and `is_canceled` and never assigns `id` or
  `first_seen_at`, so a normal non-cancelled sighting clears a prior
  cancellation while identity and first-seen survive. `raw` uses psycopg
  `Json` adaptation; `tags`/`aliases` bind as native arrays.
- `cancel_missing_events` validates before any SQL: both window bounds
  must be timezone-aware, `coverage_end` must exceed `coverage_start`, and
  `complete` must be exactly `True`. The single UPDATE sets
  `is_canceled = true, last_seen_at = now()` for the named source's rows
  with `start_ts >= coverage_start AND start_ts < coverage_end` whose
  `source_id` is not in the seen set; an empty seen set cancels every
  in-window row. Nothing is ever removed.
- `start_source_run` inserts `source, started_at, status='partial'` and
  returns the generated id; `finish_source_run` updates exactly one
  existing id and raises (rolling back) when the id is unknown, after
  validating status, non-negative count, and timezone-awareness.
- `NdjsonSourceRunLog` keeps an append-style NDJSON history: under an
  advisory `flock` file kept in the staging root (never the seed
  directory), it reads and validates existing rows, assigns `max(id)+1`
  starting at 1, and atomically republishes via a flushed, fsynced staging
  file and `os.replace`. `finish` replaces exactly the matching row;
  missing or duplicate ids and corrupt lines fail closed with the file
  unchanged.
- `SourceRunRecorder` drives any `SourceRunSink` (runtime-checkable
  protocol): exactly one start on `__enter__` and one finish on
  `__exit__` — `ok` on success, `partial` with joined reasons after
  `mark_partial`, `error` with `str(exc)` bounded to 500 characters on
  exception, then re-raises (`__exit__` returns `False`). `add_items`
  rejects negative counts and the recorder cannot be reused.

## TDD evidence

### Repository RED

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_repository.py -q
E   ImportError: cannot import name 'repository' from 'brownsync_ingest' (/Users/noah_finkelstein/Developer/BrownSync/ingestion-worktree/ingest/brownsync_ingest/__init__.py)
1 error in 1.99s
```

### Repository GREEN

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_repository.py -q
.....................                                                    [100%]
21 passed in 0.12s
```

### Run-log RED

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_run_log.py -q
E   ImportError: cannot import name 'run_log' from 'brownsync_ingest' (/Users/noah_finkelstein/Developer/BrownSync/ingestion-worktree/ingest/brownsync_ingest/__init__.py)
1 error in 0.07s
```

### Run-log GREEN

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_run_log.py -q
.........................                                                [100%]
25 passed in 0.24s
```

## Postgres-marked suite disposition

Without `TEST_DATABASE_URL` the marked suite skips with an explicit reason
and never reports false success:

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_repository_postgres.py -q
SKIPPED [1] tests/test_repository_postgres.py:236: TEST_DATABASE_URL is not set; postgres integration tests need a disposable database
7 skipped in 0.29s
```

The one permitted probe outside the worktree, `supabase status` in
`/Users/noah_finkelstein/Developer/projects/BrownSync`, reported
`{"_tag":"Error","error":{"code":"LegacyStatusDbInspectError","message":"failed to inspect container health: EOF"}}`
— the local supabase/Docker stack is not running and printed no database
URL. Per the controller's instruction it was not started. **Database
verification is pending**: when a disposable database is available, export
`TEST_DATABASE_URL` and run
`uv run pytest tests/test_repository_postgres.py -q`. The suite creates a
unique `brownsync_test_<hex>` schema, applies the contract extensions,
tables, and events indexes there, verifies real conflict behavior
(UUID/first-seen preservation, mutable refresh, cancellation clearing),
WKT-to-MultiPolygon geometry with SRID 4326, whole-batch rollback on a
foreign-key violation, full/partial/guarded cancellation windows, and
source-run error finalization through `SourceRunRecorder`, then drops only
its own schema.

## Final regression

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_contract.py tests/test_policy.py tests/test_output.py tests/common tests/test_repository.py tests/test_run_log.py -q
........................................................................ [ 44%]
........................................................................ [ 88%]
..................                                                       [100%]
162 passed in 0.88s

$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest -q
162 passed, 7 skipped in 0.24s
```

Totals: 169 tests collected — 162 offline passed, 7 postgres-marked
skipped pending a running database.

## Self-review

- The recording fake connection asserts every statement's SQL shape and
  full parameter tuples: exact insert column lists, exact
  `ON CONFLICT ... DO UPDATE SET` assignment sets (all `EXCLUDED.*`), the
  parameterized WKT expression, psycopg `Json` adaptation for `raw`, and
  native array binding for `tags`.
- Events tests prove default-column omission, explicit identity binding,
  the `(source, source_id)` conflict target, and that `id` and
  `first_seen_at` never appear in the conflict update.
- An injected mid-batch failure proves one rollback, zero commits, and no
  partially recorded batch; empty batches touch nothing.
- A static source assertion plus a recorded-SQL sweep across every
  repository method proves no row-removal statement exists or executes.
- Cancellation guards (naive bounds, non-increasing window,
  `complete=False`) all raise before any SQL executes.
- Recorder tests prove exactly-one start/finish across ok/partial/error,
  bounded error text (10,000-character message truncates to 500, empty
  text falls back to the exception type name), re-raise on exception,
  negative-count rejection, and no reuse.
- NDJSON tests prove id 1 on first use, `max(id)+1` continuation with
  prior lines byte-preserved, exact-row replacement on finish, fail-closed
  behavior for missing/duplicate ids and five corruption shapes, staged
  replacement failure preserving history, lock evidence kept out of the
  seed directory, and eight concurrent starts allocating ids 1..8 through
  the advisory lock.
- `uv.lock` contains the newly declared `psycopg[binary]` dependency, and
  the `postgres` marker is registered so `-q` runs stay warning-free.

## Concerns

- The postgres-marked suite could not be executed against a real database
  in this session (supabase/Docker down); it is written to run unchanged
  once `TEST_DATABASE_URL` is exported and remains the pending
  verification item.
- Re-running a complete cancellation counts already-cancelled in-window
  rows again and refreshes their `last_seen_at`; the operation is
  idempotent in effect, but the returned count is "rows matched", not
  "rows newly cancelled". The postgres test documents this explicitly.
- `flock` advisory locking serializes processes on one host sharing the
  staging root; two hosts writing the same seed file over a network
  filesystem would not be protected. That matches the single-runner
  ingestion design.
- The offline `connect` test monkeypatches `psycopg.connect`; real
  connection establishment is only exercised by the pending postgres
  suite.
