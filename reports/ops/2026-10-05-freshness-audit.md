# BrownSync daily freshness audit — 2026-10-05

Day 32 of the total production outage first reported in #33 (2026-09-10,
itself diagnosed as starting 2026-09-04). Unchanged in every respect from
yesterday's audit (#53). No new code defect, no new owner action, no code
fix opened.

## Source health (`/api/health`)

Could not be read: the endpoint itself 500s. Every DB-backed route does:

| check | result |
|---|---|
| `GET /api/health` | `500 {"error":{"code":"internal","message":"Unexpected server error."}}` (3/3 retries) |
| `GET /api/events` (default window, and explicit `from`/`to`) | `500`, identical envelope |
| `GET /api/buildings` (unknown route, control) | `404` — confirms only DB-backed handlers fail, not the Worker itself |
| `brownsync.pages.dev` | `200` (static shell only; no live data, since the API is down) |

Verdict for every enabled source: **ERROR** (unreadable — the health endpoint
that reports source status is itself down). Upcoming-events count:
**unavailable** (RED, not AMBER — term-time empty window would be AMBER;
a fully broken API is worse).

## Root cause (established #39, reconfirmed daily since, unchanged today)

1. **Supabase project `hkrxahzdqqxxovvilalm` unreachable.** `apps/api/src/errors.ts`
   already classifies real connection-level failures (ECONNREFUSED, timeouts,
   Postgres class-08 SQLSTATEs, workerd's bare "connection attempt failed")
   as `503 db_unavailable`. Getting a generic `500 internal` instead is
   consistent with a paused/deleted/reconfigured Supabase project (a
   different failure shape than a plain network drop), not a bug in that
   classifier. This sandbox again has no outbound route to `*.supabase.co`
   to probe it directly (agent-proxy CONNECT tunnel itself returns `502`).
2. **GitHub Actions has executed nothing in 31 days.** Last completed run of
   any workflow: `poll.yml` #1680, 2026-09-04 13:34 UTC (`schedule`, success).
   The two `workflow_dispatch` attempts since (#1681 2026-09-11, #1682
   2026-09-14) are still `status: queued`, now 24 and 21 days old, with zero
   jobs ever allocated. New data point today: `CI` (`pull_request`-triggered,
   not cron) has also not run once since run #72 (2026-09-02, PR #32) despite
   21 further PRs (#33–#53) opened against `main` since — confirming this is
   not a schedule-only stall but a total halt of every Actions trigger,
   consistent with an account-level billing/usage block rather than the
   60-day cron auto-disable (last push to `main` is now 58 days old, still
   short of that threshold) or any single workflow-file problem.

Neither is fixable from inside the repo. No code change was made.

## Backlog

42 open PRs (#11–#53, almost all routine audit docs plus a handful of real
fixes: #21 pytest-gate fix, #12/#19/#20 seed-lane staleness, #25 arcgis),
unreviewed for close to two months. PR #53 (yesterday's audit) has no owner
response.

## Owner action needed — unresolved 32 days running

1. Supabase dashboard → project `hkrxahzdqqxxovvilalm`: confirm it isn't
   paused/deleted; if its reference changed, update `DATABASE_URL`/Hyperdrive
   and redeploy (owner-only — deploys are an owner-approved step).
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions →
   General, for this account — CI (PR-triggered, not just cron) is also dead,
   which points more strongly at an account-wide Actions block than a
   workflow-specific issue.
3. Triage the 42-PR backlog.
4. Confirm fixed via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health`
   returning `200` with a populated `sources` array, and a completed
   (non-`queued`) Poll or CI run.

## Overall verdict: **RED**

Single most important next action: **owner checks the Supabase project
dashboard for `hkrxahzdqqxxovvilalm`** — that is the one lever that unblocks
both the API outage and (once polling resumes) the Actions backlog.
