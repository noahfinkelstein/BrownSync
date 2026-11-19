# BrownSync daily freshness audit — 2026-11-19

## Overall verdict: 🔴 RED

The production API is down (500 on every data route) and has been
disconnected from its database since **2026-09-04**. The last 76 days of
"daily freshness audits" never ran — GitHub auto-disabled the cron
schedules after 60 days of repo inactivity, so the outage went unreported
until this run. No code fix applies; this needs owner action against
Supabase and GitHub Actions settings (see "What needs the owner" below).

## Per-source health

`GET /api/health` itself returns `500 {"code":"internal"}`, so no live
per-source table is available. Every other data route (`/api/now`,
`/api/events`, `/api/places`, `/api/articles`) returns the same 500. Root
cause (see below): the API's DB connection has been rejected by Supabase
since 2026-09-04T14:34 UTC with `(ENOTFOUND) tenant/user
postgres.hkrxahzdqqxxovvilalm not found` — the Supavisor pooler error for a
paused/unreachable project. Every source is therefore unverifiable via the
health endpoint and must be treated as **ERROR** until the DB is restored.

| source | status | age vs threshold | verdict |
|---|---|---|---|
| (all enabled sources) | unknown — `/api/health` 500s | DB unreachable since 2026-09-04 (76d) | **ERROR** |
| bdh, providence_gov, today_brown, feed_rank | n/a | disabled by design | paused by design |

## Web check

`https://brownsync.pages.dev` → `HTTP 200`. The static Pages frontend is
up, but it calls a dead API, so the live app is almost certainly showing
error states / stale cached data to users right now.

## Data currency

`GET /api/events` for the upcoming week → `500 {"code":"internal"}` (same
DB failure). Cannot confirm an upcoming-events count; treat as **RED**, not
merely an empty-window AMBER, since the route itself is erroring, not
returning zero rows.

## Workflow health (`gh run list`, last runs)

- **Poll** — last `schedule` success: 2026-09-04T13:05:13Z. Next scheduled
  run, 2026-09-04T14:34:37Z, failed with:
  `[dedup] error: (ENOTFOUND) tenant/user postgres.hkrxahzdqqxxovvilalm not found`
  — Supabase pooler rejecting the connection. No `schedule`-triggered run
  has fired since. Two later `workflow_dispatch` runs (2026-09-11,
  2026-09-14) have sat in `queued` for ~66–69 days and never started.
- **Refresh data artifacts** — last 5 runs (2026-08-31 → 2026-09-04) are
  all `failure`, from pre-existing Python fixture/test drift unrelated to
  the DB outage (`test_fixtures.py::test_every_stored_fixture_is_manifested`,
  stale `libraries/hours-grid-*.html` recordings, a publications-dedupe
  pinned-count drift). This was already broken before the cron stopped
  firing and needs its own follow-up once the DB is back.
- **CI** — last runs (through 2026-09-02) are all green; nothing has run
  since because no PRs have been opened against main since then.
- **Deploy** — last run 2026-08-08 (the launch commit); green. No deploys
  since because no commits have landed on main since launch.

**Pattern flagged: GitHub disables scheduled (`cron`) triggers for a
workflow after 60 days with no repository activity.** Last repo activity
was ~2026-09-04 (last Poll/CI runs); today is 2026-11-19 — a 75–76 day
gap, well past that threshold.

**Correction found while opening this report's own PR (#68):** this is
worse than a schedule-only disablement. `gh api
.../actions/workflows` reports all six workflows as `state: active` (not
`disabled_inactivity`), yet opening PR #68 against `main` triggered **zero**
check runs for CI — a `pull_request`-triggered workflow, not a `schedule`
one, so the 60-day cron rule doesn't explain it. Combined with the two
`workflow_dispatch` Poll runs still sitting in `queued` for 66–69 days
(never started, never timed out), the evidence points at **GitHub Actions
execution itself being blocked for this repo** (most consistent with an
exhausted included-minutes quota or a hit spending limit with no payment
method on file) rather than only the schedule trigger being switched off.
Re-enabling a workflow's schedule toggle will not fix this if Actions
can't run at all; the owner should check **Settings → Billing → Actions**
(or org billing, if this repo lives under one) and **Settings → Actions →
General** for a spending-limit or suspension notice before anything else
on the GitHub side.

## Root cause

Supabase project `hkrxahzdqqxxovvilalm` has been unreachable since
2026-09-04T14:34 UTC (`tenant/user ... not found` from the pooler — the
signature of a paused or deleted project, not a code defect). This breaks:
1. the TS poller lane's write path (`services/poller`, via `DATABASE_URL`),
2. the Worker API's read path (`apps/api`, same backing project),
3. `source_runs` writes, which is why even the *failure* couldn't be
   recorded (`[source_runs] could not record failure: ... not found`).

This is infrastructure state, not application code — db/migrations,
db/checks, and the RLS policy added in migration 0023 are not implicated;
every route fails identically (including `/api/health`, which doesn't
touch `articles` at all), which rules out a schema/RLS regression and
points at the connection itself.

## What was fixed

Nothing in code — there is no code defect to fix. No branch changes beyond
this report.

## What needs the owner

1. **Un-pause / restore Supabase project `hkrxahzdqqxxovvilalm`** (or, if
   it was intentionally torn down, reissue `DATABASE_URL` /
   `HYPERDRIVE`/Worker DB bindings for a replacement project and re-run
   migrations 0001–0023 against it). This is the blocking item — nothing
   else in this list matters until the DB answers.
2. **Check GitHub Actions billing/spending-limit state** (Settings →
   Billing → Actions, and Settings → Actions → General) — runs are queuing
   but not executing at all, including a brand-new `pull_request` CI run on
   PR #68, which the 60-day cron rule alone does not explain. Once Actions
   can run again, also re-enable the `schedule:` triggers on **Poll** and
   **Refresh data artifacts** if they show as disabled from inactivity
   (push any commit to main, or toggle under Actions → the workflow →
   ⋯ → Enable workflow).
3. Cancel the two stuck `workflow_dispatch` **Poll** runs
   (34843581523, 34598916701) sitting in `queued` for ~66–69 days; they
   are not doing anything and are just noise in the Actions list.
4. Once the DB is back, re-run **Refresh data artifacts** and fix the
   pre-existing Python test failures (stale `libraries/hours-grid-*.html`
   recorded fixtures, publications-dedupe pinned-count drift) — unrelated
   to this outage but blocking that workflow from going green again.
5. Re-run this audit once the DB is restored to get a real per-source
   table from `/api/health`.

## Single most important next action

**Resume/restore the Supabase project (`hkrxahzdqqxxovvilalm`) backing
BrownSync** — every data route and the entire poller lane has been down
for 76 days because of it, and nothing else on this list can be verified
until that's done.
