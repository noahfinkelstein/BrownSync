# Task 9 report: CLI, publication manifest, README, offline integration

## Resume note

The first Task 9 worker died mid-run (API disconnect) after writing the CLI
(`ingest/brownsync_ingest/cli.py`), the manifest module
(`ingest/brownsync_ingest/seeds_manifest.py`), their tests
(`test_cli.py`, `test_seeds_manifest.py`, `test_bundle_faults.py`), the
`pyproject.toml` script entry (`ingest = "brownsync_ingest.cli:app"` +
Typer dependency + hatchling build), and `task-9-brief.md` — all left
uncommitted in the worktree. Its RED transcripts were lost with the session;
an independent verifier had already exercised the WIP successfully (629
passed; `run all --out ndjson` exit 0 with one source-run lifecycle per job;
manifest published last with matching SHA-256s; fault injection at every
boundary; blocked jobs exit 2). This resumed run **assessed** that WIP
(re-ran the full suite: 629 passed + 34 skipped, matching the verifier),
did not rewrite it, and finished the remaining scope below.

## Delivered

1. **Typer CLI** (`ingest run <job> --out ndjson|postgres`, WIP, kept as
   found): dependency-injected registry — `places`, `cab`, `athletics`
   runnable; `clubs`/`dining` registered as `BlockedJob` entries whose
   documented 403 reasons fail loudly at exit 2 when named, and are
   *reported* as gaps by `run all` (ordered places → cab → athletics).
   Fail-closed exits (0 publish, 1 gate-partial/error, 2 usage refusal),
   loud `SRCDB discovered:` logging, `--contact`/`BROWNSYNC_CONTACT`
   validated-email handling, `DATABASE_URL` required for `--out postgres`,
   `run athletics --out postgres` rejected as the unsupported combination
   (file-only sidecar), hybrid semantics inside `run all --out postgres`.
2. **Source-run lifecycles**: every invoked job inside exactly one Task 2B
   `SourceRunRecorder` (`ok`/`partial` with gate reasons/`error` even when
   raising), sunk to `db/seeds/source_runs.ndjson` or the `source_runs`
   table; `run all` yields one finalized lifecycle per constituent job.
3. **Publication manifest** (`seeds_manifest.py`, WIP, kept as found):
   published LAST with generation ID, UTC timestamp, SHA-256 + bytes per
   artifact; validator rejects missing artifacts, schema violations, and
   mixed generations. `source_runs.ndjson` deliberately outside the
   manifest. Single-job runs never advance it and warn.
4. **Fault injection** (`test_bundle_faults.py`, WIP, kept as found): a
   second-generation bundle is interrupted at all four boundaries — before
   any replacement and after the 1st, 2nd, and 3rd artifact. Each case
   proves (a) the previous manifest byte-identical and authoritative,
   (b) the validator flags exactly the replaced artifacts as
   mixed-generation, (c) a full rerun repairs every artifact before the
   manifest advances, and (d) interrupted runs still finalize their
   source-run lifecycles (`ok, ok, error`).
5. **Offline integration test** (new: `tests/test_integration_offline.py`,
   16 tests): one real `execute_run("all")` with the default registry
   against the recorded fixtures + user-provided CSV into a temp seeds dir,
   validating contract rows (PlaceRow/CourseMeetingRow, extra=forbid),
   unique sorted identities, meeting→place and sidecar→place foreign keys,
   sidecar schema v1 shape, gate minima (164 ≥ 120 places with exactly the
   six dining ids; 1,828 ≥ 1,500 meeting rows; ≥ 50 subjects), plain
   MULTIPOLYGON WKT for every non-null polygon, manifest
   generation/independently recomputed hashes, exactly one finalized `ok`
   source run per job in registry order, and no staged leftovers beyond
   `.source_runs.ndjson.lock`.
6. **README** (`ingest/README.md`): runtime/layout, run/rerun semantics and
   exit codes, cache/checkpoint behavior, full gate table including the
   signed-off 1,500-row Task 6B revision, bundle/manifest semantics,
   source-run extension log, sidecar consumer dependency, clubs/dining
   blocks with unblock paths, Postgres prerequisites and hybrid, and the
   preserved OSM/ODbL attribution.
7. **Published bundle**: `uv run ingest run all --out ndjson` end-to-end
   (exit 0), publishing `db/seeds/manifest.json` for the first time.

## Evidence

- **Suite**: `cd ingest && uv run pytest -q` → **645 passed, 34 skipped**
  (629 WIP baseline + 16 new integration tests; skips are the
  `postgres`-marked tests without `TEST_DATABASE_URL` — reported, not
  claimed verified; Docker never started).
- **RED/GREEN**: the interrupted worker's RED evidence is unrecoverable;
  behavior-biting is instead evidenced by the verifier's independent pass
  and by the fault-injection suite, whose interrupted generations are
  *detected* (mixed-generation errors enumerated per boundary) rather than
  asserted vacuously. The new integration suite had one genuine failure on
  first run — it asserted `run["error"] is None` but the NDJSON run log
  omits the null field entirely (`KeyError: 'error'`) — corrected to
  `run.get("error") is None` to match the recorded shape; 16/16 green.
- **End-to-end run** (real seeds dir): gaps reported for clubs + dining
  (403 reasons), `places ok: 164`, `cab ok: 1828` with
  `SRCDB discovered: 202610`, `athletics ok: 11`
  (exclusions away-city=98, away-game=1, no-location=3, tba=6), then
  `[manifest] published last: generation 315876fbf25846fabcd1271eab68c671
  covering 3 artifacts`.
- **Independent hash verification** (`shasum -a 256` + `stat`, outside the
  validator):
  - `places.ndjson` `aa6a936e…0793a537`, 136,920 bytes — matches manifest;
    byte-identical to the Task 8 commit (deterministic republication).
  - `course_meetings.ndjson` `36aa60c4…cf172451`, 1,676,517 bytes — matches
    manifest; byte-identical to the Task 6B commit.
  - `athletics_venues.json` `7d633911…d55b33d`, 1,226 bytes — matches
    manifest; diff vs Task 8 is the `generated_at` timestamp only.
- **Run log**: `db/seeds/source_runs.ndjson` ids 1–3, sources
  places/cab/athletics, all `ok`, items 164/1828/11, monotonic and
  finalized.
- **Staging**: `reports/tmp/` holds only the zero-byte run-log lock
  (left untracked; it is lock state, not an output).

## Deviations and notes

- The adapted scope (blocked clubs/dining as registry gaps rather than
  runnable jobs) follows the Task 3/8 documented 403 evidence; no request
  was sent to either Pantheon host.
- `reports/cab_fall_2026_place_resolution.md` was re-rendered by the real
  run and is byte-identical to the committed version (same UTC date).
- Postgres execution paths are covered by unit tests with fake
  repositories and by `postgres`-marked tests that skip without
  `TEST_DATABASE_URL`; the live `--out postgres` smoke remains Task 10 per
  plan.
