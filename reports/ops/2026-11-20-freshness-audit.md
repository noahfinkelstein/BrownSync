# BrownSync daily freshness audit — 2026-11-20

## Overall verdict: 🔴 RED

Day 77 of the total production outage first reported in #33
(2026-09-10) and reconfirmed in every daily audit since
(#38–#68). No change since yesterday's report (#68,
2026-11-19): the API is still down, the database is still
unreachable, and GitHub Actions still appears unable to execute
runs for this repository. Two code fixes that make the API report
this correctly (`503 db_unavailable` instead of a bare `500`) have
been open and mergeable since 2026-10-15 (#58) and 2026-11-02
(#62) — neither has been merged. No new code fix is opened by this
session; see "What was fixed" below for why.

## Per-source health

`GET /api/health` still returns `500 {"code":"internal"}` on every
request (confirmed with 3 repeated calls, consistent latency
~2.7s, not a timeout). No per-source table is obtainable.

| source | status | age vs threshold | verdict |
|---|---|---|---|
| (all enabled sources) | unknown — `/api/health` 500s | DB unreachable since 2026-09-04 (77d) | **ERROR** |
| bdh, providence_gov, today_brown, feed_rank | n/a | disabled by design | paused by design |

## Web check

`https://brownsync.pages.dev` → `HTTP 200`. Static frontend still
up; it still calls a dead API.

## Data currency

`GET /api/events` for `[2026-11-20, 2026-11-27]` → `500
{"code":"internal"}` (same DB failure, both ISO-date and full
ISO-datetime query params tried). Treated as **RED**, not an
empty-window AMBER, since the route errors rather than returning
rows.

## Workflow health

- **Poll** — no `schedule` run since 2026-09-04 (run #1680, the
  `ENOTFOUND tenant/user ... not found` failure). The two
  `workflow_dispatch` runs from 2026-09-11 and 2026-09-14 are still
  sitting in `queued`, now ~67–70 days old, `updated_at ==
  created_at` (never picked up by a runner).
- **Refresh data artifacts** — unchanged, last run 2026-09-04,
  `failure` (pre-existing Python fixture/test drift, independent of
  the DB outage; see #58/#68 history).
- **CI** — unchanged, last run is #72 (2026-09-02, success). PRs
  opened since then (#33 through this one) have triggered **zero**
  check runs — confirmed again today opening this PR triggers
  nothing, same as #68 observed yesterday.
- **Deploy** — unchanged, last run 2026-08-08 (launch commit). No
  commits have landed on `main` since, so nothing to deploy.
- All six workflows still report `state: active` via the Actions
  API — not `disabled_inactivity` — which continues to point at
  GitHub Actions execution itself being blocked for this repo
  (billing/spending-limit most likely), not merely the 60-day cron
  auto-disable. The cron auto-disable threshold is also independently
  true here (77 days since last repo activity > 60), but it does not
  explain the `pull_request`-triggered CI runs failing to start.

## Root cause (unchanged from #33 / #68)

Supabase project `hkrxahzdqqxxovvilalm` has been unreachable since
2026-09-04T14:34 UTC (`(ENOTFOUND) tenant/user
postgres.hkrxahzdqqxxovvilalm not found` — the Supavisor pooler's
rejection for a paused/deleted project). This breaks the poller's
write path, the Worker API's read path, and `source_runs` logging,
since all three share the same backing project. Every route fails
identically including `/api/health`, which rules out a schema/RLS
regression.

## What was fixed

Nothing new in code. #58 (2026-10-15) and #62 (2026-11-02) already
contain the correct, tested, mergeable fix (classify the Supavisor
"tenant or user not found" message as `db_unavailable` so the API
returns `503` instead of a bare `500`) — they are near-duplicates of
each other, both still open and unmerged. Opening a third copy of
the same one-line fix would add noise, not value; the owner should
merge whichever of #58/#62 is preferred and close the other. Neither
fix changes the outage itself — the database still needs to be
restored regardless of which is merged.

## What needs the owner (unchanged — still the blocking list)

1. **Un-pause / restore Supabase project `hkrxahzdqqxxovvilalm`**, or
   reissue `DATABASE_URL` / the Worker's Hyperdrive binding for a
   replacement project and re-run migrations 0001–0023 against it.
   Nothing else matters until the DB answers.
2. **Check GitHub Actions billing/spending-limit state** (Settings →
   Billing → Actions; Settings → Actions → General) — `pull_request`
   runs are not starting at all, which the cron rule alone doesn't
   explain.
3. Cancel the two stuck `workflow_dispatch` **Poll** runs
   (34843581523, 34598916701) — queued ~67–70 days, doing nothing.
4. Merge #58 or #62 (not both) once Actions can run CI again.
5. Once the DB is back, re-run **Refresh data artifacts** and address
   its pre-existing Python fixture/test drift (unrelated to this
   outage).

## Single most important next action

**Resume/restore the Supabase project (`hkrxahzdqqxxovvilalm`)
backing BrownSync.** This is day 77 with every data route down and
the entire poller lane dark; nothing else here can be verified until
that happens.
