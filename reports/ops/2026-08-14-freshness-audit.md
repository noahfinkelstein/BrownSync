# BrownSync freshness audit — 2026-08-14

Automated daily audit. No new code defect found — every failure mode
observed today reproduces a root cause already diagnosed, fixed, and sitting
unmerged in an open PR from a prior day's audit. This report exists to
record that continuity and flag the growing review backlog itself as the
live risk.

## Per-source health (`/api/health`, checked 2026-08-14T17:19Z)

| source | status | last ok | age vs threshold | verdict |
|---|---|---|---|---|
| livewhale | ok | 16:24Z today | 55m / 40m | FRESH |
| brown_news | ok | 16:51Z today | 28m / 2h | FRESH |
| bdh | ok | 15:27Z today | 1h52m / 2h | FRESH |
| athletics_ics | ok | 15:27Z today | 1h52m / 4h | FRESH |
| dedup | ok | 17:04Z today | 15m / 1h | FRESH |
| athletics (legacy seed row) | ok | 2026-07-29 | 16d / null→7d | STALE — pre-existing, fix open in #12 |
| buildings | ok | 2026-07-29 | 16d / null→7d | STALE — pre-existing, fix open in #12 |
| cab | ok | 2026-07-29 | 16d / null→7d | STALE — pre-existing, fix open in #12 |
| clubs | ok | 2026-07-29 | 16d / null→7d | STALE — pre-existing, fix open in #12 |
| events (raw ingest lane) | ok | 2026-07-29 | 16d / null→7d | STALE — pre-existing, fix open in #12 |
| places | ok | 2026-07-29 | 16d / null→7d | STALE — pre-existing, fix open in #12 |
| academic_calendar | never | — | — | NEVER — producer not yet built, not previously ok |
| bjwa / bpr / ppl | never | — | — | NEVER — Lane B producers deferred post-launch (2026-08-08 report) |
| dining / libcal / arcgis | never | — | — | NEVER — blocked on refresh.yml never reaching a merged PR (see below) |
| passiogo | never | — | — | NEVER — realtime producer not yet built |
| feed_rank, providence_gov, today_brown | never | — | — | paused by design (`enabled: false`) |

Web: `brownsync.pages.dev` → 200.
Data currency: `/api/events` for 2026-08-14→08-21 → **94 events**, GREEN.

## Workflow health

- **Poll** — green. Last 5 scheduled runs today all succeeded
  (livewhale, athletics+bdh, dedup ticks). The GitHub Actions execution
  outage recorded in PR #13 (2026-08-09/10, jobs failing instantly with no
  runner assigned) has cleared on its own; no recurrence since.
- **Refresh data artifacts** — red, **8/8 scheduled runs failed** since the
  workflow's first run (2026-08-08). Today's failure (run #8, 10:14Z) fails
  at the identical step and identical assertions as every prior run:
  `test_every_stored_fixture_is_manifested` (two orphaned
  `hours-grid-*.html` files) and the pinned `test_dedupe.py` /
  `test_sources.py` article-count assertions (155 vs pinned 154). This is
  the exact defect PR #16 already fixes (library-grid pruning +
  publications pulled off cron, building on #11/#14/#15's earlier attempts
  at the same bug). **No new root cause today — the existing fix is still
  correct, it is simply unmerged**, so the bug keeps reproducing on
  schedule.
- **CI** — green (last run 2026-08-13, tracks the last merge to `main`).
- **Deploy** — green (last run 2026-08-08; nothing new has merged to
  redeploy).
- **Seed Load** — on-demand only by design, not on a cron; not a health
  signal.
- No sign of the "cron disabled after 60 days idle" pattern — the repo is
  active and every workflow is still firing on schedule.

## The actual live risk: a 6-PR unreviewed backlog, not a code gap

Six open, draft, unmerged PRs from this same daily audit routine have
accumulated since the 2026-08-08 launch, each `mergeable_state: clean`,
each still valid:

| PR | Filed | Fixes |
|---|---|---|
| #11 | 08-08 | rolling-fixture pruning (first attempt) |
| #12 | 08-09 | **seed-lane `source_registry` rows (migration 0024)** — clears all six STALE rows above |
| #13 | 08-10 | docs only — the GH Actions outage (now self-resolved) |
| #14 | 08-11 | rolling-fixture pruning (re-diagnosed, same bug) |
| #15 | 08-12 | frozen dedupe-test corpus, decoupled from live recapture |
| #16 | 08-13 | **complete fix**: pruning + publications off cron — supersedes #11/#14 |

None have been merged or reviewed (each carries only its own generated
comment). Because nothing has landed, the same two defects — the
seed-lane registry gap and the `refresh.yml` fixture-hygiene bug — get
independently rediscovered by this audit roughly every day, which is why
the PR count keeps growing instead of resolving.

**The two PRs that matter are #12 and #16.** Merging both would:
clear all six seed-lane STALE rows, and stop `refresh.yml`'s red streak
(modulo the item below).

## Still needs owner action, no code fix possible

`refresh.yml` cannot open a PR at all even once its pytest gate is green:
job logs show `GitHub Actions is not permitted to create or approve pull
requests (createPullRequest)` (first reported in PR #12). This is
Settings → Actions → General → Workflow permissions → "Allow GitHub
Actions to create and approve pull requests" on the repo, not something a
commit can change.

## Overall verdict: **AMBER**

Nothing is on fire — the live product (map, feed, `brownsync.pages.dev`,
`brown_news`/`livewhale`/`bdh`/`athletics_ics`/dedup) is fresh and serving
94 upcoming events. The risk is entirely in the unreviewed queue.

**Single most important next action:** review and merge PR #12 and PR #16
(both `mergeable_state: clean`, zero conflicts), and flip the "Allow
GitHub Actions to create and approve pull requests" repo setting so
`refresh.yml` can land its own PRs going forward instead of needing a
human to notice and re-open the same fix weekly.

---
_Generated by [Claude Code](https://claude.ai/code)_
