# BrownSync daily freshness audit — 2026-08-10

Automated run of the daily freshness auditor. Root cause found; **no code
defect** — this is a GitHub Actions execution outage, needs owner action.

## Headline finding: GitHub Actions is not running scheduled jobs for this repo

`poll.yml` (livewhale/athletics/bdh, `lane=actions` in `source_registry`) and
`refresh.yml` (dining/publications/library_hours/arcgis) are both down at the
GitHub Actions layer, not in application code:

- **`poll.yml`**: last successful run `2026-08-09T17:08:06Z`. Every scheduled
  run since `2026-08-09T17:16:49Z` (14+ hours, ~50+ runs by the time of this
  audit) has failed. Confirmed live: re-ran the failed jobs of the most
  recent run (`31389476517`) — it failed again in the same way, seconds
  later.
- **`refresh.yml`**: **0 of 4 runs have ever succeeded** since the workflow
  was enabled at launch (`2026-08-08T09:50:10Z` through today
  `2026-08-10T10:33:39Z`). This explains why `dining`, `libcal`, `arcgis`,
  `ppl`, `passiogo`, `academic_calendar`, `bjwa`, `bpr` all show `never` in
  `/api/health` — their producers have literally never completed a run in
  prod.
- **Signature, consistent across every failing run of both workflows**:
  job completes in 3-6 seconds, `runner_id: 0` / `runner_name: ""` (no
  runner was ever assigned), `get_workflow_run_usage` reports
  `duration_ms: 0`, and `get_job_logs` / the logs archive both return
  nothing (404 / empty zip) — there is no step output at all, because no
  step ever ran. That rules out an application bug (a real `pnpm poll`
  failure would run for tens of seconds and leave a log). This is GitHub
  refusing to schedule the job before it reaches a runner.
- **Corroborating signal**: sources on the Cloudflare Worker cron
  dispatcher (`apps/api/src/scheduled.ts`, `lane in {worker, sql}`) are
  completely unaffected — `brown_news` (lane=worker) and `dedup`
  (lane=sql, dispatched by the Worker every 900s per migration `0018`) are
  both fresh (`brown_news` ~20 min old, `dedup` ~10 min old at audit time).
  The break is isolated to GitHub Actions execution, not to the poller/
  dispatcher code, the database, or the sources themselves.

**Most likely cause**: the account's GitHub Actions minutes are exhausted
for the billing period (this is a private repo; `poll.yml` alone fires on
three cron schedules — every 15 min, every 2 h, and hourly — around the
clock, on top of `refresh.yml`, `ci.yml`, and `deploy.yml`), or a spending
limit / Actions permission got tightened. Both produce exactly this
symptom: new runs fail instantly with no runner ever assigned, and it
persists across every subsequent run until a human intervenes (raise the
spending limit, wait for the monthly reset, or re-enable Actions).

**Action needed from the owner (this is not code-fixable):**
1. Check `https://github.com/settings/billing` (Actions minutes usage and
   spending limit for the account/org that owns `noahfinkelstein/BrownSync`).
2. Check `https://github.com/noahfinkelstein/BrownSync/settings/actions`
   for any workflow permission or run-policy change around
   `2026-08-09T17:16Z`.
3. Once unblocked, no code changes are needed — `poll.yml` and `refresh.yml`
   are unchanged from the last known-good run and should resume normally.

No migration, poller, or dispatcher change is included in this PR — the
audit found no code defect to fix.

## Per-source table (at audit time, 2026-08-10T13:01Z)

| source | status | age vs threshold | verdict |
|---|---|---|---|
| brown_news | ok | 19m / 2h | FRESH |
| dedup | ok | 10m / 1h | FRESH |
| athletics_ics | ok | 19.9h / 4h | STALE (GH Actions down, see above) |
| bdh | ok | 19.9h / 2h | STALE (GH Actions down, see above) |
| livewhale | ok | 20.2h / 40m | STALE (GH Actions down, see above) |
| athletics, buildings, cab, clubs, events, places | ok | ~286h / 168h (default) | STALE — known seed-lane NULL-threshold issue, already tracked in `2026-08-08-launch.md` deferred backlog; not new |
| academic_calendar, arcgis, bjwa, bpr, dining, libcal, passiogo, ppl | never | — | NEVER — producers gated behind `refresh.yml`, which has never completed (see above) |
| feed_rank, providence_gov, today_brown | disabled | — | paused by design |

## Other checks

- Web: `https://brownsync.pages.dev` → `200 OK`.
- `/api/events?start=2026-08-10&end=2026-08-17` → 91 events. Not empty —
  GREEN on data currency for the coming week.
- `deploy.yml` / `ci.yml`: last runs (2026-08-08 / 2026-08-09) both green;
  no pushes since to re-test, so no evidence either is affected by the
  Actions outage yet — but `poll.yml`/`refresh.yml` are on the same
  Actions infrastructure, so expect `ci.yml`/`deploy.yml` to hit the same
  block on the next push/PR until the owner resolves the underlying cause.
- Repo is well within normal push activity (last commit 2 days ago), so
  this is not the "GitHub disables cron after 60 days idle" pattern.

## Overall verdict: **RED**

Single most important next action: **owner checks GitHub Actions
billing/spending-limit status for `noahfinkelstein/BrownSync`** — every
GitHub-Actions-lane data source (livewhale, athletics, bdh, and all of
Lane B: dining/libcal/arcgis/publications) is stuck until that's cleared.
Worker-dispatched sources (brown_news, dedup) are unaffected and need no
action.
