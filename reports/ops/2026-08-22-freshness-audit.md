# Daily freshness audit — 2026-08-22

## Summary

**No new code defect.** Every problem found today reproduces root causes
already diagnosed and fixed in open, unmerged, `mergeable_state: clean`
PRs from prior days' audits. This is the **fifteenth** consecutive daily
audit session; **thirteen** PRs (#11–#23) have accumulated since launch
(2026-08-08) because none has been reviewed or merged. `main` is still at
the launch commit (`3cb7ca1`, 2026-08-08 01:57 UTC) — **zero pushes to
main in 14 days**, despite multiple ready, tested fixes sitting in draft
PRs.

This audit did not open a fourteenth PR duplicating an existing fix. This
report-only PR (#24) is filed purely to keep the daily record continuous;
the action needed is a merge, not another patch.

## Per-source table

| source | status | age vs threshold | verdict |
|---|---|---|---|
| livewhale | ok | ~10 min / 40 min | FRESH |
| athletics_ics | ok | ~1.2h / 4h | FRESH |
| bdh | ok | ~1.2h / 2h | FRESH |
| brown_news | ok | ~19 min / 2h | FRESH |
| dedup | ok | ~1 min / 1h | FRESH |
| athletics (seed) | ok | 24d / null→7d default | STALE (by design — seed lane, see below) |
| buildings (seed) | ok | 24d / null→7d default | STALE (by design — seed lane) |
| cab (seed) | ok | 24d / null→7d default | STALE (by design — seed lane) |
| clubs (seed) | ok | 24d / null→7d default | STALE (by design — seed lane) |
| events (seed) | ok | 24d / null→7d default | STALE (by design — seed lane) |
| places (seed) | ok | 24d / null→7d default | STALE (by design — seed lane) |
| academic_calendar | never | — | NEVER — registered, hand-curated; not yet loaded (pre-existing gap, not `refresh.yml`'s scope) |
| arcgis | never | — | NEVER — `refresh.yml` blocked (see below) |
| dining | never | — | NEVER — `refresh.yml` blocked |
| libcal | never | — | NEVER — `refresh.yml` blocked |
| bpr | never | — | NEVER — `refresh.yml` blocked |
| bjwa | never | — | NEVER — `refresh.yml` blocked |
| ppl | never | — | NEVER — `refresh.yml` blocked |
| passiogo | never | — | NEVER — producer not yet deployed (pre-existing, out of scope) |
| providence_gov | n/a | disabled | paused by design (recorded refusal) |
| today_brown | n/a | disabled | paused by design (recorded refusal) |
| feed_rank | n/a | disabled | paused by design (producer not built) |

Seed-lane sources (`athletics`, `buildings`, `cab`, `clubs`, `events`,
`places`): one-time loads from `seed-load.yml` (human-dispatched,
2026-07-29), not a live-endpoint staleness problem. They read STALE only
because they have no `source_registry` row (`stale_after_seconds: null` →
this audit's 7-day default). Fix already written three times
independently — **#12**, **#19**, **#20** — all propose the same
migration slot with near-identical content and **will conflict with each
other on merge**. Recommend the owner pick one and close the other two.

## `refresh.yml` — root cause, confirmed unchanged since 2026-08-11

Checked all 17 scheduled runs via the Actions API: **17/17 failures**,
2026-08-08 through 2026-08-22 (today's run, 09:37 UTC), every one dying
at the same step — "Offline suite must pass against the NEW fixtures"
(`uv run pytest -q` in `ingest/`). Confirmed via job log that today's
failure is byte-for-byte the same shape as prior days:

- `test_every_stored_fixture_is_manifested` — 3 orphaned
  `hours-grid-*.html` files left on disk from prior weeks' rolling
  LibCal capture window (the pruning bug **#21** already fixes).
- `test_a_space_closed_all_summer_still_publishes_days` /
  `test_undefined_days_are_omitted_and_reported` — Hay Library now shows
  18 open days as the fall semester approaches; a pinned "closed all
  summer" fixture assumption drifting with the calendar, already flagged
  in #21 as an owner-triage item (not a code defect).
  Rock vs. Champlin grid-length inequality (70 == 70) is the same
  drift.
- `tests/publications/test_dedupe.py` (154 vs. 155 articles, missing
  the one pinned cross-outlet duplicate) — the live RSS corpus rolled the
  pinned duplicate pair off-window; **#16** already proposed pulling
  `publications` off the daily cron for exactly this reason.

This is why `dining`, `arcgis`, `libcal`, `bpr`, `bjwa`, and `ppl` have
never once reported `ok`. **#21** (2026-08-19) remains the current best
fix for the pruning bug: `mergeable_state: clean`, 1415 tests passing,
scoped only to the prune logic.

## Workflow health

- **Poll**: green on every recent run (livewhale/athletics+bdh/dedup all
  firing on their crons; most recent run 12:00 UTC today, success).
- **CI**: green (last run, against #23's branch, passed).
- **Deploy**: green; last deploy is still the 2026-08-08 launch commit —
  expected, nothing has merged to `main` since.
- **Refresh data artifacts**: red, 17/17, see above.
- **60-day cron auto-disable**: not yet a risk (14 days since the last
  push to `main`), but the clock keeps advancing every day this backlog
  goes unmerged.

## Web + data currency

- `brownsync.pages.dev` → 200.
- `/api/events` for the next 7 days (2026-08-22 → 2026-08-29): **115
  events**. Populated — GREEN on this axis.

## Open PRs from this routine (all draft, all unreviewed, all
`mergeable_state: clean`)

| PR | Date | Status |
|---|---|---|
| #11 | 08-08 | library-grid prune (superseded by #21) |
| #12 | 08-09 | seed-lane registry (1 of 3 duplicate proposals) |
| #13 | 08-10 | docs — GH Actions outage (self-resolved, informational only) |
| #14 | 08-11 | library-grid prune (superseded by #21) |
| #15 | 08-12 | library-grid prune + frozen publications corpus (superseded by #21) |
| #16 | 08-13 | library-grid prune + pulled publications off cron (superseded by #21) |
| #17 | 08-14 | docs — no new defect |
| #18 | 08-15 | docs — no new defect |
| #19 | 08-17 | seed-lane registry (dup) + library-grid prune (superseded by #21) |
| #20 | 08-18 | seed-lane registry (dup) + library-grid prune (superseded by #21) |
| #21 | 08-19 | **library-grid prune — current best version, clean, ready to merge** |
| #22 | 08-20 | docs — no new defect |
| #23 | 08-21 | brown_news `/index.php` href-prefix fix (unrelated, separate defect — also unmerged, though `brown_news` is currently reporting `ok` regardless) |

## Single most important next action

**Merge #21**, then pick one of #12/#19/#20 for the seed-lane staleness
fix and close the other two. Both are zero-conflict against current
`main`. Everything else in this backlog is superseded once those two
land; no further code changes are needed for `dining`/`arcgis`/`libcal`
to start reporting real health, or for the seed-lane sources to stop
reading falsely stale. Fourteen days and thirteen PRs into this backlog,
review latency — not missing code — is the only thing standing between
this repo and a green `Refresh data artifacts` workflow.

## Overall verdict: **AMBER**

Live/polled sources (livewhale, athletics_ics, bdh, brown_news, dedup),
the web app, and upcoming event data are all healthy. The file-based
ingest lane (dining, arcgis, libcal, bpr, bjwa, ppl) has been dark since
launch, with a correct, tested fix sitting unmerged for 14 days. The
failure mode is entirely process — review latency — not code.
