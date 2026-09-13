# BrownSync daily freshness audit — 2026-09-13

**Overall verdict: RED.** The read API is fully down (every route, not one
source) and the whole GitHub Actions lane has been silently dead for 9+
days. Neither is fixable from this session — both need owner-side access
(Cloudflare/Supabase dashboards, GitHub billing) this session doesn't hold.
No code has changed since the 2026-08-08 launch commit, so this is an
infra/ops incident, not a regression introduced by a PR.

## 1. API health

`GET /api/health` — and every other route tried (`/api/now`,
`/api/articles`, `/api/meetings`, `/api/events`) — returns:

```
HTTP/2 500
{"error":{"code":"internal","message":"Unexpected server error."}}
```

This is the generic catch-all in `apps/api/src/app.ts`'s `onError` handler
(`app.ts:238-239`), which only fires when the thrown error does **not**
match `isDbUnavailable()` (`errors.ts`) — so whatever's failing is not
timing out with a code/message that file already recognizes (`ECONNREFUSED`,
`CONNECTION_ENDED`, Postgres class-08 SQLSTATEs, workerd's bare "connection
attempt failed", etc.). Sending a deliberately malformed query
(`from=2026-09-13`, missing time) still returned a clean `400 bad_request`
with the expected Zod detail, so the router/validation layer is fine — the
break is downstream, in `createQueries`/the Postgres connection path
(Hyperdrive → Supabase), or in something the health/now/articles/meetings
handlers all share.

Because `/api/health` itself is one of the routes that's down, **no
per-source table could be pulled this run** — the audit has no visibility
into individual source staleness beyond what GitHub Actions run history
implies (§3).

**Can't fix from here:** no Cloudflare or Supabase credentials in this
environment (`env | grep -i cloudflare/supabase` — empty), so the actual
Worker exception (Cloudflare dashboard → Workers → `brownsync-api` → Logs)
and the Supabase project's live status (dashboard → Project → paused?) are
both invisible to this session. Prod is also off-limits by standing rule
(no `wrangler deploy`, no `supabase db push`).

**Needs owner action:**
1. Open the Cloudflare dashboard for the `brownsync-api` Worker and read the
   real-time logs / a tailed request to get the actual thrown error instead
   of the generic 500.
2. Check the Supabase project (`hkrxahzdqqxxovvilalm`) isn't paused —
   free-tier projects auto-pause after a period of no traffic, and Supabase
   pauses commonly manifest through pgbouncer/Hyperdrive as an error shape
   `isDbUnavailable()` doesn't recognize yet (worth widening once the real
   message is known — see suggested follow-up below).
3. Confirm the `[[hyperdrive]]` binding (`0548aab052da48ada0056c1522bad8e0`)
   still resolves and the underlying Supabase connection string / password
   hasn't rotated or expired.
4. Once the real error is known, if it turns out to be a legitimate
   DB-unavailable shape that `errors.ts` just doesn't classify yet, that's a
   quick, low-risk follow-up PR (extend `DB_UNAVAILABLE_CODES` /
   `DB_UNAVAILABLE_MESSAGES`) — filed as a suggestion, not applied blind,
   since misclassifying a *real* bug as "db_unavailable" would hide it
   instead of surfacing it.

## 2. Web

`https://brownsync.pages.dev` → `200`. The static shell loads; anything it
fetches client-side from the API above will be failing the same way.

## 3. GitHub Actions — dead since ~2026-09-04

All four tracked workflows on `main` (`3cb7ca1`, still the launch commit —
no pushes since 2026-08-07):

| workflow | last run seen | result |
|---|---|---|
| CI | run #72, 2026-09-02 12:49 UTC (`pull_request`, audit branch) | success — but **nothing since** |
| Refresh data artifacts | run #32, 2026-09-04 13:27 UTC (`schedule`) | failure (32/32 failed all-time — pre-existing pytest-gate issue, unchanged) |
| Poll | run #1680, 2026-09-04 14:34 UTC (`schedule`) | failure; run #1681 is a `workflow_dispatch` queued 2026-09-11 12:26 UTC that **never started** (still `status: queued`, `billable: {}` — no runner was ever allocated to it) |
| Deploy | run #27, 2026-08-08 01:57 UTC (`push`) | success — no deploy since launch (expected: no merges to `main`) |

None of the four workflows report `disabled_inactive` (the 60-day-no-commit
auto-disable hasn't tripped — only 37 days since the last push), so this
isn't that. But **every scheduled trigger across every workflow stopped
firing at the same time (~2026-09-04)**, and the one manual retry since
(Sept 11) has sat queued for 2+ days with zero billed minutes — the
signature of GitHub Actions being unable to allocate a runner to this repo
at all, not a workflow-level bug. That also explains why no daily
freshness-audit PR was opened between 2026-09-02 and today: this routine
rides the same repo.

**Needs owner action:** check GitHub → Settings → Billing → Plans and usage
(Actions minutes / spending limit) for whichever account owns
`noahfinkelstein/BrownSync`, and confirm Actions is still enabled for the
repo (Settings → Actions → General). This is not something a repo-scoped
session can see or fix.

## 4. Data currency

Could not be checked — `/api/events` is part of the API outage (§1). Given
Poll (the only thing driving the polled sources, per the 2026-09-02 audit)
hasn't run on schedule since 2026-09-04, and the read API can't serve
`/api/events` at all right now, treat the upcoming-events window as **RED**
by inference, not just AMBER — there's currently no path for a user hitting
brownsync.pages.dev to see any events, regardless of how fresh the
underlying data is.

## 5. What changed vs. the last audit (2026-09-02, PR #32)

That audit's findings (livewhale STALE on the poll.yml-only cadence,
refresh.yml 29/29 red, seed-lane null thresholds) are still true as far as
can be told, but they're now moot next to the total outage: there's been no
audit, no deploy, and — as of ~2026-09-04 — no scheduled ingestion or CI at
all for over a week.

## Next action (single most important)

**Owner: check Cloudflare Worker logs for the real `brownsync-api` 500
cause, and check GitHub Actions billing/usage for this account.** Both are
outside this session's access and are blocking everything else — no source
freshness, no deploy, no CI can be assessed or fixed until the API and
Actions runners are back.
