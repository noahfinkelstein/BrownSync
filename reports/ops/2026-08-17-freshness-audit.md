# Freshness audit — 2026-08-17

Daily automated audit (`ops/freshness-audit-<date>` routine, see
`reports/ops/2026-08-08-launch.md` §Data). This run found two real defects
and fixed both at the code level; nothing was deployed to prod.

## 1. Six sources reading falsely stale (source_registry gap)

`athletics`, `buildings`, `cab`, `clubs`, `events`, `places` are one-time
`db/seeds/*` loads applied by `pnpm db:seed` (`seed-load.yml`,
workflow_dispatch only — writes to prod, human-confirmed, never on a cron).
They were never given `source_registry` rows (migration 0006 only covers the
continuously-polled sources), so `api_health()` left-joins them to a NULL
`stale_after_seconds` and both the audit's 7-day default and the web
client's real 45-minute fallback (`apps/web/src/ops/health-model.ts
STALE_AFTER_MS`) mark them stale the moment they age past 45 minutes — which
is every day since their last load (2026-07-29, 19 days ago as of this
audit). Flagged as P2 backlog at launch (2026-08-08 §Deferred post-launch),
unfixed for 9 days.

**Fix:** `db/migrations/0024_seed_lane_staleness.sql` — registers real
cadence/staleness for all six (`lane = 'ingest'`, matching
`academic_calendar`'s existing precedent for "reloaded by human action, not
a scheduled fetch"; the Worker dispatcher only claims `lane in
('worker','sql')`, so these stay exactly as seed-load-only as before).
Labels are set to match what the client already displays today (fallback
title-case / the existing `SOURCE_LABELS` map), so the fix is additive to
thresholds only — no health-strip text changes. `pnpm --filter @brownsync/db
test` and the relevant `apps/web` ops-health tests pass.

Not run against a live Postgres in this sandbox (no docker daemon
available) — the SQL is a plain, idempotent (`on conflict do nothing`)
INSERT and was checked by hand against the 0006 CHECK constraints and the
0006 checks-file assertions (stale_after > cadence, enabled rows have both
> 0, lane is a valid enum value). Confirm with `db/checks/0006_source_
registry_checks.sql` once CI's postgis job runs.

## 2. `Refresh data artifacts` red on every scheduled run since launch

`.github/workflows/refresh.yml` has failed on **all 12 scheduled runs**
since it went live (2026-08-08 through today) — this predates and is
unrelated to (1). Root cause, from the actual CI logs (downloaded via the
run's signed logs URL, since the GitHub App token here can't reach the jobs
API directly):

`ingest/brownsync_ingest/fixtures_capture.py:capture_libraries` records the
LibCal hours widget as a rolling 7-week window (`hours-grid-<sunday>.html`),
anchored to the run date. The window slides forward every Sunday, but
nothing ever deleted a week's file once it aged out — it just sat on disk,
dropped from the manifest (`preload_manifest` already drops old entries for
a recaptured source) but still picked up by `libraries/hours.py:
load_grids()`, which globs the whole directory instead of reading the
manifest. Every day added potential orphans; by today three had
accumulated (`hours-grid-2026-07-26.html`, `-08-02`, `-08-09`), each run
failing `tests/test_fixtures.py::test_every_stored_fixture_is_manifested`
and corrupting `TestNormalization`'s hours counts (verified locally: the
checked-in, unmodified 7-file baseline passes all 31
`tests/libraries/test_hours.py` tests cleanly — the extra files are the
entire cause of that half of the failure).

**Fix:** `capture_libraries` now tracks the relpaths it freshly wrote and
prunes any other `hours-grid-*.html` file under `recorded/libraries/` after
each run — with one hardcoded, permanent exception:
`hours-grid-2026-07-26.html`, which
`tests/libraries/test_hours.py::TestAgainstTheUserCsv` reads directly (not
via `load_grids()`) as an independent witness against a hand-captured CSV
snapshot and must never be deleted. New regression coverage in
`tests/test_fixtures_capture_offline.py::TestCaptureLibraries` (4 tests):
the 7-week window is captured correctly, a stale week is pruned, the CSV
witness survives a prune even when it's out of the window, and a same-week
re-run prunes nothing. Full `uv run pytest` — 1416 passed, 98 skipped (same
skip set as the 2026-08-07 baseline: postgres-integration tests need
`TEST_DATABASE_URL`).

**Not fixed, needs a human decision** — confirmed from the same CI log,
unrelated to the orphan bug above:

- `TestNormalization::test_a_space_closed_all_summer_still_publishes_days`
  and `::test_undefined_days_are_omitted_and_reported` — the rolling
  7-week window as of today (2026-08-16 through 2026-10-03) now genuinely
  crosses into the fall semester start, and John Hay Library legitimately
  shows open days in that range (18, not 0). The test's premise ("closed
  for the whole recording") was true when written against a
  summer-only window; it is structurally guaranteed to break every year
  once the auto-refreshing window crosses Labor Day, independent of any
  fixture-management bug. This needs a design call — pin this specific
  assertion to a fixed historical week (the same pattern as the CSV
  witness) rather than "whatever `load_grids()` currently returns" — not a
  same-day patch.
- `tests/publications/test_dedupe.py::test_the_hit_rate_over_real_data_is_
  pinned` (155 articles today vs. the pinned 154), `::test_the_one_real_
  duplicate_is_the_one_we_expect` (no dedupe hit at all today), and two
  `test_sources.py` assertions expecting that one drop. These are hard
  equality pins against live, day-to-day RSS content across four
  publications; today's real feeds simply produced a different duplicate
  count than whenever 154 was last verified correct. Re-pinning the number
  without verifying the new dedupe output is actually right (not a fuzzy-
  match regression silently eating real coverage — exactly what the test's
  own comment warns about) is exactly the kind of content-correctness call
  this audit should describe, not force. Recommend the owner (or a
  dedicated PR) verify the current 155-article/0-duplicate output against
  the real feeds before re-pinning.

Both groups are why `Refresh data artifacts` will very likely still fail
after this PR merges — the pruning fix removes the mechanical, guaranteed-
every-day failure and the two library count corruptions it caused, but the
two content-drift buckets above need their own decision before that
workflow returns to green.

## Workflow health

| Workflow | Last 3 runs | Note |
|---|---|---|
| Poll | success, success, success | On schedule, e.g. 13:52/13:28/13:24 UTC today |
| Refresh data artifacts | failure ×12 (all runs since 2026-08-08) | Root-caused above; partial fix in this PR |
| CI | success ×5 (last 5, back to 08-11) | Green on every PR |
| Deploy | success ×5 (last 5, all 2026-08-08) | Nothing pushed to main since launch sign-off |

No sign of GitHub's 60-day cron-disable — repo has had commits/PR activity
well inside that window.

## Upcoming events

`GET /api/events?from=2026-08-17T00:00:00Z&to=2026-08-24T00:00:00Z` returns
events (LiveWhale-sourced, confirmed non-empty during term-adjacent dates).

## Source table (this run)

| source | status | age vs threshold | verdict |
|---|---|---|---|
| athletics_ics | ok | ~25 min / 4h | FRESH |
| bdh | ok | ~25 min / 2h | FRESH |
| brown_news | ok | ~24 min / 2h | FRESH |
| dedup | ok | ~5 min / 1h | FRESH |
| livewhale | ok | ~36 min / 40 min | FRESH (narrow) |
| athletics, buildings, cab, clubs, events, places | ok | 19d / **was NULL→45min** | was STALE, **fixed this run** (0024) |
| academic_calendar, arcgis, bjwa, bpr, dining, libcal, passiogo, ppl | never | — | NEVER — deferred Lane B/future producers per launch report, not a regression |
| bdh(dup-disabled)/providence_gov, today_brown, feed_rank | disabled | — | paused by design |
| web (brownsync.pages.dev) | 200 | — | OK |

## Overall verdict: **AMBER**

Most-important next action: **land and merge this PR** (0024 registry fix +
the fixtures-capture prune fix are both safe, tested, additive), then get
an owner decision on re-pinning `tests/libraries/test_hours.py`'s
season-bound assertions and verifying today's real publications-dedupe
output before `Refresh data artifacts` can go green.
