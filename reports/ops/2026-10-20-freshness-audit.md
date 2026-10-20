# BrownSync daily freshness audit — 2026-10-20

Day 47 of the total production outage first reported in #33 (2026-09-10,
diagnosed as starting 2026-09-04). Status is **unchanged** from the prior
~25 consecutive daily audits (#33, #50–#59): still RED, still unactioned.

## Checks run

1. **`GET /api/health`** → `500 {"error":{"code":"internal","message":"Unexpected
   server error."}}` (confirmed on 3 consecutive requests, including with
   response headers — `server: cloudflare`, genuine `HTTP/2 500` from the
   Worker, not a proxy artifact).
2. **Every other DB-backed route** (`/api/events`, `/api/now`, `/api/places`,
   `/api/articles`) → identical `500 internal`. **`/api/openapi.json`**
   (no DB touch) → `200`. This isolates the fault to the Worker's
   Hyperdrive→Supabase connection, not to a specific handler — consistent
   with every prior audit since #39.
3. **`brownsync.pages.dev`** → `200` (static shell only; unusable without a
   working API).
4. **Upcoming events (`/api/events`, today–+7d)** → cannot be determined;
   the endpoint itself 500s.
5. **Workflow health** (`gh`/GitHub API, last runs):
   - **Deploy**: last run 2026-08-08 (launch day). None since — prod is
     exactly the build verified at launch, now **74 days** stale.
   - **Poll**: last *completed* run 2026-09-04 (#1680, failure after a long
     streak of success). Two later `workflow_dispatch` attempts (#1681
     Sep 11, #1682 Sep 14) are still `status: queued`, **zero jobs ever
     allocated**, 39 and 36 days later respectively.
   - **Refresh data artifacts**: last run 2026-09-04 (#32, failure). Silent
     since — matches Poll's stall point exactly.
   - **CI**: last run 2026-09-02 (#72, a docs-only audit PR). 21+ PRs opened
     against `main` since (#33–#59) with **no CI run triggered on any of
     them** — the halt covers every Actions trigger (push, pull_request,
     schedule, workflow_dispatch alike), not just cron.
   - Last push to `main` is **74 days** old — past GitHub's 60-day
     no-activity threshold for auto-disabling scheduled workflows. All four
     workflows still report `state: active` via the Actions API, so this
     looks less like the cron auto-disable and more like an account-level
     GitHub Actions billing/usage block (per #53's reasoning, reconfirmed
     since) — but both explanations point the same direction: owner-only to
     clear.

## Root cause (unchanged, established #39)

Supabase project `hkrxahzdqqxxovvilalm` (per `DEPLOY.md`) is unreachable in
a way consistent with paused/deleted/reconfigured, not a bare dropped
connection (`apps/api/src/errors.ts` already classifies a plain socket drop
as `503 db_unavailable` — getting `500 internal` instead means something
other than that). PR #58 (open, unmerged) already lands the fix for the
*symptom* — classifying the actual Supabase pooler rejection message
(`tenant/user ... not found`) as `503` instead of a bare `500` — but as its
own description says, **that does not fix the outage**, only the honesty of
its reporting. No new code fix is opened today for the same reason as the
prior ~25 audits: the actual outage is not fixable from this repo.

## Per-source table

Cannot be produced — `/api/health` itself is down, so no per-source
`status`/`lastOkAt`/`staleAfterSeconds` data is retrievable today. Every
known source is effectively unobservable from outside; by definition every
enabled source has been failing to ingest since 2026-09-04 (Poll/Refresh
have not run), i.e. **46 days** of accumulated staleness on top of the API
outage itself.

## Owner action needed (unresolved 47 days running)

1. Supabase dashboard → project `hkrxahzdqqxxovvilalm` — resume if paused;
   if the project reference changed, update `DATABASE_URL`/Hyperdrive and
   redeploy.
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions →
   General — clear whatever is blocking every workflow trigger.
3. Triage the 49-PR backlog (#11–#59), unreviewed for over two months —
   includes PR #58's ready, tested error-classification fix.
4. Re-verify: `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health`
   returns `200` with a populated `sources` array, and a completed
   (non-`queued`) Poll or CI run appears.

## Overall verdict: **RED**

Single most important next action: **resume the Supabase project
`hkrxahzdqqxxovvilalm`** — every other symptom (stale sources, stuck
workflows, the 500s themselves) cascades from the database being
unreachable.
