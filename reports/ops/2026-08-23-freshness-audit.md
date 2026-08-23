# Daily freshness audit — 2026-08-23

## Summary

**No code fix opened.** This is the **sixteenth** consecutive daily audit
session. `main` is still at the launch commit (`3cb7ca1`, 2026-08-08
01:57 UTC) — **zero pushes to main in 15 days** — while **fourteen** PRs
(#11–#24) sit open, draft, and `mergeable_state: clean`. Today's
investigation confirms the previously-diagnosed `refresh.yml` root cause
is unchanged, and turns up **one new, distinct root cause** on the
Sunday-only `arcgis` leg that no prior audit had isolated: it clears the
test gate cleanly and then fails at PR creation because **this repository's
Actions settings do not allow workflows to open pull requests** — a
one-checkbox owner fix, not a code defect.

## Per-source table

| source | status | age vs threshold | verdict |
|---|---|---|---|
| livewhale | ok | ~11 min / 40 min | FRESH |
| bdh | ok | ~1.2h / 2h | FRESH |
| athletics_ics | ok | ~1.2h / 4h | FRESH |
| brown_news | ok | ~5 min / 2h | FRESH |
| dedup | ok | ~3 min / 1h | FRESH |
| athletics (seed) | ok | 25d / null→7d default | STALE (by design — seed lane, see below) |
| buildings (seed) | ok | 25d / null→7d default | STALE (by design — seed lane) |
| cab (seed) | ok | 25d / null→7d default | STALE (by design — seed lane) |
| clubs (seed) | ok | 25d / null→7d default | STALE (by design — seed lane) |
| events (seed) | ok | 25d / null→7d default | STALE (by design — seed lane) |
| places (seed) | ok | 25d / null→7d default | STALE (by design — seed lane) |
| academic_calendar | never | — | NEVER — hand-curated, pre-existing gap, not `refresh.yml`'s scope |
| arcgis | never | — | NEVER — `refresh.yml` blocked, **new root cause today**, see below |
| dining | never | — | NEVER — `refresh.yml` blocked (pytest gate, known) |
| libcal | never | — | NEVER — `refresh.yml` blocked (pytest gate, known) |
| bpr | never | — | NEVER — `refresh.yml` blocked (pytest gate, known) |
| bjwa | never | — | NEVER — `refresh.yml` blocked (pytest gate, known) |
| ppl | never | — | NEVER — `refresh.yml` blocked (pytest gate, known) |
| passiogo | never | — | NEVER — producer not yet deployed (pre-existing, out of scope) |
| providence_gov | n/a | disabled | paused by design (recorded refusal) |
| today_brown | n/a | disabled | paused by design (recorded refusal) |
| feed_rank | n/a | disabled | paused by design (producer not built) |

Seed-lane sources (`athletics`, `buildings`, `cab`, `clubs`, `events`,
`places`) are one-time loads from `seed-load.yml` (human-dispatched,
2026-07-29) with no `source_registry` row, so `stale_after_seconds` reads
`null` → this audit's 7-day default trips STALE. Fix written three times
independently (#12, #19, #20 — same migration slot, will conflict with
each other on merge). No change today.

## `refresh.yml` — two distinct, unrelated blockers

`refresh.yml` runs as a matrix: a daily group (dining/library_hours/
publications, cron `12 9 * * *`) and a Sunday-only `arcgis` group (cron
`42 9 * * 0`). Today is a Sunday, so both legs ran and I checked both
job logs directly rather than relying on last week's diagnosis.

**Daily group — unchanged since 2026-08-11.** Run at 09:37:58 UTC today
died at the same `uv run pytest -q` gate as every prior audit:
`test_every_stored_fixture_is_manifested` (4 orphaned
`hours-grid-*.html` files from prior weeks' rolling LibCal window — the
pruning bug #21 already fixes), the Hay Library / Rock-vs-Champlin
open-days drift (calendar rotation, owner-triage item per #21), and
`tests/publications/test_dedupe.py` (155 vs. pinned 154 — live RSS
corpus rolled the pinned duplicate off-window, per #16's flag). Same
shape, same fix already sitting in #21.

**`arcgis` group (Sunday-only) — new finding.** Run at 09:58:45 UTC
captured cleanly, and — because this leg never touches the
libraries/publications fixtures — the full offline suite passed clean:
`1412 passed, 98 skipped`, matching #21's own documented pre-bug
baseline. `db:seed-check` also passed (`PASS — 0 failures, 0
warning(s)`). It committed the refreshed artifacts to a new branch,
pushed successfully, then died on `gh pr create`:

```
pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)
```

`refresh.yml` already declares `permissions: { contents: write,
pull-requests: write }` at the workflow level — that's necessary but not
sufficient. This error is the repository's **Settings → Actions →
General → Workflow permissions** toggle ("Allow GitHub Actions to
create and approve pull requests") reporting disabled. That setting sits
outside the repo's version control; no commit can flip it. This is
almost certainly why `arcgis` has read `never` since launch even on the
one weekly window it gets to run cleanly, independent of the
library/publications pytest gate that blocks its daily siblings.
**No PR opened for this** — there is no code change to make; it needs
the owner to check that box once in repo settings.

## Workflow health

- **Poll**: green on every recent run (livewhale/athletics_ics/bdh/
  brown_news/dedup all firing on their ~15–30 min cadence; last 30
  runs checked, 30/30 success).
- **CI**: green (last run against #24's branch, success).
- **Deploy**: green; last deploy is still the 2026-08-08 launch commit —
  expected, nothing has merged to `main` since.
- **Refresh data artifacts**: red — daily group 19/19 since 2026-08-08
  (pytest gate, known, fix in #21); `arcgis` group blocked by repo
  settings (new finding, this session).
- **60-day cron auto-disable**: not yet a risk (15 days since the last
  push to `main`), all 6 workflows report `state: active`. Worth
  watching — it keeps advancing every day this backlog stays unmerged.

## Web + data currency

- `brownsync.pages.dev` → 200.
- `/api/events` for the next 7 days (2026-08-23 → 2026-08-30): **123
  events**, 95 active / 28 canceled. Populated — GREEN on this axis.

## Open PR backlog (14 open, all draft, all `mergeable_state: clean`, none reviewed)

#11–#24, dated 2026-08-08 through 2026-08-22. #21 remains the current
best version of the library-grid prune fix (supersedes #11/#14/#15/#16/
#19/#20's copies of the same fix). One of #12/#19/#20 needs picking for
the seed-lane registry fix; the other two should close. #23 is a
separate, unrelated `brown_news` href-prefix fix, still unmerged though
`brown_news` is currently reporting `ok` regardless.

## Single most important next action

Two owner actions, neither of which is a code review:

1. **Settings → Actions → General → check "Allow GitHub Actions to
   create and approve pull requests."** This alone should unblock the
   `arcgis` leg going forward (next Sunday, or via manual
   `workflow_dispatch`).
2. **Merge #21**, then pick one of #12/#19/#20 for the seed-lane fix and
   close the other two.

Both are small, mechanical, and already proven safe — #21 is
`mergeable_state: clean` with 1415 tests passing. Sixteen days and
fourteen PRs into this backlog, review/settings latency — not missing or
uncertain code — is the only thing standing between this repo and a
green `Refresh data artifacts` workflow.

## Overall verdict: **AMBER**

Live/polled sources (livewhale, bdh, athletics_ics, brown_news, dedup),
the web app, and upcoming event data are all healthy. The file-based
ingest lane (dining, arcgis, libcal, bpr, bjwa, ppl) has been dark since
launch. Today adds a second, independent, non-code blocker (repo Actions
settings) on top of the already-diagnosed pytest-gate defect. Neither
needs new code — one checkbox and one merge would clear most of this
backlog at once.

---
_Generated by Claude Code freshness-auditor session, 2026-08-23._
