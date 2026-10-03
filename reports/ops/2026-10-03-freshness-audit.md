# BrownSync daily freshness audit — 2026-10-03

## Verdict: RED — day 30 of total outage, still unactioned since #33

Nothing new. Same two root causes as every audit since #33 (2026-09-10),
independently reconfirmed today by direct `curl` and the GitHub Actions API.
No code fix exists for either; neither is fixable from this repo.

## 1. API health

`GET /api/health` → `HTTP 500 {"error":{"code":"internal","message":"Unexpected
server error."}}`, reproduced on two consecutive attempts (6s apart). Every
other DB-backed route fails identically: `/api/events` (`500`, after correcting
my own malformed query params to full ISO timestamps), `/api/articles`
(`500`), `/api/meetings` (`500`), `/api/places` (`500`). An unknown route
(`/api/buildings`) correctly returns `404 not_found`, so the Worker's router is
fine — only the DB-backed handlers fail, consistent with every DB connection
attempt failing (`apps/api/src/db.ts` lazily opens a `postgres.js` client,
`connect_timeout: 5`). Because `/api/health` itself is down, no per-source
table can be produced this session — same as #33 onward.

Root cause (per #39, reconfirmed every day since): Supabase project
`hkrxahzdqqxxovvilalm` (`DEPLOY.md`) is unreachable in the shape typical of a
paused/deleted/reconfigured free-tier project. This sandbox has no outbound
route to `*.supabase.co` to re-probe the pooler directly; the Worker-side
symptom (uniform generic `500` on every DB route, routing otherwise intact) is
unchanged from every prior audit.

| source | status | age vs threshold | verdict |
|---|---|---|---|
| (all sources) | unknown — `/api/health` itself returns 500 | n/a | **ERROR** (API-wide, 30 days running) |

## 2. Web

`https://brownsync.pages.dev` → `200`. Static shell only; no live data can
render without a working API.

## 3. Events window

Not retrievable — `/api/events` returns `500` for the same reason as above.
AMBER-or-worse by definition; actually full ERROR since the endpoint itself
is down, not merely empty.

## 4. GitHub Actions

All four workflows (`Poll`, `Refresh data artifacts`, `CI`, `Deploy`) still
report `state: active` via the Actions API — this is **not** the 60-day
cron-disable (last push to `main` was 2026-08-07, 57 days ago, still short of
the 60-day mark, and getting closer).

- `poll.yml`: last **completed** run was 2026-09-04 (run #1679, success).
  Two `workflow_dispatch` attempts since (#1681 created 2026-09-11, #1682
  created 2026-09-14) are both still `status: queued` today, 2026-10-03 —
  22 and 19 days respectively with zero job ever allocated. No run of any
  kind, scheduled or manual, has executed in 29 days.
- `refresh.yml`: last run was 2026-09-04 (run #32, failure, pre-existing
  pytest-fixture issue, unrelated to the outage). No run since — 29 days.
- `ci.yml` / `deploy.yml`: last activity 2026-09-02 / 2026-08-08
  respectively (both were triggered by this audit routine's own PRs/merges;
  no human-authored commits have landed since launch).

This points at an account-level GitHub Actions usage/billing block (included
minutes or spending limit exhausted), not a workflow-file or cron problem —
unchanged diagnosis from #33 onward.

## 5. Backlog

30 open PRs now (`#21`–`#51` minus #26/#46, plus today's), almost all either
daily audit reports or already-tested small fixes, zero merged since launch
on 2026-08-08 (57 days). The backlog itself is now a standing risk
independent of the outage.

## Owner action needed (unresolved 23 days running)

1. Supabase dashboard → project `hkrxahzdqqxxovvilalm` — confirm it isn't
   paused; if the project reference changed, update `DATABASE_URL`/Hyperdrive
   and redeploy the Worker.
2. GitHub → Settings → Billing → Plans and usage, and Settings → Actions →
   General — clear whatever is blocking Actions runners from ever starting
   queued jobs.
3. Triage the 30-PR backlog (most of it is routine audit noise or safe,
   already-reviewed fixes).
4. Confirm fix via `curl https://brownsync-api.noahfinkelstein.workers.dev/api/health`
   returning `200` with a populated `sources` array, and a completed
   (non-`queued`) Poll run.

No code changed this session — same conclusion as #33–#51: neither root
cause is fixable from the repo, and no new defect was found.
