# BrownSync daily freshness audit — 2026-10-19

First audit run since launch (2026-08-08). No `reports/ops/` entry exists
between the launch report and this one, and no commit has landed on `main`
since `3cb7ca1` (2026-08-07) — 73 days of repo inactivity as of today. The
daily audit routine itself appears to have gone dormant alongside everything
else described below; this is a resumption, not a continuation.

## 1. API health (`/api/health`)

Could not be read. The endpoint itself is down:

```
$ curl -sS https://brownsync-api.noahfinkelstein.workers.dev/api/health
{"error":{"code":"internal","message":"Unexpected server error."}}
```

4/4 attempts over several seconds returned the same `500`. No per-source
table is available this run — see root cause below.

## 2. Is this just `/api/health`, or everything?

Everything backed by the database:

| route | result |
|---|---|
| `/api/health` | 500 `internal` |
| `/api/events` | 500 `internal` |
| `/api/articles` | 500 `internal` |
| `/api/meetings` | 500 `internal` |
| `/api/now` | 500 `internal` |
| `/api/openapi.json` (static, no DB call) | **200** |

The one route that never touches `Queries`/Hyperdrive is healthy; every
route that does is down the same way. That isolates the fault to the
Worker↔Supabase path (Hyperdrive → `postgresql://...pooler.supabase.com`,
per `DEPLOY.md` §"Database"), not to a specific handler, mapper, or recent
migration. `queries.health()`'s SQL (`select * from api_health()`,
migration `0006`) and `aggregateHealth()` (`apps/api/src/mappers.ts`) were
both read and look correct in isolation; `validated()` is a no-op in
production (`apps/api/src/app.ts:182`), so this is not a contract/schema
drift surfacing as a thrown validation error — the query itself is failing
before any mapping happens.

**Working hypothesis (not directly confirmable without Supabase dashboard
access): the project has auto-paused from inactivity.** Supabase pauses idle
free/low-tier projects, and nothing has written to this database in weeks —
see §4. A paused project breaks the Hyperdrive connection with exactly this
generic, non-descriptive `internal` error on every query.

## 3. Web app

`https://brownsync.pages.dev` → `200`. The static Pages shell still serves;
client-side data fetches against the API will fail the same way the curl
checks above do.

## 4. Upcoming events

Could not be checked — `/api/events` is down (§2). Independent of content,
the fact that the live-events endpoint is unreachable is itself the finding.

## 5. GitHub Actions — the 60-day-inactivity pattern

Last push to `main`: **2026-08-07** (`3cb7ca1`, the launch sign-off). That is
**73 days** before this run, past GitHub's 60-day no-activity threshold for
auto-disabling scheduled (`cron`) workflows.

| workflow | last 3 runs | notes |
|---|---|---|
| **Deploy** | #27 success 2026-08-08 (launch); #26, #25 same day | **no deploy in 73 days** — current prod is exactly the code verified at launch |
| **CI** | #72 success 2026-09-02; #71 2026-09-01; #70 2026-08-31 | ran only via PRs from prior daily-audit sessions; nothing since Sep 2 |
| **Refresh data artifacts** | #32 failure 2026-09-04; #31 failure 2026-09-03; #30 failure 2026-09-02 | failing every single run since inception (consistent with prior audits' finding of a pytest-gate issue, #21/#25 in earlier reports) — **and it stopped running at all after 2026-09-04**, 45 days of silence where even a failing scheduled run should appear |
| **Poll** | #1680 failure (`schedule`) 2026-09-04; #1681 `queued` since 2026-09-11; #1682 `queued` since 2026-09-14 | the two most recent entries are **manual `workflow_dispatch` runs stuck in `queued` for 5–6 weeks with zero jobs ever assigned** (`list_workflow_jobs` → `total_count: 0`) — the schedule has not fired successfully since Sep 4 |

Reading this together: the last *successful* scheduled Poll run was
2026-09-04, i.e. the database has very likely received no writes since that
date — over 6 weeks ago. That is well past the point a Supabase free-tier
project auto-pauses from inactivity, which lines up with §2's hypothesis.
The two queued-forever `workflow_dispatch` runs suggest manual attempts to
revive Poll were made (Sep 11, Sep 14) but never got a runner — consistent
with GitHub having already disabled the schedule/Actions capacity for this
repo under the inactivity policy, independent of the Supabase-side failure.

Two separate dormancy failures compounded: Actions stopped running the
pollers around the `main`-push-inactivity threshold, which stopped writes to
Supabase, which (on the current hypothesis) caused Supabase to pause the
project, which now breaks every live read too.

## 6. What was fixed

**Nothing in code.** Every symptom here traces to infrastructure dormancy,
not a defect in `services/poller`, `packages/sources`, `apps/api/src/schedule*`,
`ingest/`, or a migration. There is no code path in this repo that can
resume a paused Supabase project, re-enable a GitHub-inactivity-disabled
schedule, or push a commit on the owner's behalf to reset that clock — these
are exactly the "needs credentials or human action" cases STEP 2 asks to
describe rather than force. No migration, test, or workflow file was
touched; nothing was pushed to `main`; `wrangler deploy` and
`supabase db push` were not run.

## 7. What the owner needs to do (precise, in order)

1. **Resume the Supabase project** — dashboard →
   `https://supabase.com/dashboard/project/hkrxahzdqqxxovvilalm` → if it
   shows paused, click resume. This is a one-click dashboard action; nothing
   in this session can do it without owner credentials.
2. **Confirm the Worker recovers** — re-curl
   `https://brownsync-api.noahfinkelstein.workers.dev/api/health` after step 1;
   expect `200` within a minute or two of the project coming back online.
3. **Check whether GitHub re-enabled the Poll/Refresh/CI schedules on their
   own** — repo → Actions → each workflow's page shows a banner if GitHub
   force-disabled it for inactivity, with its own re-enable button. If
   present, click it on `poll.yml` and `refresh.yml` at minimum.
4. **Land a commit on `main`** (this PR, once merged, is exactly that) to
   reset the 60-day inactivity clock so this doesn't recur silently again.
5. **Manually dispatch `Poll`** once 1–3 are done, to get `livewhale` et al.
   off `never`/stale immediately rather than waiting for the next `*/15`
   tick.
6. Separately, the **pre-existing `Refresh data artifacts` failure**
   (failing on every run since 2026-08-08 per prior audits, #21/#25) is
   still unresolved under all of the above and worth another look once the
   DB is back — it is a real, standing defect independent of this outage.

## 8. Overall verdict

**RED.** Every database-backed API route is down (`500`), the scheduled
data pipeline has not run successfully in 6+ weeks, and no deploy has
shipped in 73 days. Single most important next action: **resume the
Supabase project** (§7.1) — everything else cascades from the database
being unreachable.
