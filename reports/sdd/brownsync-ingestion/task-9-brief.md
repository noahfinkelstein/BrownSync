# Task 9 brief: CLI, publication manifest, README, offline integration (adapted)

## Situation

Tasks 1–6B and 8 shipped three working job seams — `gazetteer/job.py`
(places), `cab/job.py` (course meetings), `athletics_venues.py` (venue
sidecar) — plus the Task 2B source-run machinery (`run_log.py`
`NdjsonSourceRunLog`/`SourceRunRecorder`, `repository.py` lifecycle SQL).
Two of the plan's five sources are externally blocked and have **no job to
register**:

- **clubs (Task 7, not yet run):** `studentactivities.brown.edu` answers a
  Pantheon-edge 403 to the declared UA (Task 3 manifest gaps); no clubs
  package exists on the branch.
- **dining (Task 8):** `dining.brown.edu`, same Pantheon edge, same 403;
  zero discovery requests were sent (`ingest/dining/NOTES.md`).

The CLI registry must reflect this reality: it covers the jobs that exist,
and the blocked names fail **loudly** with the documented reason — never a
silent skip when named explicitly; `run all` runs the existing jobs and
*reports* the declared gaps.

## Scope

1. **Typer CLI** (`brownsync_ingest/cli.py`, script entry `ingest`):
   `ingest run <job> --out ndjson|postgres` with a dependency-injected
   registry (`places`, `cab`, `athletics` runnable; `clubs`, `dining`
   registered as blocked with the documented reasons), ordered `all`
   (places → cab → athletics, then gap report), fail-closed exits (0 only
   when every invoked job publishes; gate failure/exception → nonzero;
   blocked/unknown job or unsupported combination → usage-level error),
   loud logging of every discovered CAB `srcdb`, `--contact` /
   `BROWNSYNC_CONTACT` env handling (validated email; current jobs are
   offline so it is recorded, not required), `DATABASE_URL` required and
   fail-closed for `--out postgres`.
2. **`--out postgres` hybrid** exactly as the plan documents: contract rows
   (places, course_meetings) and source runs are upserted via
   `PostgresRepository`; the athletics sidecar and dining notes stay files
   because contract v1 has no database target for them. Explicit
   `run athletics --out postgres` is rejected as an unsupported
   combination (its only artifact is a file); within `run all --out
   postgres` athletics runs in hybrid file mode. Postgres paths are
   exercised by `postgres`-marked tests only when `TEST_DATABASE_URL`
   exists; Docker is never started here.
3. **Source-run lifecycle:** every invoked job runs inside exactly one
   Task 2B `SourceRunRecorder` — `ok` on publication, `partial` (with gate
   reasons) when gates fail closed, `error` when the job raises — sunk to
   `db/seeds/source_runs.ndjson` (ndjson mode, the handoff's documented
   location) or to the `source_runs` table (postgres mode). `run all`
   produces one finalized lifecycle per constituent job.
4. **Publication manifest** (`brownsync_ingest/seeds_manifest.py` +
   `db/seeds/manifest.json`): after all bundle artifacts
   (`places.ndjson`, `course_meetings.ndjson`, `athletics_venues.json`)
   are replaced, the manifest is published **last** with a generation ID,
   UTC timestamp, and SHA-256 + byte size per artifact; the validator
   rejects missing artifacts and mixed generations (any artifact whose
   current hash disagrees with the manifest). `source_runs.ndjson` is a
   run log, not a seed artifact, and stays outside the manifest.
   Fault-injection tests interrupt a second-generation bundle after EVERY
   artifact replacement boundary (after 1st, 2nd, 3rd artifact — plus the
   pre-replacement failure case), prove the previous manifest remains
   authoritative and the mixed set is detected, then prove a full rerun
   repairs every artifact before the manifest advances. Single-job runs
   never advance the manifest and warn that `run all --out ndjson` must
   republish it.
5. **Offline integration test:** drive the real CLI against the recorded
   fixtures + user-provided CSV into a temp seeds dir; validate contract
   rows, unique sorted identities, place-id foreign keys, sidecar schema
   v1, gate minima (>=120 places incl. six dining, >=1,500 meeting rows,
   >=50 subjects), WKT for every non-null polygon, manifest
   generation/hashes, one finalized `ok` source run per job, and no staged
   leftovers (`reports/tmp`-style staging holds nothing but the run-log
   lock).
6. **README** (`ingest/README.md`): runtime and layout, how to run and
   rerun each job, cache/checkpoint behavior, all gate thresholds
   including the signed-off 1,500-row Task 6B revision, the source-run
   extension log, sidecar consumer dependency, OSM/ODbL attribution
   (preserved), dining/clubs blocks, and Postgres prerequisites.

## Explicitly out of scope

- Live acquisition and Postgres smoke against real credentials (Task 10).
- Any request to the blocked Pantheon hosts; any clubs implementation.
- App-side loader/consumer claims (still declared dependencies in
  `reports/app_side_dependencies.md`).

## Acceptance

- `cd ingest && uv run pytest -q` fully green (baseline 587 passed + 34
  skipped, plus new tests; RED before GREEN for each new behavior).
- `uv run ingest run all --out ndjson` succeeds end-to-end offline;
  `db/seeds/manifest.json` published last, hashes independently verified.
- Fault-injection boundaries all covered; mixed-generation detection and
  rerun repair proven by test.
- Task-9 report with RED/GREEN evidence; progress.md ledger updated; ONE
  conventional commit staging explicit paths (incl.
  `db/seeds/manifest.json`); no push.
