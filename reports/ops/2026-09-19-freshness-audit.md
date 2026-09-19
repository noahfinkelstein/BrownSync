# BrownSync daily freshness audit — 2026-09-19

## Overall verdict: RED — day 15 of total outage, zero owner action across ten consecutive daily reports

Docs-only, no code changed. Same two root causes as #33-#41, both still unresolved.

## 1. API — still a total outage

Verified at 2026-09-19:

- `/api/health`, `/api/events` (no params, and with an explicit ISO
  `from`/`to` range), `/api/articles`, `/api/meetings` all return the
  identical generic `500 {"error":{"code":"internal","message":"Unexpected
  server error."}}`, unchanged since #33 (2026-09-10) — day 15 of the
  outage.
- Malformed `/api/events` params (bare `YYYY-MM-DD`, no time component)
  still get a clean, distinct `400 {"error":{"code":"bad_request",...}}` —
  confirms request validation and routing both still work; the break is
  specifically the Postgres/Hyperdrive path, matching every report since
  #33.

Root cause (established in #39, reconfirmed on every report since,
unchanged): Supabase's Supavisor/PgBouncer pooler rejects the project
reference (`postgres.hkrxahzdqqxxovvilalm`) documented in `DEPLOY.md` —
the standard error shape for a paused, deleted, or reconfigured Supabase
project. Not diagnosable further from inside the repo without
Cloudflare/Supabase dashboard access, which this environment does not
hold. `apps/api/src/app.ts`'s `isDbUnavailable()` classifier still doesn't
catch however this error presents through the Worker's Hyperdrive
binding, hence `500` instead of `503` — a real gap noted in #38, still not
worth patching blind while the actual outage needs a dashboard fix, not a
better error code.

## 2. GitHub Actions — still dead since Sept 4

- `poll.yml`: no completed run since 2026-09-04 (15 days). The
  2026-09-11 (`#1681`) and 2026-09-14 (`#1682`) manual `workflow_dispatch`
  runs are both still `status: queued`, no runner ever allocated —
  reconfirmed this session, 5 and 8 days after they were fired
  respectively. Did not fire a third diagnostic dispatch.
- `refresh.yml`: last run 2026-09-04 (`#32`, failure) — silent since.
- `ci.yml` / `deploy.yml`: last activity 2026-09-02 / 2026-08-08
  respectively — expected, since nothing has merged to `main` since
  launch.

Two independent stuck-`queued` manual dispatches now spanning 8+ days
still point at an account-level Actions/billing block, not a repo setting
or a one-off scheduler stall.

## 3. Web

`brownsync.pages.dev` → `200`, unchanged. Static shell still serves; any
client-side fetch to the API above fails the same way.

## 4. Data currency

Unreachable — `/api/health` and `/api/events` are both down, so no
per-source table or upcoming-events count could be pulled this run (same
as every report since #33).

## 5. Backlog

31 open PRs (#11–#41) before this one, all drafts, zero merged in 42 days
since launch (2026-08-08). #33–#41 each reached this identical outage
diagnosis on nine consecutive prior days with no owner reply beyond
automated bot activity.

## No code fix opened

Same conclusion as #33–#41: a paused/reconfigured Supabase project and a
GitHub Actions account-level block both need owner dashboard access, not
a patch. There is no source-controlled fix for a pooler that rejects the
project reference before any application code runs, and no `supabase db
push` / credential rotation / `wrangler deploy` was run (owner-approved
prod steps this routine never takes unattended).

## Owner action needed (blocking everything else) — unresolved 9 days running

1. Supabase dashboard → project `hkrxahzdqqxxovvilalm` — confirm it is not
   paused; if the project reference changed, update the `DATABASE_URL`
   secret and the Hyperdrive connection string (`apps/api/wrangler.toml`),
   then redeploy.
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions →
   General — likelier the quick fix of the two, given two independent
   stuck-`queued` runs spanning 8+ days.
3. Confirm via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health`
   returning `200` with a populated `sources` array.

## Single most important next action

Same as every report since #33, now day 15: open the Supabase and GitHub
Actions/Billing dashboards. Nothing else in this backlog (the 31 open
PRs, the pre-existing `refresh.yml`/seed-lane AMBER issues) matters until
the production outage is cleared.
