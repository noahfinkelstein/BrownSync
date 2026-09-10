# Freshness audit — 2026-09-10

**No daily audit session ran between 2026-09-03 and 2026-09-10** (last PR
before this one is #32, 2026-09-02). This session picks up an active
production outage that has been silent for six days.

## Overall verdict: RED

Every DB-backed API route is down. This is **not** the standing AMBER
review-backlog risk from #30/#31/#32 — it is a new, more severe, ongoing
incident.

## Finding: total API outage — Supabase Postgres unreachable

`/api/health`, `/api/events`, `/api/places`, `/api/orgs`, `/api/meetings`,
`/api/now`, and `/api/articles` all return `HTTP 500` with
`{"error":{"code":"internal","message":"Unexpected server error."}}`,
consistently across repeated requests as of 2026-09-10T02:22Z (verified
again while writing this report). The Worker itself is up — an unknown
route still returns a normal `404 not_found`, and `brownsync.pages.dev`
still serves its static shell (`200`) — so this is not a Worker deploy
failure, only every route that touches the database.

Root cause, from `poll.yml`'s last run (#1680, 2026-09-04T14:34:37Z, the
**last Poll run of any kind since**):

```
[dedup] error: (ENOTFOUND) tenant/user postgres.hkrxahzdqqxxovvilalm not found
[source_runs] could not record failure: (ENOTFOUND) tenant/user postgres.hkrxahzdqqxxovvilalm not found
```

`ENOTFOUND tenant/user <ref> not found` is Supabase's own Supavisor/PgBouncer
pooler rejecting the connection because it no longer recognizes that project
reference — the signature of a Supabase project that has been **paused,
deleted, or had its connection string invalidated**, not an application bug.
The Worker's Hyperdrive binding points at the same project, which is why
every DB-backed route 500s identically.

**This requires the owner to check the Supabase dashboard** (project status,
billing/pause state, connection string) and, if needed, update the
`DATABASE_URL` secret (GitHub Actions) and the Hyperdrive connection string
(Cloudflare) to match. This is exactly the kind of fix this audit is not
permitted to make unattended — no `supabase db push`, no credential
rotation, no prod config change — so it is reported precisely instead of
guessed at.

## Second finding: `poll.yml` stopped firing entirely after the failure

`poll.yml`'s three crons (`*/15`, `37 */2 * * *`, `52 * * * *`) ran normally
and successfully every few minutes right up to run #1679 (2026-09-04T13:05Z,
success), then run #1680 failed on the DB error above at 14:34Z — and
**no run of any kind has fired since**, a 6-day gap on a workflow the repo
confirms is still `state: active`. This is a materially worse version of
the "GitHub Actions scheduled-trigger stall" pattern documented repeatedly
in #13/#28/#30 (previously a few hours, never six days) and is itself worth
the owner's attention independent of the DB outage — a `workflow_dispatch`
would not meaningfully help here since the underlying DB is unreachable
regardless.

## Not re-checked in detail

Given the DB is unreachable, the per-source table, `/api/events` count, and
the open-PR backlog census from #31 are not re-run here — they would either
500 or be unchanged from #31's report (20 open PRs, #21/#25 still the
zero-risk ready fixes for the separate AMBER backlog issue). That backlog
concern still stands once the outage above is fixed; it is not this
session's most important finding today.

## No code fix opened

Nothing in this repo's code, tests, or migrations caused this: `ENOTFOUND
tenant/user ... not found` is Supabase's pooler refusing the connection
before any application code runs. There is no PR that can fix a paused or
reconfigured Supabase project.

## Single most important next action

**Check the Supabase project dashboard now.** If it was paused (inactivity
or billing), unpause it; if the project reference changed, update
`DATABASE_URL` (GitHub Actions secret) and the Hyperdrive connection string
(Cloudflare, `apps/api/wrangler.toml`'s `[[hyperdrive]]` binding) to match,
then redeploy the Worker (owner-approved step). Confirm with
`curl https://brownsync-api.noahfinkelstein.workers.dev/api/health` —
it should return `200` with a `sources` array, not `500`.

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01RrJya3fj2bs9VRd1DBRhxo
