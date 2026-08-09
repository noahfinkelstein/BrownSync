# BrownSync daily freshness audit — 2026-08-09

Automated audit, day 2 post-launch (launch: 2026-08-08, see
`2026-08-08-launch.md`).

## Source health (`/api/health` at 2026-08-09T12:13Z)

| source | status | lastOkAt | horizon | verdict |
|---|---|---|---|---|
| livewhale | ok | 12:01:47Z | 2400s | FRESH |
| athletics_ics | ok | 11:05:35Z | 14400s | FRESH |
| bdh | ok | 11:05:38Z | 7200s | FRESH |
| brown_news | ok | 12:08:52Z | 7200s | FRESH |
| dedup | ok | 12:12:53Z | 3600s | FRESH |
| bpr | never | — | 7200s | NEVER — no producer run yet (registered, not built) |
| bjwa | never | — | 7200s | NEVER — no producer run yet |
| ppl | never | — | 7200s | NEVER — no producer run yet |
| dining | never | — | 172800s | NEVER — blocked on `refresh.yml` (see below) |
| libcal | never | — | 10800s | NEVER — blocked on `refresh.yml` (see below) |
| arcgis | never | — | 1209600s | NEVER — blocked on `refresh.yml` (see below) |
| passiogo | never | — | 300s | NEVER — no producer run yet |
| academic_calendar | never | — | 63072000s | NEVER — not a problem (2-year horizon) |
| athletics, buildings, cab, clubs, events, places | ok | 2026-07-29 | **was NULL** | **fixed this session — see below** |
| feed_rank, providence_gov, today_brown | — | — | — | paused by design (unchanged) |

## Findings

### 1. `refresh.yml` — 3/3 scheduled runs have failed since it started (Aug 8)

Root cause, from the job logs (run 31307879577, step "Open a pull request if
anything actually changed"):

```
pull request create failed: GraphQL: GitHub Actions is not permitted to
create or approve pull requests (createPullRequest)
##[error]Process completed with exit code 1.
```

Everything **before** that step succeeds every run: the live re-fetch from
dining/publications/library-hours/ArcGIS, the artifact rebuild, the offline
suite, and `db:seed-check` all pass against the freshly captured bytes (see
the Aug 9 10:15Z run — `pnpm --filter @brownsync/db seed-check` reports
"PASS — 0 failures, 0 warnings" right before the PR step fails). The data is
fine; it just never reaches a human because the PR never opens, so it never
merges, and `dining`/`libcal`/`arcgis` stay `never` in prod forever.

**This is a repository setting, not a code bug** — Settings → Actions →
General → Workflow permissions → "Allow GitHub Actions to create and approve
pull requests" is unchecked for this repo. No commit in this repo can flip
it; it needs the owner (repo admin) to either:
  - check that box (30 seconds, no code change), or
  - provision a PAT with `repo` scope as a secret and swap it in for
    `GITHUB_TOKEN` in `.github/workflows/refresh.yml`'s `GH_TOKEN` env.

Per the hard rule "if the cause needs credentials or human action, describe
it precisely instead" — no PR opened for this one; flagged here and in the
day's notification instead.

### 2. Seed-lane sources (athletics/buildings/cab/clubs/events/places) — FIXED

These six ingest-CLI bootstrap sources (`ingest/README.md`) had no
`source_registry` row, so `api_health()` emitted `stale_after_seconds: NULL`
and every client fell back to its own default horizon
(`apps/web/src/ops/health-model.ts`'s 45-minute `STALE_AFTER_MS`) — which
read their Jul 29 launch-load timestamp as "stale" on every single
subsequent audit. Recorded as P2 backlog in `2026-08-08-launch.md`
("seed real thresholds or refresh cadence").

Confirmed via `Seed Load` workflow history + `ingest/README.md`: these six
are re-captured together from hand-curated, hash-pinned exports (the Fall
2026 CAB export, etc.) whenever an operator runs `uv run ingest run all`,
not on any poll cadence — there is no live endpoint behind them to re-poll.
"Seed real thresholds" (not "refresh cadence") is therefore the correct fix.

Fix: migration `0024_seed_lane_registry.sql` registers all six with
`lane='ingest'`, `cadence_seconds=15552000` (~180 days, one semester),
`stale_after_seconds=31104000` (2x, matching the `academic_calendar`
convention from migration 0006). Checked with
`db/checks/0024_seed_lane_registry_checks.sql`, wired into `ci.yml`.

Validated locally: installed `postgresql-16` + `postgresql-16-postgis-3` in
the session sandbox, applied all 24 migrations in order end to end, and ran
every existing rollback-safe check plus the new one — all green, no
regressions. (CI's `postgis/postgis:15-3.4` service will re-verify on the
PR.)

## Web + events

- `https://brownsync.pages.dev` → 200.
- `/api/events` for [2026-08-09, 2026-08-16]: 94 upcoming rows. GREEN — not
  an empty-window problem.

## Workflow health (last runs, `gh` unavailable — read via GitHub API)

- **Poll**: last 5 scheduled runs (11:05Z–12:17Z today) all `success`.
- **CI**: last runs `success`/`cancelled`/`success` — green on main.
- **Deploy**: last 3 pushes to main all `success`.
- **Refresh data artifacts**: 3/3 runs `failure` — see finding #1.
- **Seed Load**: one-shot, ran once successfully 2026-07-29 (the bootstrap
  load these six sources trace back to); not expected to run again until
  the next hand-curated export lands.
- No sign of the 60-day cron-disable pattern — repo has commits and cron
  runs daily.

## Overall verdict: **AMBER**

Nothing student-facing is on fire (map, events, feed, BDH/brown_news/
athletics/livewhale all fresh, 94 upcoming events, site is 200). The one
real defect — `refresh.yml` unable to open PRs — has been failing silently
since Aug 8 and is why `dining`/`libcal`/`arcgis` will stay stuck at
`never` indefinitely without it. **Single most important next action:**
Noah enables "Allow GitHub Actions to create and approve pull requests" in
repo Settings → Actions → General (or swaps in a PAT), then re-run
`refresh.yml` via `workflow_dispatch` to confirm the backlog of three
failed captures finally lands a PR.
