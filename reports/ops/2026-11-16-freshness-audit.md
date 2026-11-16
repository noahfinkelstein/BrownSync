# BrownSync daily freshness audit — 2026-11-16

## 1. Source health (`/api/health`)

Could not be read: the endpoint itself 500s. See §2.

| source | status | age vs threshold | verdict |
|---|---|---|---|
| (all sources) | n/a — `/api/health` returns 500 | n/a | **ERROR** (endpoint down) |

## 2. API / DB status

- `GET /api/health` → `500 {"error":{"code":"internal","message":"Unexpected server error."}}`
- `GET /api/now` → same 500
- `GET /api/articles` → `500`
- `GET /api/meetings` → `500`
- `GET /api/events?from=...&to=...` → same 500 (ISO datetimes, not just dates, are required — confirmed from `routes.ts`, this is expected input validation, not the bug)
- `GET /api/openapi.json` (static, no DB) → `200` — confirms the Worker is up; only the DB-backed routes are broken.

Root cause (established 2026-11-02 in PR #39, reconfirmed in every daily audit since, unchanged today): Supabase project `hkrxahzdqqxxovvilalm` is unreachable in a way consistent with paused/deleted/reconfigured (Supavisor rejects the pooler connection with "tenant or user not found"). This needs owner dashboard access, not a code patch. PR #62 (open, unmerged since 2026-11-02) already lands a tested fix for the *symptom* — reclassifying this exact Supavisor rejection as `503 db_unavailable` instead of a bare `500` — but it explicitly does not and cannot fix the outage itself.

This is **day 73** of the total production outage (diagnosed start 2026-09-04, first reported 2026-09-10 in PR #33). No change from yesterday's/last audit's state (PR #66, day 69, 2026-11-12).

## 3. Web check

`brownsync.pages.dev` → `200`. Static shell only — no live data is possible while the API's DB layer is down.

## 4. Upcoming events (2026-11-16 → 2026-11-23)

Could not be read — `/api/events` 500s (see §2). Not assessable this run.

## 5. GitHub Actions workflow health

- **Deploy**: last completed run `2026-08-08` (the launch commit, `3cb7ca1`). Nothing has merged to `main` since, so nothing has re-deployed.
- **Poll**: last *completed* run `2026-09-04` (failure — `ENOTFOUND tenant/user postgres.hkrxahzdqqxxovvilalm not found`, the same Supavisor rejection as §2). Two later `workflow_dispatch` attempts (2026-09-11, 2026-09-14) are still `status: queued`, never picked up by a runner — now 9–9.5 weeks stuck.
- **Refresh data artifacts**: last 3 runs (through 2026-09-04) all `failure` at the offline pytest step (pre-existing, tracked separately from the outage).
- **CI**: last run `2026-09-02` (success, on a freshness-audit PR). No CI has run since — consistent with no new PRs getting picked up by a runner either.
- All 6 workflows report `state: active` (not GitHub's 60-day-inactivity auto-disable — the repo's `pushed_at` stays recent from this audit-branch series). This reads as a billing/spending-limit block on Actions, not an inactivity disable. This session's GitHub access can't reach the billing API to confirm — unchanged from prior audits' finding.

## 6. Backlog

55 open PRs (#11–#66), unreviewed/unmerged for up to ~3 months, including PR #62's ready, tested `db_unavailable` symptom fix. This audit opens PR #67, bringing it to 56.

## What was fixed / filed this run

No new code fix: the root causes (Supabase project unreachable; GitHub Actions not picking up jobs) both need owner dashboard/billing access, not a repo change — same conclusion as every daily audit since 2026-09-10. Filing this report only (branch `ops/freshness-audit-2026-11-16`, PR #67).

## Owner action needed (unresolved 73 days running)

1. Supabase dashboard → project `hkrxahzdqqxxovvilalm` — resume if paused; if the reference changed, update `DATABASE_URL`/Hyperdrive and redeploy.
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions → General — clear whatever is blocking every workflow trigger (nothing has run, scheduled or dispatched, since 2026-09-14).
3. Merge PR #62 (tested, ready) and triage the rest of the 55-PR backlog.
4. Confirm via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health` returning `200` with a populated `sources` array, and a completed (non-`queued`) Poll or CI run.

## Overall verdict: RED

Single most important next action: resume/reconfigure the Supabase project `hkrxahzdqqxxovvilalm` — every downstream symptom (API 500s, stale sources, stalled Actions) cascades from the database being unreachable.
