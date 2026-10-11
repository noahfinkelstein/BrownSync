# BrownSync daily freshness audit — 2026-10-11

Day 38 of the total production outage first reported in #33 (2026-09-10,
itself diagnosed as starting 2026-09-04). Unchanged in every respect from
the last several audits (most recently #54, 2026-10-05). No new code
defect, no new owner action visible, no code fix opened.

## Source health (`/api/health`)

Could not be read: the endpoint itself 500s. Every DB-backed route does:

| check | result |
|---|---|
| `GET /api/health` | `500 {"error":{"code":"internal","message":"Unexpected server error."}}` (2/2 retries) |
| `GET /api/events` (default window, and explicit 7-day window) | `500`, identical envelope |
| `GET /api/now`, `/api/orgs`, `/api/places`, `/api/meetings`, `/api/articles` | all `500`, identical envelope |
| `GET /api/openapi.json` (no DB) | `200` — confirms the Worker itself is up and routing |
| `GET /api/me` (auth, no DB) | `401` — confirms auth middleware runs fine |
| `GET /api/doesnotexist` (unknown route, control) | `404` — confirms only DB-backed handlers fail |
| `brownsync.pages.dev` | `200` (static shell only; no live data, since the API is down) |

Verdict for every enabled source: **ERROR** (unreadable — the health
endpoint that reports source status is itself down). Upcoming-events count:
**unavailable** (RED, not AMBER — a fully broken API is worse than an empty
term-time window).

## Root cause (established #39, reconfirmed daily since, unchanged today)

1. **Supabase project `hkrxahzdqqxxovvilalm` unreachable.** `apps/api/src/errors.ts`
   classifies real connection-level failures (ECONNREFUSED, timeouts,
   Postgres class-08 SQLSTATEs, workerd's bare "connection attempt failed")
   as `503 db_unavailable`. Getting a generic `500 internal` instead, on
   every single DB-backed route including trivial ones (`/api/places`),
   is consistent with a paused/deleted/reconfigured Supabase project, not a
   code bug — the same conclusion every prior audit has reached. This
   sandbox still has no outbound route to `*.supabase.co` to probe directly.
2. **GitHub Actions has executed nothing in 37 days.** Last completed run of
   any workflow: `poll.yml` #1680, 2026-09-04 13:34 UTC (`schedule`,
   success). The two stale `workflow_dispatch` attempts (#1681 2026-09-11,
   #1682 2026-09-14) are still `status: queued`, now 30 and 27 days old,
   with zero jobs ever allocated. `CI` (`pull_request`-triggered) has not
   run once since run #72 (2026-09-02, PR #32) despite dozens more PRs
   opened against `main` since — a total halt of every Actions trigger,
   consistent with an account-level billing/usage block. Last push to
   `main` is now 64 days old (2026-08-08), which has now crossed GitHub's
   60-day cron-auto-disable threshold as well — both mechanisms are now
   plausibly in play simultaneously.

Neither is fixable from inside the repo. No code change was made.

## Backlog

43 open PRs (#11–#54, almost all routine audit docs plus a handful of real
fixes), unreviewed for over two months. No owner response on any recent
audit PR.

## Owner action needed — unresolved 38 days running

1. Supabase dashboard → project `hkrxahzdqqxxovvilalm`: confirm it isn't
   paused/deleted; if its reference changed, update `DATABASE_URL`/Hyperdrive
   and redeploy (owner-only — deploys are an owner-approved step).
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions →
   General, for this account. Also note: a push to `main` (even a trivial
   one, e.g. merging one backlog PR) would clear the 60-day cron-disable
   condition, though it will not fix the Supabase side.
3. Triage the 43-PR backlog — at minimum, merge or close the ~40 duplicate
   daily-audit PRs once the underlying outage is fixed.
4. Confirm fixed via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health`
   returning `200` with a populated `sources` array, and a completed
   (non-`queued`) Poll or CI run.

## Overall verdict: **RED**

Single most important next action: **owner checks the Supabase project
dashboard for `hkrxahzdqqxxovvilalm`** — that is the one lever that unblocks
the API outage. This has now been flagged in 20+ consecutive daily audit
PRs (#33 through #54) with no visible action; a push notification was sent
with this run since the PR channel does not appear to be reaching the owner.
