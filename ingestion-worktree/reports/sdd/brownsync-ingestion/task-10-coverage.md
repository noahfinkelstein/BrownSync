# Task 10 (offline portion): per-parser branch coverage

Date: 2026-07-29. Worktree `/Users/noah_finkelstein/Developer/BrownSync/ingestion-worktree`, branch `codex/ingestion`, base HEAD `57ab59f`.

Gate (plan, global constraint): **parser coverage is at least 80% branch coverage for each parser module, not merely package-wide statement coverage.**

Method: `pytest-cov` added as a dev dependency (`pytest-cov>=6,<7`, coverage 7.15.2); `uv run pytest --cov=brownsync_ingest --cov-branch` over the full offline suite. Numbers below are **pure branch rates** (`covered_branches / num_branches` from coverage.py's JSON report), not the blended statement+branch percentage.

## Per-module branch coverage, before -> after

Modules classified as parsers of external data (the gate applies):

| Module | Parses | Before | After | Gate |
|---|---|---|---|---|
| `cab/meeting_parser.py` | CAB `meeting_schedule` grammar (user CSV) | 30/30 = 100.00% | 30/30 = 100.00% | PASS |
| `cab/csv_source.py` | user-provided Fall 2026 CSV | 14/16 = 87.50% | 14/16 = 87.50% | PASS |
| `cab/models.py` | CAB parse-outcome value objects + fail-closed invariant | 1/2 = 50.00% | 2/2 = 100.00% | PASS (was FAIL) |
| `cab/job.py` | CAB job wiring over the CSV | 22/22 = 100.00% | 22/22 = 100.00% | PASS |
| `gazetteer/overpass.py` | recorded Overpass JSON | 26/30 = 86.67% | 26/30 = 86.67% | PASS |
| `gazetteer/geometry.py` | OSM geometry -> MultiPolygon WKT | 50/56 = 89.29% | 50/56 = 89.29% | PASS |
| `gazetteer/aliases.py` | curated aliases.yaml | 44/52 = 84.62% | 44/52 = 84.62% | PASS |
| `gazetteer/catalog.py` | place catalog assembly | 14/14 = 100.00% | 14/14 = 100.00% | PASS |
| `gazetteer/resolver.py` | location-string resolution | 50/52 = 96.15% | 50/52 = 96.15% | PASS |
| `athletics_venues.py` | SIDEARM ICS (unfold, LOCATION/SUMMARY venue mapping) | 50/58 = 86.21% | 50/58 = 86.21% | PASS |
| `fixtures_capture.py` | CAB HTML/JSON, Drupal clubs HTML, LiveWhale JSON, Overpass JSON, SIDEARM ICS -> manifest expected-facts | 22/152 = 14.47% | 139/152 = 91.45% | PASS (was FAIL) |
| `contract.py` | contract row validation codecs | 23/26 = 88.46% | 23/26 = 88.46% | PASS |
| `common/http.py` | cached-response metadata (feeds every parser) | 37/46 = 80.43% | 37/46 = 80.43% | PASS |

Modules below 80% that are **not** parsers of external data (gate not applied; recorded for honesty):

| Module | Branch after | Why out of parser scope |
|---|---|---|
| `cli.py` | 51/70 = 72.86% | Typer CLI orchestration; parses argv via Typer, no external source data |
| `seeds_manifest.py` | 36/46 = 78.26% | codec for the pipeline's own `db/seeds/manifest.json`; internal artifact, exercised end-to-end by the fault-injection suite |

All remaining modules are at 84%+ branch or have no branches (`__init__`, `models.py` dataclasses).

## Modules below the gate before this task, and what was added

1. **`fixtures_capture.py` 14.47% -> 91.45%.** It was tested only via the Task 8 athletics/merge tests, yet it is the module that parses every external source into the manifest's `expected` parser facts. New file `ingest/tests/test_fixtures_capture_offline.py` (68 tests), all offline via `httpx.MockTransport` plugged into the production `CachedHttpClient`:
   - round-trip pinning: each expected-fact builder replayed against the real recorded fixtures must reproduce `fixtures/manifest.json`'s `expected` blocks byte-for-byte (livewhale events/groups, overpass, athletics);
   - scrubbing: email replacement, asset-name and placeholder preservation, the JSON-escape-prefix edge (`\nperson@...` keeps the escape letter);
   - CAB discovery: Fall 2026 srcdb via option / JSON-blob / trailing-regex paths and the none case; bootstrap URL via script src and quoted-route fallback; search/detail fact sampling incl. empty results; `_select_diverse_sections` dedup, bucket rotation, and empty input;
   - clubs/dining/LiveWhale/Overpass helpers: Drupal pager maximum, graduate-link discovery by href tokens and by link text, views-row sampling, contact_info blanking incl. escaped quotes, non-JSON fallbacks, way/relation counting;
   - transport behavior: redirect following (relative, cross-host, 303 POST->bodyless GET), redirect cutoff, no-location and 404 raising;
   - recording invariants: scrub-then-hash manifest entries whose fingerprint equals the production cache identity on disk, WAF-header and 202-challenge blocking with nothing stored, non-200 rejection, a failing fact-builder leaving no unmanifested fixture, `pre_scrub` marking, gap-reason flattening, manifest sort order;
   - orchestration: full `capture_cab` (scarcity gap at <20 sections, rich export hitting the 24-detail target, no-srcdb double gap), `capture_clubs` (pager walk, failing graduate fetch, missing link), `capture_livewhale` (`?max=200` not honored note, groups failure gap), `capture_dining` (dedup, off-site filtering, per-bundle gaps, bundleless gap), `capture_athletics`, and `main` with monkeypatched groups (failing group gaps only untouched sources; selective `--groups` run merges over the existing manifest).
2. **`cab/models.py` 50.00% -> 100.00%.** New `ingest/tests/cab/test_models.py` (4 tests): the `ParsedSchedule` exactly-one-of patterns/skip_reason invariant now has both rejection directions exercised (both set, neither set), plus the `CabGates.passed` conjunction.

No production code changed; these are coverage tests over existing behavior, so no TDD RED evidence applies (per the task brief). Uncovered remainder in `fixtures_capture.py` is defensive dead code (`_select_diverse_sections`'s 10k-iteration guard) and rare partial branches of sampling conditionals; `_TimeoutTransport` is statement-only (no branches) and untestable offline.

Suite: 645 -> **717 passed** + 34 skipped (postgres-marked, `TEST_DATABASE_URL` unset). 72 tests added.

## Remaining Task 10 items — status (not done)

| Item | Status |
|---|---|
| Postgres-marked integration suite + `ingest run all --out postgres` | **Pending credentials** — no `DATABASE_URL`/`TEST_DATABASE_URL` available; 34 postgres tests skip cleanly. Deferred to Phase 3 per kickoff decision. |
| Live clubs acquisition (studentactivities.brown.edu) | **Blocked** — Pantheon edge 403 for the declared UA (Task 3/8 evidence); needs OIT allowlist or user-exported pages. |
| Live dining acquisition (dining.brown.edu) | **Blocked** — same Pantheon 403; `ingest/dining/NOTES.md` documents unblock paths. No requests sent. |
| Live LiveWhale event seeds | **Deferred** — to the TypeScript poller at deploy time; recorded fixtures remain the offline evidence. |
| Live CAB acquisition | **Blocked** — AWS WAF bot challenge (never bypassed); user-provided Fall 2026 CSV fills the gap and is hash-pinned in the fixtures manifest. |
| Final adversarial review over the full task | **Not run here** — this session covered only the offline coverage portion. |
