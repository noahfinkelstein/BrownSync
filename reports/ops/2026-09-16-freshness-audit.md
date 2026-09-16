# BrownSync daily freshness audit — 2026-09-16

## Overall verdict: RED — day 12 of total outage, zero owner action across seven consecutive daily reports (#33–#38)

Docs-only — no code changed. Root cause is infrastructure state (Supabase
project unreachable at the pooler; likely GitHub account-level Actions
block), not application code; nothing in this repo can fix either without
owner-held dashboard/billing access, per the standing rule against
speculative fixes and touching prod.

## 1. API — still a total outage

Re-verified at 2026-09-16T12:19Z:

| check | result |
|---|---|
| `GET /api/health` | `500 {"error":{"code":"internal","message":"Unexpected server error."}}` |
| `GET /api/events?start=…&end=…` | same `500 internal` |
| `GET /api/openapi.json` (static, no DB) | `200` |
| `GET /api/nonexistent-route` (no DB) | `404 not_found` |
| `GET /api/events?from=not-a-date` (validation only, no DB) | `400 bad_request` — router/validation layer is fine |
| 3x retry on `/api/health` | `500, 500, 500` — consistent, not a blip |

Same signature reported every day since #33 (2026-09-10): every DB-backed
route 500s identically; everything upstream of the Postgres/Hyperdrive call
works. No per-source staleness table could be pulled this run because
`/api/health` is itself down. `/api/events` upcoming-window count is
likewise unreachable.

Root cause (unchanged, from Poll run #1680's log,
`services/poller/src/dedup/index.ts`'s dedup step, 2026-09-04T14:35:17Z):

```
[dedup] error: (ENOTFOUND) tenant/user postgres.hkrxahzdqqxxovvilalm not found
```

Fetched that job's raw log directly this session to confirm the exact text
(prior reports paraphrased it). This is Supabase's connection pooler
rejecting the connection because it no longer recognizes that project
reference — a paused, deleted, or reconfigured Supabase project — not an
application bug. `apps/api/wrangler.toml`'s `[[hyperdrive]]` binding and
every GitHub Actions job's `DATABASE_URL` secret point at the same project
(`hkrxahzdqqxxovvilalm`), so both the poller and the Worker fail the same
way. `apps/api/src/errors.ts`'s `isDbUnavailable()` doesn't classify
whatever shape this error takes once it passes through the Worker's
Hyperdrive binding (vs. the poller's direct connection), so the Worker
surfaces a generic `500` instead of `503` — a real classification gap, but
patching it without visibility into the actual Hyperdrive-wrapped error
shape would be guessing, and wouldn't fix the underlying outage. Flagging
rather than speculatively patching.

## 2. GitHub Actions — still dead since 2026-09-04, now with two stuck manual runs

- `poll.yml`: no completed run of any kind since #1680 (2026-09-04T14:34Z) — 12 days. Two independent `workflow_dispatch` attempts, from the owner (#1681, 2026-09-11) and from a prior audit session (#1682, 2026-09-14), are **both still `status: queued`** with no runner ever allocated (confirmed again this session). Two stuck dispatches five days apart rules out a one-off scheduling glitch and points at an account-level block (Actions minutes/spending limit, or Actions disabled for the account) rather than a repo setting. Did not fire a third dispatch — the existing two already establish the pattern.
- `refresh.yml`: last run #32, 2026-09-04, failure (pre-existing, unrelated pytest-gate issue, secondary to this outage).
- `ci.yml`: last run #72, 2026-09-02 (no PRs have needed a fresh run since; healthy when it last ran).
- `deploy.yml`: last run #27, 2026-08-08 — expected, no merges to `main` since launch.
- All workflows report `state: active` (not `disabled_inactive`) — repo activity (audit PR pushes through 2026-09-15) has kept the 60-day GitHub inactivity auto-disable from tripping. This is a distinct problem from that pattern.

## 3. Web

`brownsync.pages.dev` → `200`, unchanged. Static shell still serves; client-side API calls fail the same way as direct curl.

## 4. Backlog

29 open PRs (#11–#39 after this one), all still drafts, **zero merged in 39 days since launch**. #33 through #38 each reached this identical diagnosis on six consecutive prior days with no visible owner reply beyond automated bot comments. Two pre-outage, zero-risk fixes (#21, #25) have sat ready since 2026-08-19/23.

## No code fix opened

Consistent with #33–#38: `(ENOTFOUND) tenant/user … not found` is the
Supabase pooler refusing the connection before any BrownSync code runs.
There is no source-controlled fix for a paused/deleted/reconfigured
Supabase project or a GitHub Actions account-level block. Neither
`supabase db push` nor `wrangler deploy` was run (owner-approved prod
steps, and neither would fix a pooler-level rejection or an Actions
billing block anyway).

## Owner action needed (blocking everything else) — unresolved 6 days running

1. **Supabase dashboard → project `hkrxahzdqqxxovvilalm`** — confirm it isn't paused (free-tier inactivity or billing); if the project reference changed, update the `DATABASE_URL` GitHub Actions secret and the Hyperdrive connection string (`apps/api/wrangler.toml` step in `DEPLOY.md`), then redeploy the Worker.
2. **GitHub → Settings → Billing → Plans and usage** (Actions minutes/spending limit) and **Settings → Actions → General** for this account — the two independent stuck-`queued` manual runs make this the likelier quick fix of the two outages.
3. Once both are resolved, confirm with `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health` returning `200` with a populated `sources` array, and clear the 12-day-old `poll.yml`/`refresh.yml` staleness by re-running or waiting for the next scheduled tick.

## Single most important next action

**Same as every report since #33, now day 12:** open the Supabase and
GitHub Actions/Billing dashboards — this is the one blocker gating the
entire site, the daily audit routine, and the 29-PR backlog behind it.
