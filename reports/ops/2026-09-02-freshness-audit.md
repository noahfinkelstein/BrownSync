# BrownSync daily freshness audit — 2026-09-02

Automated run of the daily freshness audit routine (installed at launch, per
`2026-08-08-launch.md` §Data). No code changed — both findings below need a
human call, not a mechanical fix, so this session documents them instead of
guessing. Investigated at 2026-09-02T12:42 UTC.

## Source health (`/api/health`)

| source | status | last ok | age vs threshold | verdict |
|---|---|---|---|---|
| livewhale | ok | 08:55:33 | 3h47m vs 40min | **STALE** |
| athletics_ics | ok | 11:42:00 | ~1h vs 4h | fresh |
| bdh | ok | 11:42:02 | ~1h vs 2h | fresh |
| brown_news | ok | 12:33:41 | ~9min vs 2h | fresh |
| dedup | ok | 12:37:41 | ~5min vs 1h | fresh |
| athletics, buildings, cab, clubs, events, places | ok | 2026-07-29 (launch seed) | null threshold → reads amber against the 7-day fallback | **known, deferred** (see below) |
| academic_calendar, arcgis, bjwa, bpr, dining, libcal, passiogo, ppl | never | — | producer not shipped yet | expected `never`, not a regression |
| bdh (refusal), providence_gov, today_brown, feed_rank | — | — | `enabled:false` | paused by design |

Web (`brownsync.pages.dev`): 200. `/api/events` for the next 7 days: 264
items — the upcoming-events window is healthy despite livewhale's staleness,
because the last sweep (08:55) is still being served.

## Finding 1 — livewhale is stale because its Worker-lane cutover was never finished

`livewhale` is registered `lane='worker', cadence_seconds=600` (migration
0006) and a working runner already exists
(`createLivewhaleRunner`, `apps/api/src/schedule/runners.ts`) — fully
implemented and tested. It is **deliberately not wired into
`createWorkerRunners()`** yet; the comment on that function says why: running
both lanes at once would race the cancellation sweep (a mid-sweep upsert from
one lane looks "unseen" to the other and gets falsely canceled). The intent,
stated inline, is that the runner "gets its registry entry in the SAME
release that retires poll.yml's livewhale entry, never alongside." This is
also listed verbatim in `2026-08-08-launch.md`'s deferred-post-launch section
("livewhale Worker migration + poll.yml retirement").

So today, livewhale still runs only via `poll.yml`'s `*/15 * * * *` GitHub
Actions cron. Comparing `poll.yml`'s actual run cadence against its
configured schedule: 30 runs landed between 2026-08-31T19:40 and
2026-09-02T11:41 (~40h), averaging ~80 minutes apart, against a combined
configured cadence across all three `poll.yml` crons of roughly one tick
every ~11 minutes. Every run inspected **succeeded** (no errors) — this is
GitHub Actions' own scheduled-workflow reliability under load, not a bug in
this repo's code, and it's exactly the reliability gap the deferred Worker
migration exists to close.

**Recommended fix** (needs an owner-approved deploy, so left undone here):
finish the deferred cutover — add `livewhale` to `createWorkerRunners()` and
remove its entry from `poll.yml`'s cron list in the same PR, per the existing
inline instructions, then deploy the Worker.

## Finding 2 — `refresh.yml` has failed on every run since it shipped (29/29)

Every scheduled run of "Refresh data artifacts" — from run #1
(2026-08-08T09:50) through the latest, run #29 (2026-09-01T14:06) — has
failed at the "Offline suite must pass against the NEW fixtures" step (`uv
run pytest`, `ingest/`). This is why `dining`, `libcal`, and `arcgis` still
read `never` a month after launch, and it has gone undocumented in
`reports/ops/` until now. 8 tests fail, consistently in two groups:

1. **Fixture-manifest drift**: `test_every_stored_fixture_is_manifested`
   fails because `ingest/fixtures/recorded/libraries/hours-grid-*.html`
   accumulates dated snapshots (weekly library-hours grid captures) that the
   freshly regenerated `manifest.json` no longer lists once they roll out of
   whatever window `fixtures_capture` currently manifests. The files are
   never pruned, so old ones go stray. Whether the right fix is "prune files
   the manifest drops" or "keep manifesting past weeks" is a retention-policy
   call, not implied by the code.
2. **Season-pinned assertions**: `test_summer_closure_is_not_an_error`
   (expects some dining halls closed — now expects that against a September
   fixture with none), `test_undefined_days_are_omitted_and_reported` (an
   inequality between two libraries' grid lengths that has become an
   equality as the capture window advanced), and three
   `tests/publications/test_dedupe.py` / `test_sources.py` assertions pinned
   to exact counts (154 vs. today's 155, a specific expected drop) that drift
   as the live-recorded fixtures move forward in time. These are
   *deliberately* strict pins — the code comments say so explicitly, to catch
   real dedup/coverage regressions — so rewriting them to match today's
   numbers risks silently disabling the regression detector they exist for.

Neither class is a safe mechanical fix: both require a decision about
intended behavior (retention policy; whether/how to decouple
regression-pinned fixtures from the ones `refresh.yml` re-records live)
that belongs to whoever owns `ingest/`. Recommend triage before the next
`refresh.yml` schedule fires again.

## Not re-flagged (already tracked)

- `athletics`, `buildings`, `cab`, `clubs`, `events`, `places` reading
  amber/stale against the null-threshold 7-day fallback: this is the
  launch-day-known "seed-lane staleness thresholds" item
  (`2026-08-08-launch.md` deferred list) — these are `seed-load.yml`
  (manual, never scheduled) sources, not continuously polled, and need
  either a real `source_registry` cadence or an explicit "reference data"
  status rather than inheriting the generic default.
- `academic_calendar`, `arcgis`, `bjwa`, `bpr`, `dining`, `libcal`,
  `passiogo`, `ppl` reading `never`: expected — their producers haven't
  shipped (Lane B backlog, same launch-day list).

## Workflow health

- `poll.yml`: last 20+ runs all `success`. No sign of the 60-day cron
  auto-disable (main was last pushed 2026-08-08, 25 days ago, under the
  60-day threshold, and the schedule is still firing).
- `refresh.yml`: 29/29 runs `failure` (see Finding 2).
- `ci.yml`, `deploy.yml`: green on `main`'s current head.

## Overall verdict: **RED**

Two real gaps, neither newly broken today, neither safe to patch
unattended: livewhale runs ~5-8x slower than its configured cadence because
its Worker-lane cutover (already coded, deliberately unwired) was never
finished, and `refresh.yml` has never once succeeded, so dining/library/
ArcGIS artifacts have never refreshed since launch. **Single most important
next action:** owner decides on and lands the livewhale Worker-dispatcher
cutover (`apps/api/src/schedule/runners.ts` + `poll.yml`) — it is the
already-scoped fix for the one source that materially affects what users see
today.
