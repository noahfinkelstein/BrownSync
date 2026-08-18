# 2026-08-18 — daily freshness audit

Automated session. Audit + fix; owner review requested for one open item.

## Source health (`GET /api/health`, read at 2026-08-18T12:27Z)

| source | status | last ok | age vs threshold | verdict |
|---|---|---|---|---|
| livewhale | ok | 12:25:41Z | 40s / 2400s | FRESH |
| dedup | ok | 12:23:26Z | 4m / 3600s | FRESH |
| brown_news | ok | 12:06:26Z | 21m / 7200s | FRESH |
| bdh | ok | 11:00:11Z | 87m / 7200s | FRESH |
| athletics_ics | ok | 11:00:08Z | 87m / 14400s | FRESH |
| athletics | ok | 2026-07-29 | 20d / 63072000s (fixed below) | was STALE (7d default) → **fixed** |
| buildings | ok | 2026-07-29 | 20d / 63072000s (fixed below) | was STALE → **fixed** |
| cab | ok | 2026-07-29 | 20d / 20736000s (fixed below) | was STALE → **fixed** |
| clubs | ok | 2026-07-29 | 20d / 20736000s (fixed below) | was STALE → **fixed** |
| events | ok | 2026-07-29 | 20d / 20736000s (fixed below) | was STALE → **fixed** |
| places | ok | 2026-07-29 | 20d / 20736000s (fixed below) | was STALE → **fixed** |
| academic_calendar | never | — | — | NEVER (2-year cadence, registered, not yet due) |
| arcgis | never | — | — | NEVER (weekly Sunday cron — see refresh.yml finding) |
| dining | never | — | — | NEVER (daily cron — see refresh.yml finding) |
| libcal | never | — | — | NEVER (daily cron — see refresh.yml finding) |
| bjwa / bpr / ppl | never | — | — | NEVER — no producer built yet (recorded post-launch deferral, `lane=worker`, nothing in `services/poller` implements them) |
| passiogo | never | — | — | NEVER — no producer built yet, same deferral |
| feed_rank | never | disabled | — | paused by design |
| providence_gov | never | disabled | — | paused by design (robots.txt refusal) |
| today_brown | never | disabled | — | paused by design (Shibboleth SSO) |

**Web**: `brownsync.pages.dev` → 200.
**Events data currency**: `/api/events?from=2026-08-18&to=2026-08-25` → 97 upcoming events. GREEN.

## Fix #1 — seed-lane sources had no staleness horizon (shipped)

`athletics`, `buildings`, `cab`, `clubs`, `events`, `places` were upserted by
`seed-load.yml` on 2026-07-29 but were never given a `source_registry` row, so
`api_health()` reported `stale_after_seconds: null` for all six — exactly the
P2 backlog item recorded in `reports/ops/2026-08-08-launch.md` ("seed-lane
staleness thresholds ... carry NULL thresholds and read stale-amber against
the 45-min fallback").

**Fix**: migration `0024_seed_lane_staleness_thresholds.sql` registers all six
with `lane='actions'` (seed-load.yml is their runtime) and cadence/staleness
matched to how often each actually changes — annual for the near-permanent
venue/building lists, ~120 days (one term) for course/org/place/event data.
Paired check `db/checks/0024_seed_lane_checks.sql`, wired into `ci.yml`'s
`migrate` job. Verified locally against a fresh PostGIS 16 instance: full
migration chain 0001→0024 applies clean, `api_health()` now returns a real
horizon for all six, `pnpm db:seed` / `db:seed-check` / the `@brownsync/db`
and `@brownsync/poller` suites all pass unchanged.

## Fix #2 — `refresh.yml` has failed every scheduled run since launch (shipped)

**This is the important finding.** "Refresh data artifacts" is a daily cron
(09:12 UTC) that re-records live fixtures for dining/libraries/arcgis and
rebuilds `library_hours.json` etc., gated by the Python offline test suite
before it's allowed to open a PR. Checked the last 13 scheduled runs via the
GitHub Actions API: **13/13 failures**, 2026-08-08 through 2026-08-18, every
one dying at the `uv run pytest -q` gate. This is why `libcal`/`dining`/
`arcgis` never advance past `never` — the workflow meant to feed them has
never once reached the PR step.

**Root cause**: `capture_libraries` in `ingest/brownsync_ingest/
fixtures_capture.py` writes 7 calendar-dated LibCal grid files
(`hours-grid-<sunday>.html` × 7 weeks) anchored to the run date, but nothing
ever deleted last week's files once the anchor rolled forward. Every run
after the repo's initial commit left the previous week's grid orphaned on
disk: present in the checkout, absent from the freshly written manifest.
Two independent things then broke on that leftover file:
- `tests/test_fixtures.py::test_every_stored_fixture_is_manifested` — an
  unmanifested file on disk is exactly the invariant it exists to catch.
- `tests/libraries/test_hours.py` — `load_grids()` globs *every* file in
  `recorded/libraries/`, so the orphaned extra week silently skewed every
  library's normalized day count (`test_a_space_closed_all_summer...`,
  `test_undefined_days_are_omitted...`).

Confirmed by running `uv run pytest -q` against the untouched checkout
(1412 passed, 0 failed) — the failure only exists after a live recapture,
never in CI's own offline suite, which is why the PR-gating `ingest` CI job
has stayed green the whole time this was red.

**Fix**: `CaptureSession.prune(directory, keep=...)` deletes any file under a
fixture directory not in the freshly-captured set; `capture_libraries` now
calls it with the 7-week window it just wrote, and notes what it pruned.
Reproduced end-to-end against the real committed fixture bytes in a scratch
checkout — pre-seeded a stale out-of-window file, ran the fixed
`capture_libraries`, confirmed exactly the 4 rolled-out weeks were deleted and
the 7 current ones survived untouched. Added 5 offline unit tests
(`TestCaptureSessionPrune`, `TestCaptureLibraries`) covering the prune
primitive and the wiring; full suite now 1417 passed / 0 failed / 98 skipped
(unchanged skip set — all Postgres-integration tests, offline by design).

## Not fixed — flagged for the owner

The same `refresh.yml` runs also failed 4 **unrelated** tests every time,
all in `tests/publications/`:
`test_the_hit_rate_over_real_data_is_pinned` (`assert len(articles) == 154`,
got 155), `test_the_one_real_duplicate_is_the_one_we_expect`,
`test_the_raw_feeds_survive_dedupe`, `test_diagnostics_carry_the_redactions_
and_the_drop`. `capture_publications` re-fetches BDH/BPR/Brown News/RI
Current live on every run into **fixed** filenames (no date stamp, unlike
libraries), so these tests are pinned against exact content from real news
feeds that legitimately changes every day — the specific cross-outlet
duplicate the suite expects is gone because the live articles rotated. This
isn't a bug my fix (or any mechanical fix) can close: pinning an exact count
against daily-refreshed live content will drift again on whatever day it's
"fixed." It needs an owner call — most likely, carve the dedupe suite's
fixtures out of the daily live-recapture group and freeze them as a
hand-curated regression fixture, or rewrite the pinned assertions as
invariants. Filed here rather than touched; even with this fix landed,
`refresh.yml` will stay red on the `publications` half of the daily group
until that decision is made.

## Workflow health (last 3 scheduled/PR runs, `gh`/GitHub API)

| workflow | last 3 | note |
|---|---|---|
| CI | success ×3 (pull_request) | green |
| Poll | success ×3 (schedule) | green, ticking every 15 min |
| Deploy | success ×3 (push, 2026-08-08) | no pushes to main since launch |
| Refresh data artifacts | **failure ×13** (schedule, 2026-08-08→08-18) | root-caused above, partial fix shipped |

All 6 workflows report `state: active` — none hit GitHub's 60-day cron
auto-disable (repo is 21 days old).

## PR

Branch `ops/freshness-audit-2026-08-18`: migration 0024 + check + `ci.yml`
wiring, and the `fixtures_capture.py` prune fix + tests. Not pushed to main;
opened as a draft PR per policy.

## Overall verdict: **AMBER**

Events pipeline and web are healthy (GREEN). The seed-lane staleness gap is
fixed. The library half of the daily refresh regression is fixed and
verified. The publications/dedupe half is real, has been silently red for 10
straight days, and needs an owner decision on fixture strategy before
`refresh.yml` can go green — **that's the single most important next
action**.
