# BrownSync daily freshness audit — 2026-09-15

**Overall verdict: RED — unchanged, day 11 of total outage, zero owner
action across six consecutive daily reports (#33, #34, #35, #36, #37, this
one).** The read API is fully down (every route, not one source) and the
whole GitHub Actions lane has been dead since ~2026-09-04. Neither is
fixable from this session — both need owner-side access (Cloudflare/
Supabase dashboards, GitHub billing) this session doesn't hold. No code has
changed since the 2026-08-08 launch commit, so this remains an infra/ops
incident, not a regression introduced by a PR.

## 1. API health

Same generic 500 on every DB-backed route as every prior report since
2026-09-10:

```
HTTP/2 500
{"error":{"code":"internal","message":"Unexpected server error."}}
```

Tried `/api/health`, `/api/now`, `/api/articles`, `/api/events` (with a
valid ISO datetime query, to rule out a validation issue) — all 500
identically, retried 3x each, stable across several minutes. `/api/events`
without a valid ISO range still returns its own `400 bad_request` (route
logic runs and validates before ever touching the DB), which is consistent
with every DB-backed handler failing at the same Postgres/Hyperdrive layer.
`/api/openapi.json` (static, no DB) still serves 200, confirming the break
is specifically in the shared DB path, not the Worker or router as a whole.

Per-source staleness table: **still unavailable** — `/api/health` is itself
one of the down routes.

## 2. Web

`https://brownsync.pages.dev` → `200`, unchanged.

## 3. GitHub Actions — still dead, including manual dispatch

Re-checked workflow history: CI last ran #72 (Sept 2, this audit's own PR
#32), Refresh last ran #32 (Sept 4, failure), Poll last *executed* run
#1680 (scheduled, Sept 4, failure — DB `ENOTFOUND` per #33's original
diagnosis), Deploy last ran #27 (Aug 8 — expected, no merges to `main`
since launch).

The owner's manual `workflow_dispatch` (#1681, fired Sept 11) is still
sitting `queued`, four days later, never allocated a runner. This session
did not fire another manual Poll run today — two independent stuck-`queued`
dispatches (Sept 11, Sept 14, both still queued) already establish the
pattern; a third read-only trigger would add no new information and this
audit avoids taking actions solely to re-confirm an already-confirmed
finding. Conclusion unchanged: GitHub Actions cannot run *any* job for this
repo right now, scheduled or manual — an account-level block (billing/
spending limit or Actions disabled), not a repo config issue.

## 4. Data currency

Still unassessable directly (`/api/events` 500s on any valid range). Poll
hasn't executed since Sept 4 and Actions can't run anything at all (§3), so
the upcoming-events window for a real visitor to brownsync.pages.dev is
**RED by inference**, same as every report since 2026-09-10 — 11 days of a
map with no live data behind it during term time.

## 5. Backlog / process note

27 open PRs (#11–#37), every one still a draft, **zero merged since the
2026-08-08 launch commit** — 38 days. The last five freshness-audit PRs
(#33 Sept 10 through #37 Sept 14) each independently reached the same
root-cause diagnosis and the same "needs owner dashboard access"
conclusion; none has drawn an owner reply beyond one automated bot comment
on #36. Filing another docs-only PR with the same finding is consistent
with that pattern, not a new incident — but six consecutive unactioned days
on the same flag, on a student-facing outage, is itself now the most
actionable fact in this report.

## Next action (single most important)

**Owner: this needs five minutes in two dashboards, today.**
1. Cloudflare dashboard → Workers → `brownsync-api` → Logs, for the real
   thrown exception behind the 500.
2. Supabase project `hkrxahzdqqxxovvilalm` — confirm it isn't paused; per
   #33's original diagnosis the pooler was rejecting the project reference
   entirely (`ENOTFOUND tenant/user ... not found`).
3. GitHub → Settings → Billing → Plans and usage (Actions minutes/spending
   limit) and Settings → Actions → General, for whichever account owns this
   repo — two independent stuck-`queued` manual runs (Sept 11, Sept 14) says
   this is the more likely of the two root causes to be a simple toggle/
   payment-method fix.

Nothing else in this report — freshness of any individual source, CI,
deploys — can be assessed or fixed until these two systems are back.
