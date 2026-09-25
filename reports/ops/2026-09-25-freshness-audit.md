# BrownSync daily freshness audit — 2026-09-25

## Overall verdict: RED — total outage, day 16 since first reported (#33, 2026-09-10), 15 consecutive identical daily reports (#33-#47) with zero owner action beyond one automated bot comment

## 1. API — total outage, unchanged
Verified 2026-09-25T12:03Z (3x retry on `/api/health`, identical each time):
- `GET /api/health` → `500 {"error":{"code":"internal","message":"Unexpected server error."}}`
- `GET /api/now` → same `500`
- `GET /api/events` (no params, and with an explicit ISO `from`/`to` range) → same `500`
- `GET /api/orgs` → same `500`
- `GET /api/articles` (explicit ISO range) → same `500`
- `GET /api/events` with a bare (non-ISO) date → clean, distinct `400 bad_request`
- `GET /api/openapi.json` (static, no DB touch) → `200`
- `GET /api/doesnotexist` → clean `404 not_found`

This confirms the Worker itself is up and routing/validation work normally — the break is specifically the Postgres/Hyperdrive path, exactly as established in #39 (2026-09-16, `[dedup] error: (ENOTFOUND) tenant/user postgres.hkrxahzdqqxxovvilalm not found` from Poll run #1680's job log) and reconfirmed in every report since. No new information this session; not diagnosable further without Supabase/Cloudflare dashboard access. (This session's sandbox network policy also blocks direct outbound to `*.supabase.co`, so a fresh REST/auth-health probe against the project could not be attempted here — dashboard access remains the only path.)

Because `/api/health` itself is down, no per-source staleness table can be pulled. Source-registry data (migration 0006/0021 seeds) shows what *should* be running (livewhale, athletics_ics, bpr, bjwa, ppl, dining, libcal, arcgis, passiogo, academic_calendar, dedup, bdh — the last enabled headline-only per the 2026-08-07 owner decision in #22) and what is deliberately refused (`providence_gov`, `today_brown` — blocked, `feed_rank` — disabled pending its producer), but none of it is verifiable live while the API is down.

## 2. GitHub Actions — still dead since 2026-09-04
- `poll.yml`: last **completed** run was #1680 (schedule, 2026-09-04T14:34:37Z) — 21 days ago. The two manual `workflow_dispatch` attempts since, #1681 (owner, 2026-09-11) and #1682 (audit session, 2026-09-14), are **still `status: queued`, 14 and 11 days later, with no runner ever allocated** (job list for #1682 returns zero jobs) — reconfirmed this session.
- `refresh.yml`: silent since run #32 (2026-09-04, failure), same pattern; no new runs.
- `ci.yml`: last run was #72 (2026-09-02), tied to the last merged-adjacent PR activity.
- `deploy.yml`: last run was #27 (2026-08-08, launch), expected since nothing has merged to `main` since.
- Workflow definitions are `state: active` in the API (not `disabled_inactive`), and last push to `main` was 2026-08-07 — only 49 days of repo inactivity, still short of GitHub's 60-day scheduled-workflow auto-disable, but closing in (~11 days out). Two independent stuck-`queued` dispatches spanning 11-14 days with zero runner allocation continues to point at an **account-level GitHub Actions block** (billing/spending limit, or Actions paused for the account), not a repo setting or the 60-day rule. Did not fire a third diagnostic dispatch — the pattern is already established twice over and a third would just add a third stuck run.

## 3. Web
`https://brownsync.pages.dev` → `200`, unchanged. Static shell only; every client-side data fetch fails the same way the API does above.

## 4. Backlog
36 open PRs (#11-#47), all drafts, zero merged since launch (49 days). PRs #33-#47 (15 consecutive daily reports, 2026-09-10 through 2026-09-24) reached this identical diagnosis with no owner reply beyond one CodeRabbit bot comment on #45.

## No code fix opened
Same conclusion as #33-#47: a paused/reconfigured Supabase project and a GitHub Actions account-level block both require owner dashboard/billing access, not a repository patch. Nothing in `services/poller`, `apps/api/src/schedule*`, `ingest/`, or `.github/workflows` explains either symptom — the workflow YAML and Worker code are unchanged since launch and were passing before 2026-09-04/09-10.

## Owner action needed (blocking everything else) — unresolved 15 days running
1. Supabase dashboard → project `hkrxahzdqqxxovvilalm` — confirm it is not paused; if the project reference changed, update the `DATABASE_URL` secret and Hyperdrive connection string, then redeploy the Worker.
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions → General for this account — the two independent stuck-`queued` runs (11 and 14 days with no runner allocation) make this the likelier quick fix of the two.
3. Confirm via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health` returning `200` with a populated `sources` array, and via a completed (non-`queued`) Poll run.

## Single most important next action
Unchanged since #33, now day 16: open the Supabase and GitHub Actions/Billing dashboards. No further code-side audit will surface new information until one of those two account-level blocks is cleared.
