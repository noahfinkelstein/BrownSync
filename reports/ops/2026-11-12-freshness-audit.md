# BrownSync daily freshness audit — 2026-11-12

## Overall verdict: RED

Day 69 of the total production outage first reported in #33 (diagnosed as
starting 2026-09-04, first flagged 2026-09-10). No change since yesterday's
audit (#65, day 67).

## Per-source table

Unreachable — `/api/health` itself 500s, so no `sources` array is available.
Unchanged since 2026-09-10.

| source | status | age vs threshold | verdict |
|---|---|---|---|
| (all sources) | n/a | n/a | **ERROR** — health endpoint down |

## API / web checks

- `GET /api/health` → `HTTP 500 {"error":{"code":"internal","message":"Unexpected server error."}}` (repeated 3x, consistent).
- `GET /api/events?from=...&to=...` (today..+7d) → same `HTTP 500`.
- `GET https://brownsync.pages.dev` → `HTTP 200` (static shell only; no live data without a working API).
- Upcoming events (next 7 days): **unknown** — endpoint down.

## Root cause (unchanged, established in #39, reconfirmed daily since)

Supabase project `hkrxahzdqqxxovvilalm` is unreachable in a way consistent
with paused/deleted/reconfigured (Supavisor: "tenant or user not found").
This is a dashboard/credentials issue, not a code defect — no PR can fix a
paused or re-keyed Supabase project.

PR #62 (open, unmerged, duplicate of #58) already lands a tested fix for the
*symptom* (500 → 503 `db_unavailable` classification for this exact pooler
rejection) but explicitly does not fix the outage itself. No new code fix
opened today — same as the prior ~36 daily audits; neither root cause below
is fixable from the repo.

## Workflow health

- No workflow of any kind — scheduled or manually dispatched — has executed
  since **2026-09-14** (59 days). The two `workflow_dispatch` Poll attempts
  since (Sep 11, Sep 14) are still `status: queued`, `updated_at == created_at`,
  zero jobs ever allocated to a runner.
- Last commit to `main`: 2026-08-07 (97 days ago) — well past the ~60-day
  GitHub Actions cron-disable threshold for inactive repos; workflows still
  report `state: active`, so this looks more consistent with a GitHub
  Actions billing/spending-limit block than a disabled cron, but it cannot
  be confirmed from here (Settings → Billing is not API-visible to this
  session).
- Deploy: last successful run 2026-08-08 (launch). Nothing since — matches
  zero merges to `main` since launch.
- CI: last run triggered 2026-09-02 (PR #32). No run since — the daily audit
  branches/PRs (#33–#65) have accumulated without any CI execution for over
  two months, because nothing has triggered a runner at all.

## Open PR backlog

54 open PRs (#11–#65), unreviewed for up to ~3 months, including PR #62's
ready, tested symptom fix and PR #58 (its duplicate).

## Owner action needed (unresolved 69 days running)

1. Supabase dashboard → project `hkrxahzdqqxxovvilalm` — resume if paused;
   if the reference changed, update `DATABASE_URL`/Hyperdrive and redeploy.
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions →
   General — clear whatever is blocking every workflow trigger (59 days,
   zero jobs allocated).
3. Triage the 54-PR backlog (#11–#65) — includes PR #62's ready, tested
   symptom fix.
4. Confirm via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health`
   returning `200` with a populated `sources` array, and a completed
   (non-`queued`) Poll or CI run.

## Single most important next action

Resume/reconfigure the Supabase project `hkrxahzdqqxxovvilalm` — every other
symptom (API 500s, dark Actions, stale sources) cascades from the database
being unreachable.
