# BrownSync daily freshness audit — 2026-10-04

Day 31 of the total production outage first reported in #33 (2026-09-10,
itself diagnosed as starting 2026-09-04). Unchanged in every respect from
yesterday's audit (#52). No new code defect, no new owner action, no code
fix opened.

## Source health (`/api/health`)

Could not be read: the endpoint itself 500s. Every DB-backed route does:

| check | result |
|---|---|
| `GET /api/health` | `500 {"error":{"code":"internal","message":"Unexpected server error."}}` (3/3 retries) |
| `GET /api/events` (default window, and explicit `from`/`to`) | `500`, identical envelope |
| `GET /api/articles` | `500`, identical envelope |
| `GET /api/meetings` | `500`, identical envelope |
| `GET /api/buildings` (unknown route, control) | `404` — confirms only DB-backed handlers fail, not the Worker itself |
| `brownsync.pages.dev` | `200` (static shell only; no live data, since the API is down) |

Verdict for every enabled source: **ERROR** (unreadable — the health endpoint
that reports source status is itself down). Upcoming-events count:
**unavailable** (RED, not AMBER — term-time empty window would be AMBER;
a fully broken API is worse).

## Root cause (established #39, reconfirmed daily since, unchanged today)

1. **Supabase project `hkrxahzdqqxxovvilalm` unreachable.** `apps/api/src/app.ts`
   already classifies real connection-level failures (ECONNREFUSED, timeouts,
   Postgres class-08 SQLSTATEs, workerd's bare "connection attempt failed")
   as `503 db_unavailable` — see `apps/api/src/errors.ts`. Getting a generic
   `500 internal` instead means the error postgres.js is throwing against
   this Supabase project doesn't match any of those known shapes, which is
   consistent with a paused/deleted/reconfigured Supabase project (a
   different failure mode than a plain network drop) rather than a bug in
   that classifier. This sandbox has no outbound route to `*.supabase.co`
   (confirmed via the agent-proxy's own relay-failure log, a 502 from the
   proxy gateway itself) to probe it directly.
2. **GitHub Actions has executed nothing in 30 days.** Last completed run of
   any workflow: `poll.yml` #1680, 2026-09-04 13:34 UTC (`schedule`, success).
   The two `workflow_dispatch` attempts since (#1681 2026-09-11, #1682
   2026-09-14) are still `status: queued`, now 23 and 20 days old, with zero
   jobs ever allocated. All workflows report `state: active`; last push to
   `main` is 57 days old (short of the 60-day scheduled-workflow auto-disable).
   Points at an account-level Actions billing/usage block, not a cron-disable
   or a workflow-file bug.

Neither is fixable from inside the repo. No code change was made.

## Backlog

30 open PRs (#11–#52, all but a handful of real fixes are routine audit
docs), unreviewed for close to two months. PR #52 (yesterday's audit) has
no owner response — only an automated CodeRabbit comment.

## Owner action needed — unresolved 31 days running

1. Supabase dashboard → project `hkrxahzdqqxxovvilalm`: confirm it isn't
   paused/deleted; if its reference changed, update `DATABASE_URL`/Hyperdrive
   and redeploy (owner-only — deploys are an owner-approved step).
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions →
   General, for this account.
3. Triage the 30-PR backlog.
4. Confirm fixed via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health`
   returning `200` with a populated `sources` array, and a completed
   (non-`queued`) Poll run.

## Overall verdict: **RED**

Single most important next action: **owner checks the Supabase project
dashboard for `hkrxahzdqqxxovvilalm`** — that is the one lever that unblocks
both the API outage and (once polling resumes) the Actions backlog.
