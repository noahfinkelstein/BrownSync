# Freshness audit — 2026-08-27

19th consecutive daily session (first was 2026-08-08, launch day).

## Per-source table (`/api/health`, checked 2026-08-27T12:55:39Z)

| source | status | age vs threshold | verdict |
|---|---|---|---|
| brown_news | ok | 26m vs 2h | FRESH |
| dedup | ok | 2m vs 1h | FRESH |
| livewhale | ok | 7h5m vs 40m | STALE — poll.yml cron gap (new finding, see below) |
| athletics_ics | ok | 9h23m vs 2h | STALE — same cron gap |
| bdh | ok | 9h23m vs 2h | STALE — same cron gap |
| athletics / buildings / cab / clubs / events / places | ok | 28d22h vs 7d default | STALE — one-time seed lane, no recurring schedule since 2026-07-29 (fix drafted in #12/#19/#20) |
| academic_calendar / dining / libcal / bpr / bjwa / ppl | never | — | NEVER — `refresh.yml` pytest gate (fix in #21, `mergeable_state: clean`, unmerged since 2026-08-19) |
| arcgis | never | — | NEVER — blocked separately by the repo's Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" toggle (#25) |
| passiogo | never | — | NEVER — producer not yet deployed (pre-existing, out of scope) |
| providence_gov / today_brown / feed_rank | — | disabled | paused by design |

## New finding: Poll workflow cron gap

`poll.yml` schedules livewhale every 15 min, athletics+bdh every 2h, dedup hourly. Its last completed run was **2026-08-27T05:49:48Z** (run #1556, success) — as of this audit (12:55Z, later re-checked 13:04Z) there has been **no run in over 7 hours**, despite the tightest cron firing every 15 minutes. This is why livewhale/bdh/athletics_ics read STALE despite the pipeline itself being healthy (dedup and brown_news, which run off the newer Worker-dispatcher cron rather than this GitHub Actions workflow, are both fresh). This looks like a GitHub Actions scheduled-trigger delay/stall, not a code defect — nothing in this repo's history explains a mid-day gap on an active cron. Recommend the owner check the repo's Actions tab for a stuck run or a platform incident; a `workflow_dispatch` of `poll.yml` would also clear it immediately but that's a production write, so left to the owner rather than triggered by this unattended audit.

## Duplicate-fix cleanup

Before checking for prior open PRs, this session independently root-caused and fixed `refresh.yml`'s daily-group pytest failure (`test_every_stored_fixture_is_manifested`, caused by `capture_libraries`'s rolling 7-week window never pruning filenames that scroll out of range) and opened PR #28. On review this is the **fourth** independent derivation of the identical fix — #11 (2026-08-08), #14 (2026-08-11), #16 (2026-08-13), #19/#20/#21 (2026-08-17/18/19) all contain the same patch. #21 is `mergeable_state: clean` and was independently re-verified correct by the 2026-08-25 audit (#27). #28 has been closed as a duplicate with a comment pointing to #21 — see PR #28 for the diff, in case any detail in it (three focused offline tests) is useful to fold into #21 before merging.

**Re-deriving already-solved fixes, not finding new defects, is now the primary cost of running this routine daily while the backlog sits unreviewed.**

## Workflow health

- Poll: green on every run, but see the cron-gap finding above — no run since 05:49:48Z as of 13:04Z.
- Refresh data artifacts: red, 22/22 scheduled runs failed since 2026-08-08. Root cause diagnosed and fixed on-branch (#21); arcgis leg separately blocked by a repo setting (#25).
- CI: green (run #65 on main's last CI-relevant state; run #66 in progress against this session's now-closed #28).
- Deploy: green; still the 2026-08-08 launch commit — **zero merges to `main` in 19 days**.
- Seed Load: one-time manual (`workflow_dispatch` only), last ran 2026-07-29 — this is the seed lane behind the STALE `athletics`/`buildings`/`cab`/`clubs`/`events`/`places` rows above; there is no recurring schedule for it by design, so "stale" per the default 7-day fallback threshold may be a false alarm rather than a regression — worth an explicit staleness-threshold decision (`source_registry` update) rather than a recurring re-run of a mostly-static catalog.
- 60-day cron auto-disable: not an immediate risk (19 days since last push to `main`), but the margin is now below a third of the window and shrinking daily with zero merge activity.

## Web + data currency

- `brownsync.pages.dev` → 200.
- `/api/events`, next 7 days (2026-08-27–2026-09-03): **166 events** — healthy, non-empty.

## Backlog

**18 open PRs** (#11–#27, plus #28 now closed as duplicate), all opened by this routine since 2026-08-08, **none merged, none closed** until this session's #28. #12/#19/#20 are additional supersede-candidates for the seed-lane staleness-threshold fix; #21 is the tested fix for the daily-refresh red streak; #23 is an unrelated brown_news scraper drift fix from 2026-08-21 also still unreviewed.

## Single most important next action

**Merge #21** (clears the 22/22 daily-refresh red streak) and flip **Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"** (clears the arcgis leg, #25). Both are zero-risk, already tested, and have been sitting ready since 2026-08-19 and 2026-08-23 respectively. Separately, check why `poll.yml` hasn't fired since 05:49 UTC today.

## Overall verdict: AMBER

The web app, live-polled sources (livewhale/bdh/athletics_ics/brown_news/dedup), and upcoming-events count are all healthy in substance — today's STALE readings on the polled sources trace to a several-hour GitHub Actions cron gap, not a code or data problem. The real standing risk is unchanged from every prior session: 19 days and an 18-PR review backlog, including two zero-risk tested fixes, sitting unmerged — that's what's between this repo and green, not missing engineering.

---
_Generated by [Claude Code](https://claude.ai/code)_
