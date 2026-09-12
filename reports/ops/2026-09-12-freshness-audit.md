# Daily freshness audit — 2026-09-12

## Summary

The total API outage first reported in #33 (2026-09-10) and re-confirmed in
#34 (2026-09-11) is **still ongoing** — day 9 since it started (`poll.yml`
run #1680, 2026-09-04T14:34:37Z), day 3 since it was first documented, with
no visible owner action on #33/#34 yet.

## Step 1 — audit

### `/api/health` and every DB-backed route

Re-verified at 2026-09-12T12:05:44Z:

```
$ curl -i https://brownsync-api.noahfinkelstein.workers.dev/api/health
HTTP/2 500
{"error":{"code":"internal","message":"Unexpected server error."}}
```

Same result, repeated, for `/api/events`, `/api/places`, `/api/orgs`,
`/api/articles`, and `/api/now` — every DB-backed route still 500s
identically. Per-source health table cannot be produced (the endpoint that
serves it is itself down).

### Web

`https://brownsync.pages.dev` → `200`, unchanged. The Worker itself is up
(a DB-backed route 500s rather than 404ing), only Postgres access is down.

### `/api/events` upcoming window

Unreachable — same 500 as above. During term time this would otherwise be
AMBER-at-minimum on an empty window; today it cannot even be evaluated, so
it rolls into the RED verdict below rather than being scored separately.

### Workflow health

- **Poll**: last successful scheduled run was #1679 (2026-09-04T13:05Z).
  Run #1680 (2026-09-04T14:34:37Z) failed with the same root cause as
  before (see below) and **no scheduled run has fired since** — 8 days
  silent on a workflow still `state: active`. The manual
  `workflow_dispatch` from #34 (run #1681, created 2026-09-11T12:26:26Z)
  is **still `status: queued`** more than 24h later — it has not actually
  started, on top of the DB itself still being down.
- **Refresh data artifacts**: still failing on every scheduled run (last
  checked run #32, 2026-09-04, `conclusion: failure`) — unchanged,
  pre-existing, and secondary to today's outage.
- **CI**: last run was for PR #34 (2026-09-11), green — CI itself is
  healthy, it just isn't merging anything (see below).
- **Deploy**: last run was 2026-08-08 (run #27, the launch commit) — no
  deploy in 35 days. Not itself a problem (nothing to deploy while the
  outage's fix is owner-side), but confirms this outage is **not** caused
  by a recent code change — there hasn't been one.
- Repo's last push to `main` was 2026-08-08. GitHub disables scheduled
  workflows after 60 days of repository inactivity; at 35 days we are not
  there yet, but the clock is real — if this drags on, `poll.yml` and
  `refresh.yml`'s crons will eventually stop being GitHub's fault too.

### Open PR backlog

24 open PRs (#11–#34), **zero merged since 2026-08-08** (35 days). Up from
23 at #34, 20 at #31/#32. This is a compounding, separate risk from
today's outage: #21 and #25 remain zero-risk, ready, unmerged fixes for
the (lower-severity, AMBER) `refresh.yml`/seed-lane issues from before the
outage began.

## Step 2 — root cause (unchanged from #33/#34)

`poll.yml` run #1680's own log is the only place the underlying error is
visible (the Worker's health/route handlers collapse it to a generic 500):

```
[dedup] error: (ENOTFOUND) tenant/user postgres.hkrxahzdqqxxovvilalm not found
```

This is Supabase's Supavisor/PgBouncer connection pooler rejecting the
connection because it no longer recognizes that project reference — the
signature of a **paused, deleted, or reconfigured Supabase project**, not
an application bug. The Worker's Hyperdrive binding points at the same
project ref, so every DB-backed route 500s identically, and nothing in
`apps/api`, `services/poller`, `packages/sources`, or `ingest/` can route
around a pooler that has stopped recognizing the tenant.

## No code fix opened

Same conclusion as #33 and #34, re-verified rather than assumed: there is
no source-controlled fix for a Supabase project the pooler no longer
recognizes. `supabase db push`, rotating credentials, and `wrangler
deploy` are all owner-approved prod steps and were not run.

## Single most important next action

**Unchanged from #33/#34, now day 9 down / day 3 unactioned:** check the
Supabase dashboard for project `hkrxahzdqqxxovvilalm` — unpause it if
paused (inactivity or billing is the likely cause given the 35-day quiet
repo), or update `DATABASE_URL` (GitHub Actions secret) and the Hyperdrive
connection string (`apps/api/wrangler.toml`) if the project reference
changed, then redeploy the Worker. Confirm with
`curl https://brownsync-api.noahfinkelstein.workers.dev/api/health`
returning `200` with a populated `sources` array.

Secondary, much lower urgency: 24 open PRs with zero merges in 35 days,
including two (#21, #25) that are ready, zero-risk fixes sitting idle.

## Overall verdict: RED

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MZnUnY6D962ckna2m31DLs
