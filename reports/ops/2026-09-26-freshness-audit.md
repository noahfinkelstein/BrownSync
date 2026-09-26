# BrownSync daily freshness audit — 2026-09-26

## Overall verdict: RED — total outage, day 17 since first reported (#33, 2026-09-10), 16 consecutive identical daily reports (#33-#48) with zero owner action beyond one automated bot comment

## 1. API — total outage, unchanged
Verified 2026-09-26 (3x retry on `/api/health`, identical each time):
- `GET /api/health` → `500 {"error":{"code":"internal","message":"Unexpected server error."}}`
- `GET /api/now` → same `500`
- `GET /api/events` (no params, and with an explicit ISO `from`/`to` range) → same `500`
- `GET /api/orgs` → same `500`
- `GET /api/places` → same `500`
- `GET /api/articles` → same `500`
- `GET /api/events` with a bare (non-ISO) date → clean, distinct `400 bad_request` ("Invalid ISO datetime")
- `GET /api/openapi.json` (static, no DB touch) → `200`

This confirms the Worker itself is up and routing/validation work normally — the break is specifically the Postgres/Hyperdrive path, exactly as established in #39 (2026-09-16, `[dedup] error: (ENOTFOUND) tenant/user postgres.hkrxahzdqqxxovvilalm not found` from Poll run #1680's job log) and reconfirmed in every report since (#39-#48). No new information this session; not diagnosable further without Supabase/Cloudflare dashboard access.

Because `/api/health` itself is down, no per-source staleness table can be pulled, and `/api/events` for [today, today+7d] cannot be checked either — both are AMBER/RED by definition while the API is down (the upcoming-events window is unreachable, not merely empty).

## 2. GitHub Actions — still dead since 2026-09-04
- `poll.yml`: last **completed** run was #1680 (schedule, 2026-09-04T14:34:37Z) — 22 days ago. The two manual `workflow_dispatch` attempts since, #1681 (owner, 2026-09-11) and #1682 (audit session, 2026-09-14), are **still `status: queued`, 15 and 12 days later, with no runner ever allocated** — reconfirmed this session via the Actions API.
- `refresh.yml`: silent since run #32 (2026-09-04, failure); no new runs. Note: this workflow had already failed on every single scheduled run since it shipped (29/29, 2026-08-08–2026-09-01, per #32/CI comment) at an offline-pytest fixture-drift step — a pre-existing, already-tracked test-design issue unrelated to the current outage, still unfixed but moot while the workflow can't even be scheduled.
- `ci.yml`: last run was #72 (2026-09-02), tied to the last merged-adjacent PR activity.
- `deploy.yml`: last run was #27 (2026-08-08, launch).
- Workflows remain `state: active` (not `disabled_inactive`) in the API. Two independent stuck-`queued` dispatches spanning 12-15 days with zero runner allocation continues to point at an **account-level GitHub Actions block** (billing/spending limit, or Actions paused for the account), not a repo setting or the 60-day scheduled-workflow auto-disable rule. Did not fire a third diagnostic dispatch — the pattern is already established twice over.

## 3. Web
`https://brownsync.pages.dev` → `200`, unchanged. Static shell only; every client-side data fetch fails the same way the API does above.

## 4. Backlog
37 open PRs (#11-#48), all drafts, zero merged since launch (50 days). PRs #33-#48 (16 consecutive daily reports, 2026-09-10 through 2026-09-25) reached this identical diagnosis with no owner reply beyond one CodeRabbit bot comment on #45.

## No code fix opened
Same conclusion as #33-#48: a paused/reconfigured Supabase project and a GitHub Actions account-level block both require owner dashboard/billing access, not a repository patch. Nothing in `services/poller`, `apps/api/src/schedule*`, `ingest/`, or `.github/workflows` explains either symptom — the workflow YAML and Worker code are unchanged since launch and were passing before 2026-09-04/09-10.

## Owner action needed (blocking everything else) — unresolved 16 days running
1. Supabase dashboard → project `hkrxahzdqqxxovvilalm` — confirm it is not paused; if the project reference changed, update the `DATABASE_URL` secret and Hyperdrive connection string, then redeploy the Worker.
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions → General for this account — the two independent stuck-`queued` runs (12 and 15 days with no runner allocation) make this the likelier quick fix of the two.
3. Confirm via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health` returning `200` with a populated `sources` array, and via a completed (non-`queued`) Poll run.

## Single most important next action
Unchanged since #33, now day 17: open the Supabase and GitHub Actions/Billing dashboards. No further code-side audit will surface new information until one of those two account-level blocks is cleared.
