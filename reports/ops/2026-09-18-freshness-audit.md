# BrownSync daily freshness audit — 2026-09-18

## Overall verdict: RED — day 14 of total outage, zero owner action across nine consecutive daily reports

## 1. API — still a total outage

Re-verified at 2026-09-18T12:19Z:

- `/api/health`, `/api/events` (retried 3x), `/api/places`, `/api/articles`,
  `/api/meetings` all return the identical generic
  `500 {"error":{"code":"internal","message":"Unexpected server error."}}`,
  unchanged since #33 (2026-09-10) — day 14 of the outage.
- `/api/openapi.json` (static, no DB) → `200`.
- An unknown route → `404 {"error":{"code":"not_found",...}}`.
- A malformed `/api/events` query → clean `400 {"error":{"code":"bad_request",...}}`.

This confirms the break is still specifically the Postgres/Hyperdrive path,
not the Worker itself — the router, validation, and static routes all work
normally.

Root cause (established in #39, reconfirmed on every report since):
`[dedup] error: (ENOTFOUND) tenant/user postgres.hkrxahzdqqxxovvilalm not
found` — Supabase's Supavisor/PgBouncer pooler rejecting the project
reference documented in `DEPLOY.md`. This is the standard Supabase error
shape for a paused, deleted, or reconfigured project; not diagnosable
further from inside the repo without Cloudflare/Supabase dashboard access,
which this environment does not hold.

## 2. GitHub Actions — still dead since Sept 4

- `poll.yml`: no completed run since 2026-09-04 (14 days). The
  2026-09-11 (`#1681`) and 2026-09-14 (`#1682`) manual `workflow_dispatch`
  runs are both still `status: queued`, no runner ever allocated. Did not
  fire a third diagnostic dispatch — two independent stuck-queued runs
  already establish the pattern.
- `refresh.yml`: last run 2026-09-04 (`#32`, failure) — silent since,
  same gap as `poll.yml`.
- `ci.yml` / `deploy.yml`: last activity 2026-09-02 / 2026-08-08
  respectively — expected, since nothing has merged to `main` since launch.

Two independent stuck-`queued` manual dispatches spanning a week still
point at an account-level Actions/billing block, not a repo setting or a
one-off scheduler stall.

## 3. Web

`brownsync.pages.dev` → `200`, unchanged. Static shell still serves; any
client-side fetch to the API above fails the same way.

## 4. Data currency

Unreachable — `/api/health` and `/api/events` are both down, so no
per-source table or upcoming-events count could be pulled this run (same
as every report since #33).

## 5. Backlog

30 open PRs (#11–#40) before this one, all drafts, zero merged in 41 days
since launch (2026-08-08). #33–#40 each reached this identical outage
diagnosis on eight consecutive prior days with no owner reply beyond
automated bot activity.

## No code fix opened

Same conclusion as #33–#40: a paused/reconfigured Supabase project and a
GitHub Actions account-level block both need owner dashboard access, not a
patch. There is no source-controlled fix for a pooler that rejects the
project reference before any application code runs, and no `supabase db
push` / credential rotation / `wrangler deploy` was run (owner-approved
prod steps this routine never takes unattended).

## Owner action needed (blocking everything else) — unresolved 8 days running

1. Supabase dashboard → project `hkrxahzdqqxxovvilalm` — confirm it is not
   paused; if the project reference changed, update the `DATABASE_URL`
   secret and the Hyperdrive connection string (`apps/api/wrangler.toml`),
   then redeploy.
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions →
   General — likelier the quick fix of the two, given two independent
   stuck-`queued` runs spanning 7+ days.
3. Confirm via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health`
   returning `200` with a populated `sources` array.

## Single most important next action

Same as every report since #33, now day 14: open the Supabase and GitHub
Actions/Billing dashboards. Nothing else in this backlog (the 30 open PRs,
the pre-existing `refresh.yml`/seed-lane AMBER issues) matters until the
production outage is cleared.
