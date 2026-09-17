# BrownSync daily freshness audit — 2026-09-17

## Overall verdict: RED — day 13 of total outage, zero owner action across eight consecutive daily reports

Docs-only, no code changed. Same root causes as #33-#39, both still unresolved.

## 1. API — still a total outage

Re-verified at 2026-09-17: `/api/health`, `/api/events`, `/api/articles`, `/api/meetings`
all return the identical generic `500 {"error":{"code":"internal","message":"Unexpected
server error."}}`. `/api/openapi.json` (no DB) and an unknown route (`404`) both behave
normally, confirming the break is still specifically the Postgres/Hyperdrive path, not
the Worker itself — unchanged from every report since #33 (2026-09-10).

Root cause (established in prior reports, re-confirmed here from Poll run #1680's job
log): `[dedup] error: (ENOTFOUND) tenant/user postgres.hkrxahzdqqxxovvilalm not found` —
Supabase's connection pooler rejecting the project reference documented in `DEPLOY.md`.
This is the standard Supabase error for a paused/deleted/reconfigured project; it cannot
be diagnosed further or fixed from the repo.

## 2. GitHub Actions — still dead since Sept 4

`poll.yml` has not completed a run since 2026-09-04 (13 days). The owner's 2026-09-11
`workflow_dispatch` (#1681) and a prior audit session's 2026-09-14 dispatch (#1682) are
both still `status: queued`, no runner ever allocated, reconfirmed this session. Did not
fire a third dispatch — two stuck dispatches already demonstrate the block. `refresh.yml`
has not run (scheduled or otherwise) since 2026-09-04 either. `deploy.yml` and `ci.yml`
have not run since 2026-09-02 (no merges since launch). This points at an account-level
Actions/billing block, not a repo workflow-file issue.

## 3. Web

`brownsync.pages.dev` → `200`, unchanged, static asset serving is unaffected.

## 4. Backlog

29 open PRs (#11-#39) before this one, all drafts, zero merged in 40 days since launch
(2026-08-08). #33-#39 each reached this identical diagnosis on seven consecutive prior
days with no owner reply beyond automated bot activity.

## No code fix opened

Same conclusion as #33-#39: a paused/reconfigured Supabase project and a GitHub Actions
account-level block both need owner dashboard access, not a patch. Filing another
near-duplicate PR body has not moved this in a week; this report exists to keep the daily
record honest, not because a ninth PR is expected to succeed where eight didn't.

## Owner action needed (blocking everything else) — unresolved 7 days running

1. Supabase dashboard → project `hkrxahzdqqxxovvilalm` — confirm not paused; if the
   reference changed, update the `DATABASE_URL` secret + Hyperdrive connection string,
   redeploy.
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions → General —
   likelier quick fix given two independent stuck-`queued` runs spanning 6+ days.
3. Confirm via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health`
   returning `200` with a populated `sources` array.

## Single most important next action

Same as every report since #33, now day 13: open the Supabase and GitHub Actions/Billing
dashboards. No further automated diagnosis will change this outcome.
