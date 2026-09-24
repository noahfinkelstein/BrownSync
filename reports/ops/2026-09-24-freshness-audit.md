# BrownSync daily freshness audit — 2026-09-24

## Overall verdict: RED — total outage, day 15 since first reported (#33, 2026-09-10), 14 consecutive identical daily reports (#33-#45) with zero owner action beyond one automated bot comment

## 1. API — total outage, unchanged
Verified 2026-09-24T12:03Z:
- `GET /api/health` → `500 {"error":{"code":"internal","message":"Unexpected server error."}}` (3x retry, identical each time)
- `GET /api/events` (no params, and with an explicit ISO `from`/`to` range) → same `500`
- `GET /api/articles` → same `500`
- `GET /api/openapi.json` (static, no DB touch) → `200`
- `GET /api/events` with a bare (non-ISO) date → clean, distinct `400 bad_request`

This confirms the Worker itself is up and routing/validation work normally — the break is specifically the Postgres/Hyperdrive path, exactly as established in #39 (2026-09-16, `[dedup] error: (ENOTFOUND) tenant/user postgres.hkrxahzdqqxxovvilalm not found` from Poll run #1680's job log) and reconfirmed in every report since. No new information this session; not diagnosable further without Supabase/Cloudflare dashboard access.

Because `/api/health` itself is down, no per-source staleness table can be pulled.

## 2. GitHub Actions — still dead since 2026-09-04
- `poll.yml`: last **completed** run was #1680 (schedule, 2026-09-04T14:34:37Z) — 20 days ago. The two manual `workflow_dispatch` attempts since, #1681 (owner, 2026-09-11) and #1682 (audit session, 2026-09-14), are **still `status: queued`, 13 and 10 days later, with no runner ever allocated** — reconfirmed this session via `get_workflow_run`.
- `refresh.yml`: silent since run #32 (2026-09-04), same pattern.
- `ci.yml`: last run was #72 (2026-09-02), tied to the last merged-adjacent PR activity.
- `deploy.yml`: last run was #27 (2026-08-08, launch), expected since nothing has merged to `main` since.
- Workflow definitions are `state: active` in the API (not `disabled_inactive`), and last push to `main` was 2026-08-07 — only 48 days of repo inactivity, short of GitHub's 60-day scheduled-workflow auto-disable. Two independent stuck-`queued` dispatches spanning 10-13 days with zero runner allocation continues to point at an **account-level GitHub Actions block** (billing/spending limit, or Actions paused for the account), not a repo setting or the 60-day rule. Did not fire a third diagnostic dispatch — the pattern is already established twice over.

## 3. Web
`https://brownsync.pages.dev` → `200`, unchanged. Static shell only; every client-side data fetch fails the same way the API does above.

## 4. Backlog
35 open PRs, all drafts, zero merged since launch (48 days). PRs #33-#45 (13 consecutive daily reports, 2026-09-10 through 2026-09-22) reached this identical diagnosis with no owner reply beyond one CodeRabbit bot comment on #45.

## No code fix opened
Same conclusion as #33-#45: a paused/reconfigured Supabase project and a GitHub Actions account-level block both require owner dashboard/billing access, not a repository patch. Nothing in `services/poller`, `apps/api/src/schedule*`, `ingest/`, or `.github/workflows` explains either symptom — the workflow YAML and Worker code are unchanged since launch and were passing before 2026-09-04/09-10.

## Owner action needed (blocking everything else) — unresolved 14 days running
1. Supabase dashboard → project `hkrxahzdqqxxovvilalm` — confirm it is not paused; if the project reference changed, update the `DATABASE_URL` secret and Hyperdrive connection string, then redeploy the Worker.
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions → General for this account — the two independent stuck-`queued` runs (10 and 13 days with no runner allocation) make this the likelier quick fix of the two.
3. Confirm via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health` returning `200` with a populated `sources` array, and via a completed (non-`queued`) Poll run.

## Single most important next action
Unchanged since #33, now day 15: open the Supabase and GitHub Actions/Billing dashboards. No further code-side audit will surface new information until one of those two account-level blocks is cleared.
