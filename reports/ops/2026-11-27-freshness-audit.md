# BrownSync daily freshness audit — 2026-11-27

## Overall verdict: RED

Day 84 of the total production outage first reported in PR #33 (2026-09-10,
diagnosed as starting 2026-09-04). No change since the last audit (#72,
2026-11-24) — note: no audit PR was filed for 2026-11-25 or 2026-11-26,
a two-day gap in the series (on top of the one-day gap before #72).

## 1. API health

`GET /api/health` → `500 {"error":{"code":"internal","message":"Unexpected
server error."}}`, confirmed on two separate attempts a few seconds apart
(not transient). `GET /api/events` for the next 7 days returns the
identical bare 500. `https://brownsync.pages.dev` → `200` (static
frontend is up; it is calling a dead API so it serves no live data, but
the Pages shell itself is healthy).

Per-source verdict table: **not obtainable** — `/api/health` itself is the
route that's down, so there is no `sources` array to read.

| source | status | age vs threshold | verdict |
|---|---|---|---|
| (all enabled sources) | unknown — health endpoint itself 500s | ≥84 days since last confirmed ok | ERROR |

Root cause (established #39, reconfirmed daily since, unchanged today):
Supabase project `hkrxahzdqqxxovvilalm` (confirmed in
`apps/api/wrangler.toml:43`, `SUPABASE_URL`) has been unreachable since
2026-09-04T14:34 UTC — the Poll workflow's last real run logged
`(ENOTFOUND) tenant/user postgres.hkrxahzdqqxxovvilalm not found`, the
Supavisor pooler signature for a paused/deleted/reconfigured project. Not
fixable from the repo; needs owner dashboard access.

Confirmed still true on main (`apps/api/src/errors.ts:47`,
`DB_UNAVAILABLE_MESSAGES = ["connection attempt failed"]`): the
`"tenant or user not found"` message is still **not** in the
`db_unavailable` classifier, so this condition still surfaces as a bare
500 instead of a 503. The fix (PR #58, duplicated in #62) remains open
and unmerged.

## 2. Data currency

`GET /api/events` for [today, today+7d] inherits the same 500 as
`/api/health`. Upcoming-events count: **not obtainable** — treated as RED
by inheritance from the DB outage, not a separate finding.

## 3. Workflow health

- **Poll**: last *scheduled* run was 2026-09-04 (run #1680, failure, the
  ENOTFOUND above). The two `workflow_dispatch` attempts since (runs
  34598916701 on 2026-09-11, 34843581523 on 2026-09-14) are still sitting
  in `status: queued` with zero jobs ever allocated, ~12 weeks now
  (`updated_at` still equals `created_at` on both).
- **Refresh data artifacts**: last run #32, 2026-09-04, `failure`. No run
  since.
- **CI**: last run #72, 2026-09-02. ~25 more `ops/freshness-audit-*` PRs
  opened since then (through #72 on 2026-11-24) have triggered no new CI
  run at all — consistent with prior audits' finding (#68) that
  `pull_request`-triggered Actions execution is blocked entirely for this
  repo, not just the cron schedules.
- **Deploy**: last run #27, 2026-08-08 (the launch commit). No deploys
  since — expected, since main hasn't moved since launch.
- All 6 workflows still report `state: active` in the Actions API (not
  `disabled_inactivity`), so this is **not** the standard 60-day
  cron-auto-disable pattern — it reads more like a GitHub Actions
  billing/spending-limit block or account-level suspension, which this
  session's access cannot confirm or clear.

## 4. Code review

No new code defect found. The known, tested fix for the 500→503
reclassification has existed since 2026-10-15 (#58) and was independently
re-derived on 2026-11-02 (#62) — both open, unmerged, near-duplicates of
each other. No third copy opened here. Both root causes (Supabase project
state, GitHub Actions execution/billing state) are infrastructure/account
issues outside what a commit in this repo can fix.

## Owner action needed (unresolved 84 days running)

1. **Supabase dashboard** → project `hkrxahzdqqxxovvilalm` — resume if
   paused; if the project reference changed, update `DATABASE_URL` /
   `SUPABASE_URL` and the Worker's Hyperdrive binding, then re-run
   migrations 0001–0023 against the restored/replacement project.
2. **GitHub → Settings → Billing → Plans and usage**, and
   **Settings → Actions → General** — clear whatever is blocking every
   workflow trigger (scheduled, manual, and `pull_request`).
3. **Cancel** the two permanently-queued Poll `workflow_dispatch` runs
   (34598916701, 34843581523) once Actions can execute again.
4. **Merge #58 or #62** (not both) once CI can run, close the other as a
   duplicate.
5. **Triage the PR backlog** (#11–#72+), unreviewed for up to 3.5 months.

## Single most important next action

Resume/reconfigure the Supabase project `hkrxahzdqqxxovvilalm` —
everything else (the API 500s, the stale data, the inability to verify
any source freshness) cascades from the database being unreachable.
