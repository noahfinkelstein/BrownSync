# BrownSync daily freshness audit — 2026-11-01

Day 58 of the total production outage first reported in #33 (2026-09-10,
diagnosed as starting 2026-09-04). No new defect; both root causes and the
owner actions needed are unchanged from the last ~25 daily audits (#33,
#50–#60).

## Step 1 — audit

| source | status | age vs threshold | verdict |
|---|---|---|---|
| (all registry sources) | unknown | n/a | **UNKNOWN** — `/api/health` itself 500s, so the `sources` array (and every per-source freshness check) is unreadable today |

- `GET /api/health` → `500 {"error":{"code":"internal","message":"Unexpected server error."}}` (3/3 retries, ~5s apart).
- `GET /api/now`, `/api/events` → same generic `500 internal`.
- `GET /api/openapi.json` (no DB touch) → `200`. Confirms the Worker itself is up; only the DB-backed routes are broken.
- `https://brownsync.pages.dev` → `200` (static shell only — no live data without a working API).
- Upcoming-events window (today → +7d): **unreadable**, `/api/events` 500s before returning data. Treat as AMBER-or-worse by definition (can't confirm non-empty).

## Workflow health

- **Deploy**: last completed run 2026-08-08 (launch day) — **85 days** with zero deploys, despite 49 open PRs since.
- **Poll**: last *scheduled* success 2026-09-04. Two `workflow_dispatch` attempts since (2026-09-11, 2026-09-14) are still `status: queued`, zero jobs ever allocated — 7+ weeks stuck.
- **Refresh data artifacts**: last completed run 2026-09-04 (failure, continuing a 29/29 failure streak that predates the outage).
- **CI**: last completed run 2026-09-02 (on PR #32's branch). Every PR opened since (#33–#60) triggered no CI run at all — consistent with GitHub Actions being fully blocked for this repo, not a workflow-specific bug.
- Last push to `main` is now 85 days old (2026-08-08) — well past GitHub's 60-day no-activity auto-disable threshold for scheduled (`cron`) workflows, though the workflow `state` still reports `active` via the API.

## Root causes (established #39, reconfirmed daily since, unchanged today)

1. **Supabase project `hkrxahzdqqxxovvilalm` unreachable**, consistent with paused/deleted/reconfigured. Poller logs from the last pre-outage run show `tenant/user postgres.hkrxahzdqqxxovvilalm not found` — pgbouncer's rejection when a Supabase project is paused or the pooler reference no longer matches a live project. This is an owner dashboard action, not a code defect.
2. **GitHub Actions blocked repo-wide** since ~2026-09-11 (queued runs never allocate a job; no CI on 28 consecutive PRs). Consistent with a billing/Actions-minutes/spending-limit lockout. Owner-only (Settings → Billing, Settings → Actions → General).

## Step 2 — fix

No code fix attempted today: both root causes require owner dashboard/billing access this session doesn't have, and that conclusion is already filed and unchanged (PR #58, open, tested, still unmerged — upgrades the misleading `500` to the correct `503 db_unavailable` for this exact Supabase pooler rejection, but explicitly does not resolve the outage). No new PR opened for the same finding; see PR #58 and the day-by-day history in #33–#59.

## Step 3 — overall verdict

**RED.** Single most important next action, unchanged for 58 days: owner resumes/reconnects Supabase project `hkrxahzdqqxxovvilalm` in its dashboard (or updates `DATABASE_URL`/Hyperdrive if the reference changed and redeploys), and separately clears whatever is blocking GitHub Actions under Settings → Billing and Settings → Actions → General. Also: triage the 49-PR backlog (#11–#60), unreviewed for over two months, which includes PR #58's ready fix.
