# BrownSync daily freshness audit — 2026-11-04

## Summary

Day 61 of the total production outage first reported in #33 (2026-09-10,
diagnosed as starting 2026-09-04). Nothing has changed since yesterday's
audit (#61, day 58) or the ~30 daily audits before it: both root causes are
infra/account-level and still require the owner, and the 50+ PR backlog
remains unreviewed.

## Per-source table

The `sources` array itself is unreachable — `/api/health` returns a bare
500, not JSON with a `sources` list — so no per-source freshness table can
be produced from the API today. Falling back to the last-known-good signal
(GitHub Actions job logs) for data-currency:

| source (via Poll/Refresh logs) | status | age vs threshold | verdict |
|---|---|---|---|
| all TS poller sources (dedup, livewhale, athletics, bdh, brown_news) | DB write blocked: `(ENOTFOUND) tenant/user postgres.hkrxahzdqqxxovvilalm not found` | last successful Poll run 2026-09-04 13:05Z → 61 days stale | ERROR |
| all Python/ingest sources (dining, libraries, arcgis, publications) | "Refresh data artifacts" workflow last ran 2026-09-04 (failed on pytest gate, pre-existing fixture/test drift, not DB-related) | 61 days since last attempt; dormant since 2026-09-14 | ERROR |
| bdh, providence_gov, today_brown, feed_rank | — | — | paused by design (unchanged) |

## Web / API checks

| check | result |
|---|---|
| `GET /api/health` | 500 `{"error":{"code":"internal"}}` |
| `GET /api/events` | 500 `{"error":{"code":"internal"}}` |
| `GET /api/now` | 500 `{"error":{"code":"internal"}}` |
| `GET /api/articles` | 500 `{"error":{"code":"internal"}}` |
| `GET /api/openapi.json` (no DB touch) | 200 — confirms the Worker is up; only the DB layer is broken |
| `brownsync.pages.dev` | 200 (static shell only; no live data without a working API) |

Upcoming-events count (today → +7d): **unavailable** — `/api/events` 500s
before returning any payload. Verdict for this check: RED (not just AMBER —
the endpoint itself is down, not just empty).

## Workflow health

| workflow | last completed run | status |
|---|---|---|
| Deploy | 2026-08-08 | success, nothing since (no main pushes to redeploy) |
| CI | 2026-09-02 | success, nothing since (no open PRs have merged) |
| Poll | 2026-09-04 13:05Z success, 2026-09-04 14:34Z failure (DB ENOTFOUND) | two `workflow_dispatch` attempts since (2026-09-11, 2026-09-14) both still `queued`, zero jobs ever allocated, 7–8 weeks later |
| Refresh data artifacts | failing daily 2026-08-27 → 2026-09-04 (pytest gate: pinned dedupe hit-rate, redaction-diagnostics count, library-hours fixture drift, 5 unmanifested hours-grid fixtures), then silent | same dormancy as Poll since 2026-09-14 |

GitHub Actions has not executed a single job — scheduled or manual — since
**2026-09-14**, 51 days ago. The repo's `pushed_at` is recent (2026-11-02,
from this very audit-branch series), so this is not simple 60-day repo
inactivity auto-disable (that requires no pushes at all); it reads as a
billing/spending-limit block or an Actions-execution outage the owner needs
to check in Settings → Billing and Settings → Actions → General. This
session's GitHub access does not expose the billing API to confirm which.

## What was fixed / filed today

No new defect found and no new code fix opened — same conclusion as the
prior ~29 daily audits (#33, #50–#61). Both root causes are outside what a
repository change can fix:

1. **Supabase project `hkrxahzdqqxxovvilalm` unreachable** (Supavisor
   "tenant or user not found" — the signature of a paused/deleted project or
   a stale `DATABASE_URL`). Needs owner dashboard access.
2. **GitHub Actions dormant since 2026-09-14.** Needs owner access to repo
   Settings → Billing/Actions.

The one available code fix for the *symptom* (turning the bare 500 into a
clean 503 `db_unavailable`) was already landed, tested, and opened as **PR
#62** (2026-11-02) — still open/unreviewed, duplicating the earlier #58.
No further code action is useful until the owner resolves root cause #1,
at which point the existing backlog (tests, migrations, pending fixes)
should be triaged in order rather than re-filed again.

## Overall verdict: RED

**Single most important next action (unchanged for 61 days):** owner opens
the Supabase dashboard for project `hkrxahzdqqxxovvilalm` and resumes/
reconfigures it, then checks GitHub Settings → Billing and Actions →
General for whatever is blocking every workflow run. Everything else —
stale data, the PR backlog, the dead cron — cascades from these two.
