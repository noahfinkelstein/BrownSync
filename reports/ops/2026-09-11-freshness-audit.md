# Freshness audit — 2026-09-11

## Overall verdict: RED

The total API outage first reported in #33 (2026-09-10) is **still ongoing**
as of this session. This is day 8 of the incident (root cause: `poll.yml`
run #1680, 2026-09-04T14:34:37Z) and day 2 since it was first documented.
No owner action is visible on #33 (one CodeRabbit bot comment only).

## Finding: total API outage — Supabase Postgres still unreachable

Re-verified at 2026-09-11T12:28:30Z: `/api/health`, `/api/events`,
`/api/places`, and `/api/now` all still return `HTTP 500` with
`{"error":{"code":"internal","message":"Unexpected server error."}}`.
`brownsync.pages.dev` still serves its static shell (`200`); an unknown API
route still 404s normally — so, as before, only DB-backed routes are down.

Root cause is unchanged from #33: `poll.yml` run #1680
(2026-09-04T14:34:37Z, the last Poll run of any kind until this session)
failed with

```
[dedup] error: (ENOTFOUND) tenant/user postgres.hkrxahzdqqxxovvilalm not found
```

— Supabase's Supavisor/PgBouncer pooler rejecting the connection because it
no longer recognizes that project reference (paused, deleted, or
reconfigured project), not an application bug. The Worker's Hyperdrive
binding (`apps/api/wrangler.toml`) points at the same project ref, so every
DB-backed route 500s identically.

## This session's action: manual `poll.yml` redispatch

To rule out "just a stuck cron" before re-confirming this is the DB itself,
this session ran `workflow_dispatch` on `poll.yml` (`source: all`) —
run #1681, https://github.com/noahfinkelstein/BrownSync/actions/runs/34598916701.
It was still `queued` (not yet started) as of report time; `/api/health`
was rechecked immediately before writing this report and is still `500`.
No `supabase db push`, credential rotation, or `wrangler deploy` was run —
those remain owner-approved steps outside this audit's authority, and
would not fix a pooler-level "tenant not found" rejection regardless.

## `poll.yml`'s scheduled crons remain silent

No scheduled (`schedule`-triggered) run has fired since #1680 on
2026-09-04 — an 8-day gap on a workflow GitHub still reports as
`state: active` (not the 60-day repo-inactivity auto-disable; last main
push was 2026-08-07, 35 days ago, under that threshold). This is a materially
worse version of the intermittent cron-stall pattern from #13/#28/#30, and
is secondary to the DB outage: even a healthy cron cannot succeed while
Supabase rejects every connection.

## No code fix opened

Same conclusion as #33: `ENOTFOUND tenant/user ... not found` is Supabase's
pooler refusing the connection before any BrownSync code runs. There is no
PR that can fix a paused, deleted, or reconfigured Supabase project — it is
reported precisely, again, rather than guessed at.

## Not re-checked in detail

Per-source health table, `/api/events` upcoming count, and the open-PR
backlog census (23 open PRs as of this session, up from 20 at #31/#32) are
unreachable or unchanged while the DB is down and are not this session's
most important finding.

## Single most important next action

**Unchanged from #33, now more urgent at 8 days down:** check the Supabase
dashboard for project `hkrxahzdqqxxovvilalm` — unpause it if paused
(inactivity or billing), or if the project reference changed, update the
`DATABASE_URL` GitHub Actions secret and the Hyperdrive connection string
(`apps/api/wrangler.toml`'s `[[hyperdrive]]` binding) to match, then
redeploy the Worker (owner-approved step). Confirm with
`curl https://brownsync-api.noahfinkelstein.workers.dev/api/health` —
it should return `200` with a `sources` array, not `500`.

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01WijvraTUmHKXqEA9aMPiHQ
