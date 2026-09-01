# Freshness audit — 2026-09-01

Daily session, 24 days since launch (2026-08-08). No new code defect found.

## Per-source table (`/api/health`, checked 2026-09-01T13:50Z, re-checked after manual dispatch)

| source | status | age vs threshold | verdict |
|---|---|---|---|
| brown_news | ok | 20m vs 2h | FRESH |
| dedup | ok | 6m vs 1h | FRESH |
| athletics_ics / bdh | ok | 1.8h vs 4h/2h | FRESH |
| livewhale | ok | 1.4h vs 40m at first check | STALE at 13:50Z — poll.yml cron gap (same pattern as #13/#28/#30); cleared by manual dispatch, see below |
| athletics / buildings / cab / clubs / events / places | ok | 34d vs 7d default | STALE — one-time seed lane, unchanged since 2026-07-29, fix drafted in #12/#19/#20 |
| academic_calendar / dining / libcal / bpr / bjwa / ppl | never | — | NEVER — `refresh.yml` pytest gate, fix ready in #21 (`mergeable_state: clean`, unmerged since 2026-08-19) |
| arcgis | never | — | NEVER — blocked by the repo's Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" toggle (#25), unresolved |
| passiogo | never | — | NEVER — producer not yet deployed (pre-existing, out of scope) |
| providence_gov / today_brown / feed_rank | — | disabled | paused by design |

## Finding: poll.yml cron gap, recovered by manual dispatch

`poll.yml`'s tightest cron (livewhale, `*/15 * * * *`) had not fired reliably
today — its recent run timestamps (12:26, 11:58, 10:31, 06:59, 05:44, 05:37,
01:54Z...) are irregular, not the ~15-minute cadence the cron declares, and
`livewhale`'s `last_ok_at` (12:27:35Z) was 1.4h stale against its 40-minute
threshold at audit time (13:50Z). This is the same GitHub Actions scheduled-
trigger stall documented on 2026-08-10 (#13), 2026-08-27 (#28), and
2026-08-31 (#30) — dedup/brown_news, which run off the Worker-dispatcher
cron rather than this GitHub Actions workflow, were fresh throughout,
isolating this to Actions scheduling, not the poller code, the DB, or the
sources themselves.

Per the established precedent in #13/#28/#30, this is a data-freshness fix
an unattended audit can safely make without touching prod schema or config:
manually dispatched `poll.yml` with `source=all`
(https://github.com/noahfinkelstein/BrownSync/actions/runs/33515890561).
It completed normally with a real runner (run #1624, success); `/api/health`
at 13:52Z shows `livewhale`, `athletics_ics`, `bdh`, and `dedup` all fresh
(all <1 minute old). No code change was needed — the workflow itself is
healthy, only its scheduled trigger stalled.

## Workflow health

- Poll: cron-trigger gap today (see above), cleared by manual dispatch — the workflow itself is healthy, only its scheduled trigger stalled (recurring GitHub Actions platform issue, not a code defect).
- Refresh data artifacts: red, 28/28 scheduled runs failed since 2026-08-08 — never once succeeded. Root cause diagnosed and fixed on-branch (#21, tested, clean); the `arcgis` leg is separately blocked by a repo setting (#25). Both confirmed unchanged today.
- CI: green (on the audit-branch runs; no runs against `main` itself since nothing has merged).
- Deploy: green; still on the 2026-08-08 launch commit — **zero merges to `main` in 24 days**.
- Seed Load: one-time manual (`workflow_dispatch` only), last ran 2026-07-29 — no recurring schedule by design, so the STALE reading on its six sources above is a threshold-registration gap rather than a regression (tracked in #12/#19/#20).
- 60-day cron auto-disable: not an immediate risk (24 days since last push to `main`), but the margin is now under half the window with zero merge activity to reset it.

## Web + data currency

- `brownsync.pages.dev` → 200.
- `/api/events`, next 7 days (2026-09-01–2026-09-08): **251 events** — healthy, non-empty.

## Backlog

**20 open PRs** (#11–#30), all opened by this routine since 2026-08-08, **none merged**. Of note:
- #21 — tested, clean fix for the `refresh.yml` pytest-gate red streak (ready since 2026-08-19, 13 days now).
- #25 — repo-settings fix (owner action) for the `arcgis` leg's PR-creation block (ready since 2026-08-23, 9 days now).
- #23 — unrelated `brown_news` scraper-drift fix (ready since 2026-08-21).
- #29 (2026-08-30) independently re-derives the same fix as #21 — the **fifth** time this routine has re-solved an already-fixed defect because the canonical fix sits unmerged. Still open; recommend closing in favor of #21 once triaged.

**Re-deriving already-solved fixes, not finding new defects, remains the primary cost of running this routine daily while the backlog sits unreviewed.**

## Single most important next action

**Merge #21** (clears the 28/28 daily-refresh red streak) and flip **Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"** (clears the `arcgis` leg, #25). Both are zero-risk, already tested, and have been sitting ready since 2026-08-19 and 2026-08-23 respectively — 13 and 9 days now.

## Overall verdict: AMBER

The web app, live-polled sources, and upcoming-events count are all healthy
in substance — today's only new event (a poll.yml cron stall affecting
livewhale) was cleared by a manual dispatch within the session, no code was
at fault. The standing risk is unchanged and remains the most severe fact in
this report: 24 days and a 20-PR review backlog, including two zero-risk
tested fixes, sitting completely unmerged.

---
_Generated by [Claude Code](https://claude.ai/code)_
