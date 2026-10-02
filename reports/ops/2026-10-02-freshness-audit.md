# Daily freshness audit — 2026-10-02

**Verdict: RED — day 29 of total production outage, unactioned since #33 (2026-09-10)**

## 1. Source health

`GET /api/health` returns `500 {"error":{"code":"internal","message":"Unexpected server error."}}`,
reproduced three times across this session. No per-source table is obtainable — the health
endpoint is one of the routes broken by the outage, same as every other DB-backed route. This is
the finding, not a gap in the audit.

Also 500, same envelope: `GET /api/events` (both plain and with explicit ISO-8601 `from`/`to`).

Confirms the break is DB-specific, not the Worker — consistent with every prior audit since #33:
- The 500 body is the generic `internal` envelope, not the `db_unavailable` envelope that
  `apps/api/src/app.ts`'s `onError` handler returns for recognized connection-refused/timeout
  errors (see `apps/api/src/errors.ts`) — the underlying error is still not one of the matched
  shapes, exactly as every prior audit has also observed.

## 2. Web

`GET https://brownsync.pages.dev` → `200`. Static shell only — with the API down there is no
live data behind it.

## 3. Upcoming events (2026-10-02 → 2026-10-09)

Not obtainable — `/api/events` 500s, per above. During term time this would independently be
AMBER at minimum; it's moot here since the whole API is down.

## 4. Root causes (established #39, reconfirmed every audit since 2026-09-10, unchanged today)

1. **Supabase pooler rejects the project reference** (`postgres.hkrxahzdqqxxovvilalm`, per
   `DEPLOY.md`) — the standard shape for a paused/deleted/reconfigured Supabase project. Needs
   owner dashboard access; this sandbox has no outbound access to `*.supabase.co` to re-probe
   directly (confirmed again this session — `CONNECT tunnel failed` via the sandbox's own egress
   proxy, consistent with the environment's network policy rather than new information about
   Supabase itself), and no DB credentials to fix it even if it did.
2. **GitHub Actions is stalled at the account level.** `poll.yml` has not completed a run since
   2026-09-04 (28 days). The same two `workflow_dispatch` attempts from #1681 (2026-09-11) and
   #1682 (2026-09-14) are *still* `status: queued` today — with zero jobs ever created for either
   run (`list_workflow_jobs` returns `total_count: 0`) — 21 and 18 days later respectively,
   unchanged since the last several audits. `refresh.yml` last ran (and failed) 2026-09-04;
   `ci.yml` last ran 2026-09-02; `deploy.yml` last ran 2026-08-08 (launch). All workflows report
   `state: active` in the Actions API — this is not the 60-day cron auto-disable (the repo is at
   55 days since its last push, not yet 60) — the zero-jobs-ever-allocated signature on queued
   runs points at an account-level Actions billing/usage block, not a workflow config issue.
3. **No commits to `main` since 2026-08-08** (55 days) and **39 open PRs, zero merged since
   launch**, including 18 prior daily-audit reports (#33–#50) all reporting this same outage with
   an escalating day count. Nothing in the backlog has been actioned.

No code fix opened today — same conclusion as #33 through #50: neither root cause is fixable
from the repo. Re-running the same curl/API checks that eighteen consecutive prior sessions have
already run, with identical results, does not change that.

## Owner action needed (unresolved 22 days running as of the last audit; 29 days since outage start)

1. **Supabase dashboard** → project `hkrxahzdqqxxovvilalm`: confirm it isn't paused; if the
   reference changed, update `DATABASE_URL`/Hyperdrive and redeploy the Worker.
2. **GitHub → Settings → Billing → Plans and usage**, and **Settings → Actions → General**:
   clear whatever is blocking runner allocation (the two stuck `queued` runs with zero jobs
   allocated are the clearest symptom).
3. **Clear the 39-PR backlog**: most are either audit reports or already-tested small fixes
   (seed-lane staleness thresholds, library-hours fixture pruning, the brown_news href-prefix
   drift) that have sat unreviewed for nearly two months.
4. Verify: `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health` returns `200`
   with a populated `sources` array, and the next scheduled Poll run completes (not `queued`).

Full history of this incident: #33 (2026-09-10) through #50 (2026-09-30), and
`reports/ops/2026-09-30-freshness-audit.md` (most recent prior report, currently unmerged on
`ops/freshness-audit-2026-09-30`).
