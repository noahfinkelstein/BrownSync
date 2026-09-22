# BrownSync daily freshness audit — 2026-09-22

## Overall verdict: RED — day 18 of total outage, zero owner action across thirteen consecutive daily reports

## 1. API — still a total outage

Verified 2026-09-22:

```
$ curl -sS https://brownsync-api.noahfinkelstein.workers.dev/api/health
{"error":{"code":"internal","message":"Unexpected server error."}}   # 500

$ curl -sS https://brownsync-api.noahfinkelstein.workers.dev/api/now
{"error":{"code":"internal","message":"Unexpected server error."}}   # 500

$ curl -sS "https://brownsync-api.noahfinkelstein.workers.dev/api/events?from=2026-09-22T00:00:00Z&to=2026-09-29T00:00:00Z"
{"error":{"code":"internal","message":"Unexpected server error."}}   # 500

$ curl -sS "https://brownsync-api.noahfinkelstein.workers.dev/api/articles?from=2026-09-01T00:00:00Z&to=2026-09-30T00:00:00Z"
{"error":{"code":"internal","message":"Unexpected server error."}}   # 500

$ curl -sS https://brownsync-api.noahfinkelstein.workers.dev/api/places
{"error":{"code":"internal","message":"Unexpected server error."}}   # 500

$ curl -sS https://brownsync-api.noahfinkelstein.workers.dev/api/orgs
{"error":{"code":"internal","message":"Unexpected server error."}}   # 500

$ curl -sS https://brownsync-api.noahfinkelstein.workers.dev/api/meetings
{"error":{"code":"internal","message":"Unexpected server error."}}   # 500

$ curl -sS -o /dev/null -w '%{http_code}' https://brownsync-api.noahfinkelstein.workers.dev/api/openapi.json
200
```

Every DB-backed route returns the identical generic `500 {"error":{"code":"internal",
"message":"Unexpected server error."}}`, unchanged since #33 (2026-09-10).
`/api/openapi.json` (no DB touch) still returns `200` — the Worker itself is up; the break
is specifically the Postgres/Hyperdrive path. `/api/health` cannot be used to produce a
per-source table today (it is one of the routes that 500s), so no source-level status is
obtainable this cycle — same as every day since #33.

Root cause (established #39, reconfirmed every day since, unchanged): Supabase's pooler
rejects the project reference (`postgres.hkrxahzdqqxxovvilalm`) documented in `DEPLOY.md` —
the standard error shape for a paused/deleted/reconfigured Supabase project. Not diagnosable
further from the repo without dashboard access; `apps/api/src/errors.ts`'s `isDbUnavailable()`
only recognizes network-level failures as 503-worthy, so this falls through to a generic 500
(cosmetic gap, not the actual fix). The actual fix is resuming/reconfiguring the Supabase
project, which needs owner dashboard access this session does not have and must not attempt
to route around.

## 2. GitHub Actions — still dead since Sept 4

- `poll.yml`: last **completed** run remains #1680 (2026-09-04, scheduled, failure) /
  #1679 (2026-09-04, scheduled, success). The two manual `workflow_dispatch` runs (#1681,
  2026-09-11; #1682, 2026-09-14) are still `status: queued` today — 11 and 8 days after
  they were fired, no runner ever allocated. No new run of any kind since #1682 (8 more days
  of silence).
- `refresh.yml`: last run remains #32 (2026-09-04, failure) — 18 days silent.
- `ci.yml`: last run remains #72 (2026-09-02, on PR #32). `deploy.yml`: last run remains #27
  (2026-08-08, the launch-sign-off push). No merge to `main` since launch.

Two independent workflows stuck in `queued` for 8-11+ days, with zero scheduled or dispatched
runs of any workflow landing since 2026-09-14, continues to point at an account-level GitHub
Actions block (billing/usage cap) rather than a per-workflow or repo-config issue.

## 3. Web

`brownsync.pages.dev` → `200`, unchanged. Static shell loads; without a working API it cannot
show live data — same story as every day this outage has run.

## 4. Backlog

34 open PRs (#11-#44) before this one, all drafts, zero merged in 45 days since launch.
#33-#44 (twelve reports) each independently reached the identical diagnosis with no reply
beyond automated bot activity.

## No code fix opened

Same conclusion as #33-#44: a paused/reconfigured Supabase project and a GitHub Actions
account-level block both need owner dashboard access, not a patch. There is nothing in this
repository that can resume a paused Supabase project or lift a GitHub Actions billing/usage
block, and no repo-side workaround (retry logic, alternate connection string, etc.) would be
appropriate to attempt against a possibly-paused/deleted prod database.

## Owner action needed (blocking everything else) — unresolved 12 days running

1. Supabase dashboard → project `hkrxahzdqqxxovvilalm` — confirm it is not paused; if the
   reference changed, update the `DATABASE_URL` secret + Hyperdrive connection string, then
   redeploy.
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions → General — likelier
   the quick fix, given multiple independent stuck-`queued` runs spanning 8-11+ days and zero
   workflow activity of any kind in the last 8 days.
3. Confirm via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health` returning
   `200` with a populated `sources` array.

## Single most important next action

Same as every report since #33, now day 18: open the Supabase and GitHub Actions/Billing
dashboards. No further daily audit will surface new information until one of those two things
changes — this session is not filing a new distinct defect, only reconfirming the standing one
to keep the record current.
