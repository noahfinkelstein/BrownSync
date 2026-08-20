# Daily freshness audit — 2026-08-20

## Summary

**No new code defect.** Every problem found today reproduces a root cause
already diagnosed and fixed in an open, unmerged, `mergeable_state: clean`
PR from a prior day's audit. This is the **eleventh** consecutive daily
audit session; **ten** PRs (#12–#21) have accumulated since launch
(2026-08-08) because none has been reviewed or merged. `main` is still at
the launch commit (`3cb7ca1`, 2026-08-07 21:57 -0400) — **zero pushes to
main in 12 days**, despite 10 ready fixes sitting in draft PRs.

This audit did not open a twelfth PR duplicating an existing fix. The
action needed is a merge, not another patch.

## Per-source table

| source | status | age vs threshold | verdict |
|---|---|---|---|
| livewhale | ok | ~9 min / 40 min | FRESH |
| athletics_ics | ok | ~1.4h / 4h | FRESH |
| bdh | ok | ~1h / 2h | FRESH |
| brown_news | ok | ~1 min / 2h | FRESH |
| dedup | ok | ~12 min / 2h | FRESH |
| athletics (seed) | ok | 22d / null→7d default | STALE (by design — seed lane, see below) |
| buildings (seed) | ok | 22d / null→7d default | STALE (by design — seed lane) |
| cab (seed) | ok | 22d / null→7d default | STALE (by design — seed lane) |
| clubs (seed) | ok | 22d / null→7d default | STALE (by design — seed lane) |
| events (seed) | ok | 22d / null→7d default | STALE (by design — seed lane) |
| places (seed) | ok | 22d / null→7d default | STALE (by design — seed lane) |
| academic_calendar | never | — | NEVER — registered, ingest-lane, hand-curated; not yet loaded (pre-existing gap) |
| arcgis | never | — | NEVER — `refresh.yml` blocked (see below) |
| dining | never | — | NEVER — `refresh.yml` blocked |
| libcal | never | — | NEVER — `refresh.yml` blocked |
| bpr | never | — | NEVER — `refresh.yml` blocked |
| bjwa | never | — | NEVER — `refresh.yml` blocked |
| ppl | never | — | NEVER — `refresh.yml` blocked |
| passiogo | never | — | NEVER — producer not yet deployed (pre-existing, not this audit's scope) |
| bdh (registry `false`) | n/a | — | duplicate row; live `bdh` (enabled) is fresh above |
| providence_gov | n/a | disabled | paused by design (recorded refusal) |
| today_brown | n/a | disabled | paused by design (recorded refusal) |
| feed_rank | n/a | disabled | paused by design (producer not built) |

**Seed-lane sources** (`athletics`, `buildings`, `cab`, `clubs`, `events`,
`places`): one-time loads from `seed-load.yml` (human-dispatched,
2026-07-29). Not a real 22-day staleness problem — no live endpoint sits
behind them, they refresh once a term. They read STALE only because they
have no `source_registry` row (`stale_after_seconds: null` → the audit's
7-day default). **Fix already written three times independently**, in
#12 (`0024_seed_lane_registry.sql`), #19 (`0024_seed_lane_staleness.sql`),
and #20 (`0024_seed_lane_staleness_thresholds.sql`) — all propose the same
migration number with slightly different cadence values. **These three
will conflict with each other on merge.** Recommend the owner pick one
(they're materially equivalent) and close the other two, rather than a
fourth attempt at the same row-insert.

## `refresh.yml` — root cause, confirmed unchanged since 2026-08-11

Checked the last 15 scheduled runs via the Actions API: **15/15 failures**,
2026-08-08 through 2026-08-20, every one dying at the same step —
**"Offline suite must pass against the NEW fixtures"** (`uv run pytest -q`
in `ingest/`). This is why `dining`, `arcgis`, `libcal`, `bpr`, `bjwa`, and
`ppl` have never once reported `ok`.

Root cause (`capture_libraries()`'s rolling 7-week LibCal window never
prunes files that age out) was fixed in #14, re-fixed in #15/#16 with
frozen test corpora for the unrelated publications-pin issue, and most
recently in **#21** (2026-08-19), which is the current best version:
`mergeable_state: clean`, 1415 tests passing, scoped to exactly the prune
logic with new regression coverage, and does not touch the
publications/dedupe pin drift (a separate, correctly-deferred owner
decision about whether to re-pin or freeze that fixture corpus).

**Today's run (09:46 UTC, run #15) fails identically** — confirms #21's
diagnosis is still accurate and nothing has drifted further.

## Workflow health

- **Poll**: green on every recent run (livewhale/athletics+bdh/dedup all
  firing on their crons, no gaps).
- **CI**: green (last run against the #21 branch passed).
- **Deploy**: green; last deploy was the 2026-08-08 launch commit — expected,
  since nothing has merged to `main` since.
- **Refresh data artifacts**: red, 15/15, see above.
- **60-day cron auto-disable**: not yet a risk (12 days since last push to
  `main`), but every day this backlog goes unmerged is a day closer. Worth
  a proactive mention now rather than waiting for it to become urgent.

## Web + data currency

- `brownsync.pages.dev` → 200.
- `/api/events` for the next 7 days: populated (livewhale + brown_news
  items present, e.g. Brown Alumni Karaoke, Alumni Career Initiative
  networking, Brown Corporation news). Not empty — GREEN on this axis.

## Open PRs from this routine (all draft, all unreviewed)

| PR | Date | Status |
|---|---|---|
| #12 | 08-09 | seed-lane registry (one of 3 duplicate proposals) |
| #13 | 08-10 | docs — GH Actions outage (self-resolved, informational only) |
| #14 | 08-11 | library-grid prune (superseded by #21) |
| #15 | 08-12 | library-grid prune + frozen publications corpus (superseded by #21) |
| #16 | 08-13 | library-grid prune + pulled publications off cron (superseded by #21) |
| #17 | 08-14 | docs — no new defect |
| #18 | 08-15 | docs — no new defect |
| #19 | 08-17 | seed-lane registry (dup) + library-grid prune (superseded by #21) |
| #20 | 08-18 | seed-lane registry (dup) + library-grid prune (superseded by #21) |
| #21 | 08-19 | **library-grid prune — current best version, clean, ready to merge** |

## Single most important next action

**Merge #21**, then pick one of #12/#19/#20 for the seed-lane staleness
fix and close the other two. Both are zero-conflict against current
`main`. Everything else in this backlog is superseded once those two land;
no further code changes are needed for `dining`/`arcgis`/`libcal` to start
reporting real health, or for the seed-lane sources to stop reading
falsely stale.

## Overall verdict: **AMBER**

Live/polled sources (livewhale, athletics_ics, bdh, brown_news, dedup) and
the web app are healthy. The file-based ingest lane (dining, arcgis,
libcal, bpr, bjwa, ppl) has been dark since launch, with a correct, tested
fix sitting unmerged for 9 days. The failure mode is now entirely
process — review latency — not code.
