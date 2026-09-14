# BrownSync daily freshness audit — 2026-09-14

**Overall verdict: RED — unchanged, day 10 of total outage, zero owner
action across five consecutive daily reports (#33, #34, #35, #36, this
one).** The read API is fully down (every route, not one source) and the
whole GitHub Actions lane has been dead since ~2026-09-04. Neither is
fixable from this session — both need owner-side access (Cloudflare/
Supabase dashboards, GitHub billing) this session doesn't hold. No code has
changed since the 2026-08-08 launch commit, so this remains an infra/ops
incident, not a regression introduced by a PR.

## 1. API health

Same generic 500 on every route as every prior report this week:

```
HTTP/2 500
{"error":{"code":"internal","message":"Unexpected server error."}}
```

Tried `/api/health`, `/api/now`, `/api/articles`, `/api/meetings`,
`/api/events` (with a valid ISO datetime query, to rule out a validation
issue) — all five 500 identically, 3/3 retries each. `isDbUnavailable()`
(`apps/api/src/errors.ts`) still doesn't recognize whatever shape this
error is (unchanged from 2026-09-13's read of the same file — no new
information to widen the pattern match against, so no speculative edit
made). `/api/openapi.json` (static, no DB) still serves 200, confirming the
break is specifically in the Postgres/Hyperdrive path shared by every data
handler, not the Worker or router as a whole.

Per-source staleness table: **still unavailable** — `/api/health` is itself
one of the down routes.

## 2. Web

`https://brownsync.pages.dev` → `200`, unchanged.

## 3. GitHub Actions — confirmed still dead, now including manual dispatch

Re-ran the same workflow-history check as 2026-09-13: CI (#72, Sept 2),
Refresh (#32, Sept 4), Poll (#1680 scheduled, Sept 4), Deploy (#27, Aug 8 —
expected, no merges to `main`). No change in any of the four.

New data point this run: fired `poll.yml` via `workflow_dispatch` directly
(read-only diagnostic — Poll only polls already-vetted external sources
under existing etiquette gates, the same action the owner took on Sept 11).
Result: run **#1682 queued at 12:28 UTC and is still sitting `queued`**,
exactly like the owner's own Sept 11 attempt (#1681, still queued 3 days
later). Two independent manual triggers, three days apart, both stuck at
`queued` with no runner ever allocated — this rules out a one-off scheduling
glitch and confirms GitHub Actions cannot run *any* job for this repo right
now, scheduled or manual. That's stronger evidence than before that this is
a GitHub-account-level block (billing/spending limit or Actions disabled),
not a repo config issue.

## 4. Data currency

Still unassessable directly (`/api/events` is down). Poll hasn't run since
Sept 4 and Actions can't run anything at all (§3), so the upcoming-events
window for a real visitor to brownsync.pages.dev is **RED by inference**,
same as every report since 2026-09-10.

## 5. Backlog / process note

26 open PRs (#11–#36), every one still a draft, **zero merged since the
2026-08-08 launch commit** — 37 days. The last four freshness-audit PRs
(#33 Sept 10, #34 Sept 11, #35 Sept 12, #36 Sept 13) each independently
reached the same root-cause diagnosis and the same "needs owner dashboard
access" conclusion; #36 got one bot comment (CodeRabbit, automated) and no
owner reply. Filing another docs-only PR with the same finding is
consistent with that pattern, not a new incident — but the lack of any
owner engagement across 5 days of the same flag is itself now the most
actionable fact in this report.

## Next action (single most important)

**Owner: this needs five minutes in two dashboards, today.**
1. Cloudflare dashboard → Workers → `brownsync-api` → Logs, for the real
   thrown exception behind the 500.
2. Supabase project `hkrxahzdqqxxovvilalm` — confirm it isn't paused.
3. GitHub → Settings → Billing → Plans and usage (Actions minutes/spending
   limit) and Settings → Actions → General, for whichever account owns this
   repo — two independent stuck-`queued` manual runs (Sept 11, Sept 14) says
   this is the more likely of the two root causes to be a simple toggle/
   payment-method fix.

Nothing else in this report — freshness of any individual source, CI,
deploys — can be assessed or fixed until these two systems are back.
