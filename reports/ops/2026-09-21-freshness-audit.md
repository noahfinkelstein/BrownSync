# BrownSync daily freshness audit — 2026-09-21

## Overall verdict: RED — day 17 of total outage, zero owner action across twelve consecutive daily reports

## 1. API — still a total outage

Verified 2026-09-21:

```
$ curl -sS https://brownsync-api.noahfinkelstein.workers.dev/api/health
{"error":{"code":"internal","message":"Unexpected server error."}}   # 500

$ curl -sS https://brownsync-api.noahfinkelstein.workers.dev/api/now
{"error":{"code":"internal","message":"Unexpected server error."}}   # 500

$ curl -sS "https://brownsync-api.noahfinkelstein.workers.dev/api/events?from=2026-09-21T00:00:00Z&to=2026-09-28T00:00:00Z"
{"error":{"code":"internal","message":"Unexpected server error."}}   # 500

$ curl -sS https://brownsync-api.noahfinkelstein.workers.dev/api/articles
{"error":{"code":"internal","message":"Unexpected server error."}}   # 500

$ curl -sS -o /dev/null -w '%{http_code}' https://brownsync-api.noahfinkelstein.workers.dev/api/openapi.json
200
```

Every DB-backed route (`health`, `now`, `events`, `articles`) returns the identical generic
`500 {"error":{"code":"internal","message":"Unexpected server error."}}`, unchanged since
#33 (2026-09-10). `/api/openapi.json`, which touches no DB, still returns `200` — the Worker
itself is up; the break is specifically the Postgres/Hyperdrive path.

Root cause (established #39, reconfirmed every day since including today, unchanged):
Supabase's pooler rejects the project reference (`postgres.hkrxahzdqqxxovvilalm`) documented
in `DEPLOY.md` — the standard error shape for a paused/deleted/reconfigured Supabase project.
Not diagnosable further from the repo without dashboard access; `apps/api/src/errors.ts`'s
`isDbUnavailable()` only recognizes network-level failures (ECONNREFUSED/ETIMEDOUT/etc. and
the literal workerd message `"connection attempt failed"`) as 503-worthy — a Supabase-paused
rejection apparently doesn't match any of those, so it falls through to the generic 500. That
classification gap is real but cosmetic (503 vs 500 either way means "the app is down"); the
actual fix is resuming/reconfiguring the Supabase project, not a code patch.

## 2. GitHub Actions — still dead since Sept 4

- `poll.yml`: last **completed** run was 2026-09-04 (run #1679/#1680, schedule-triggered).
  Two manual `workflow_dispatch` runs since (#1681 on 2026-09-11, #1682 on 2026-09-14) are
  both still `status: queued` — reconfirmed today, 10 and 7 days after they were fired, no
  runner ever allocated. No new dispatch or scheduled run has landed since #1682 (7 more days
  of silence).
- `refresh.yml`: last run was also 2026-09-04 (#32, failure); nothing since — 17 days.
- `deploy.yml` / `ci.yml`: last run 2026-08-08 / 2026-09-02 respectively — no merges since
  launch (the 33+ open audit/fix PRs are all still open, draft, unmerged).

Two independent workflows stuck in `queued` for 7-10+ days each points at an account-level
GitHub Actions block (billing/usage cap) rather than a per-workflow or repo-config issue.

## 3. Web

`brownsync.pages.dev` → `200`, unchanged. (The static shell loads; without a working API it
cannot show live data — same story as every day this outage has run.)

## 4. Backlog

33 open PRs (#11-#43) before this one, all drafts, zero merged in 44 days since launch.
#33-#43 each independently reached the identical diagnosis on eleven consecutive prior days
with no reply beyond automated CodeRabbit bot activity.

## No code fix opened

Same conclusion as #33-#43: a paused/reconfigured Supabase project and a GitHub Actions
account-level block both need owner dashboard access, not a patch. There is nothing in this
repository that can resume a paused Supabase project or lift a GitHub Actions billing/usage
block.

## Owner action needed (blocking everything else) — unresolved 11 days running

1. Supabase dashboard → project `hkrxahzdqqxxovvilalm` — confirm it is not paused; if the
   reference changed, update the `DATABASE_URL` secret + Hyperdrive connection string, then
   redeploy.
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions → General — likelier
   the quick fix, given two independent stuck-`queued` runs spanning 7-10 days.
3. Confirm via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health` returning
   `200` with a populated `sources` array.

## Single most important next action

Same as every report since #33, now day 17: open the Supabase and GitHub Actions/Billing
dashboards. No further daily audit will surface new information until one of those two
things changes.
