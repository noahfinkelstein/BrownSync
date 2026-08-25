# BrownSync freshness audit — 2026-08-25

Daily freshness audit, 18th consecutive session. No new code defect found —
today reproduces the same two blockers diagnosed and filed on prior sessions
(#21 code fix, #25 repo-setting finding), both still open and unmerged.
This report documents state only; no 27th duplicate PR opened for either.

## Per-source table

| source | status | age vs threshold | verdict |
|---|---|---|---|
| livewhale | ok | well within threshold | FRESH |
| bdh | ok | well within threshold | FRESH |
| athletics_ics | ok | well within threshold | FRESH |
| brown_news | ok | well within threshold | FRESH |
| dedup | ok | well within threshold | FRESH |
| athletics | ok | 26.9d / null→7d default | **STALE** (seed lane, fix drafted in #12/#19/#20) |
| buildings | ok | 26.9d / null→7d default | **STALE** (seed lane) |
| cab | ok | 26.9d / null→7d default | **STALE** (seed lane) |
| clubs | ok | 26.9d / null→7d default | **STALE** (seed lane) |
| events | ok | 26.9d / null→7d default | **STALE** (seed lane) |
| places | ok | 26.9d / null→7d default | **STALE** (seed lane) |
| academic_calendar | never | — | NEVER — `refresh.yml` blocked (pytest gate, fix in #21) |
| dining | never | — | NEVER — same blocker |
| libcal | never | — | NEVER — same blocker |
| bpr | never | — | NEVER — same blocker |
| bjwa | never | — | NEVER — same blocker |
| ppl | never | — | NEVER — same blocker |
| arcgis | never | — | NEVER — repo Settings→Actions PR-creation toggle (see #25), weekly leg otherwise clears cleanly |
| passiogo | never | — | NEVER — producer not yet deployed (pre-existing, out of scope) |
| providence_gov / today_brown / feed_rank | n/a | disabled | paused by design |

## Workflow health

- **Poll**: green — last 30+ scheduled runs all `success` (livewhale ~11min cadence,
  athletics_ics/bdh/brown_news/dedup all firing on schedule).
- **CI**: green.
- **Deploy**: green; still sitting on the 2026-08-08 launch commit —
  **zero merges to `main` in 17.4 days**.
- **Refresh data artifacts**: red — every scheduled run since launch (21/21)
  has failed at the same step, "Offline suite must pass against the NEW
  fixtures" (`uv run pytest -q` in `ingest/`), always the same 7 tests:
  a stale-fixture manifest bug (root-caused and fixed on-branch in #21,
  `mergeable_state: clean`, still a draft, still unmerged) plus 6 assertions
  pinned to point-in-time live data (Hay Library's summer closure, an exact
  RSS dedupe count/pair) that have simply drifted as the calendar and news
  cycle moved — not code bugs, correctly left unfixed and flagged for owner
  triage in #21's own PR body. The Sunday-only `arcgis` leg clears its own
  gate cleanly but dies at `gh pr create` — blocked by the repo's
  Settings → Actions → General → "Allow GitHub Actions to create and approve
  pull requests" toggle, not code (per #25).
- **60-day cron auto-disable**: not yet triggered (17.4 days of inactivity on
  `main`, all 6 workflows report `state: active`), but the margin is shrinking
  daily with no merges landing.

## Web + data currency

- `brownsync.pages.dev` → 200.
- `/api/events`, next 7 days (2026-08-25 → 2026-09-01): 122 events, 95 active /
  27 canceled — **all 122 from `livewhale`**. The one-time `events`-source
  seed (1,106 items loaded 2026-07-29) remains fully rolled past the
  lookahead window with nothing behind it, since `events`/`athletics`/`cab`/
  `clubs`/`buildings`/`places` have had no scheduled refresh since launch.
  Functionally this endpoint is healthy today (122 events, GREEN by the
  letter of the check), but it is still running on a single producer — same
  second-order symptom flagged since #12, unchanged in kind from yesterday.

## Backlog

**16 open PRs (#11–#26), all from daily freshness-audit sessions, none
merged, none closed.** #12/#19/#20 remain supersede-candidates for the same
seed-lane fix — an owner triage pass picking one and closing the other two
shrinks the queue by two immediately. #21 is the tested,
`mergeable_state: clean` fix for the daily refresh red streak.

A background investigation run during this session independently re-derived
the exact same root cause and fix already sitting in #21 before being
stopped short of opening a duplicate — the review backlog is now large
enough that re-deriving already-solved fixes is becoming the main cost of
this routine, not finding new ones.

## Single most important next action

Merge **#21** (clears the 21/21 daily `Refresh data artifacts` red streak)
and flip **Settings → Actions → General → "Allow GitHub Actions to create
and approve pull requests"** (clears the `arcgis` leg). Both are zero-risk,
already-verified, and together resolve the majority of the open backlog's
root causes. Everything else in the 16-PR queue is a triage/merge decision,
not new engineering.

## Overall verdict: AMBER

Live/polled sources, the web app, and today's upcoming-events count are all
healthy on paper. The file-based ingest lane and the seed lane have been
dark since the 2026-08-08 launch with tested fixes sitting unreviewed — 17.4
days and 16 PRs of review latency, not missing code, is what's standing
between this repo and green.

---
_Generated by [Claude Code](https://claude.ai/code)_
