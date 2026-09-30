# Daily freshness audit — 2026-09-30

**Verdict: RED — day 27 of total production outage, unactioned since #33 (2026-09-10)**

## 1. Source health

`GET /api/health` itself returns `500 {"error":{"code":"internal","message":"Unexpected server error."}}`.
No per-source table is obtainable — the health endpoint is one of the routes broken by the
outage, same as every other DB-backed route. This is the finding, not a gap in the audit.

Also 500, same envelope: `/api/now`, `/api/events`, `/api/orgs`, `/api/places` (spot-checked;
`/api/articles` not separately re-checked but shares the same DB path).

Confirms the break is DB-specific, not the Worker:
- `GET /api/openapi.json` (no DB touch) → `200`.
- `GET /api/events?from=notadate` (validation runs before the DB call) → clean `400 bad_request`.

## 2. Web

`GET https://brownsync.pages.dev` → `200`. Static shell only — with the API down there is no
live data behind it.

## 3. Upcoming events (2026-09-30 → 2026-10-07)

Not obtainable — `/api/events` 500s, per above. During term time this would independently be
AMBER at minimum; it's moot here since the whole API is down.

## 4. Root causes (established #39, reconfirmed every audit since, unchanged today)

1. **Supabase pooler rejects the project reference** (`postgres.hkrxahzdqqxxovvilalm`, per
   `DEPLOY.md`) — the standard shape for a paused/deleted/reconfigured Supabase project. Needs
   owner dashboard access; this sandbox has no outbound access to `*.supabase.co` to re-probe
   directly, and no DB credentials to fix it even if it did.
2. **GitHub Actions is stalled at the account level.** `poll.yml` has not completed a run since
   2026-09-04 (26 days). The same two `workflow_dispatch` attempts from #1681 (2026-09-11) and
   #1682 (2026-09-14) are *still* `status: queued` today — 19 and 16 days later, respectively,
   with no runner ever allocated, unchanged since the last several audits. `refresh.yml` last ran
   (and failed) 2026-09-04; `ci.yml` last ran 2026-09-02. All four workflows (`Poll`, `Refresh
   data artifacts`, `CI`, `Deploy`) show `state: active` in the Actions API — this is not the
   60-day cron auto-disable — so the stall points at an account-level Actions billing/usage block,
   not a workflow config issue.
3. **No commits to `main` since 2026-08-07** (54 days) and **38 open PRs, zero merged since
   launch**, including 17+ prior daily-audit reports (#33–#49) all reporting this same outage
   with an escalating day count. Nothing in the backlog has been actioned.

No code fix opened today — same conclusion as #33 through #49: neither root cause is fixable
from the repo. Re-attempting the same curl/API checks that seventeen consecutive prior sessions
have already run, with identical results, does not change that.

## Owner action needed (unresolved 20 days running as of the last audit; 27 days since outage start)

1. **Supabase dashboard** → project `hkrxahzdqqxxovvilalm`: confirm it isn't paused; if the
   reference changed, update `DATABASE_URL`/Hyperdrive and redeploy the Worker.
2. **GitHub → Settings → Billing → Plans and usage**, and **Settings → Actions → General**:
   clear whatever is blocking runner allocation (the two stuck `queued` runs are the clearest
   symptom).
3. **Clear the 38-PR backlog**: most are either audit reports or already-tested small fixes
   (seed-lane staleness thresholds, library-hours fixture pruning, the brown_news href-prefix
   drift) that have sat unreviewed for weeks.
4. Verify: `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health` returns `200`
   with a populated `sources` array, and the next scheduled Poll run completes (not `queued`).

Full history of this incident: #33 (2026-09-10) through #49 (2026-09-26), and
`reports/ops/2026-09-26-freshness-audit.md` (most recent prior report, currently unmerged on
`ops/freshness-audit-2026-09-26`).
