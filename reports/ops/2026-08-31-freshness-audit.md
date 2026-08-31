# Freshness audit — 2026-08-31

Daily session, 23 days since launch (2026-08-08). No new code defect found.

## Per-source table (`/api/health`, checked 2026-08-31T12:54Z, re-checked 12:58Z)

| source | status | age vs threshold | verdict |
|---|---|---|---|
| brown_news | ok | 6m vs 2h | FRESH |
| dedup | ok | 8m vs 1h | FRESH |
| livewhale / athletics_ics / bdh | ok | 4–7h vs 40m/4h/2h at first check | STALE at 12:54Z — poll.yml cron gap (see below); FRESH by 12:58Z after manual dispatch |
| athletics / buildings / cab / clubs / events / places | ok | 33d vs 7d default | STALE — one-time seed lane, unchanged since 2026-07-29, fix drafted in #12/#19/#20 |
| academic_calendar / dining / libcal / bpr / bjwa / ppl | never | — | NEVER — `refresh.yml` pytest gate, fix ready in #21 (`mergeable_state: clean`, unmerged since 2026-08-19) |
| arcgis | never | — | NEVER — separately blocked by the repo's Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" toggle (#25), confirmed still unresolved this session |
| passiogo | never | — | NEVER — producer not yet deployed (pre-existing, out of scope) |
| providence_gov / today_brown / feed_rank | — | disabled | paused by design |

## Finding: poll.yml cron gap, recovered by manual dispatch

`poll.yml`'s tightest cron (livewhale, `*/15 * * * *`) had not fired since its
last completed run at **2026-08-31T08:53:08Z** — a ~4h gap as of this audit
(12:54Z), consistent with the same GitHub Actions scheduled-trigger stall
documented on 2026-08-10 (#13) and 2026-08-27 (#28). dedup/brown_news, which
run off the Worker-dispatcher cron rather than this GitHub Actions workflow,
were unaffected and fresh throughout — isolating this to Actions scheduling,
not the poller code, the DB, or the sources.

Per the established precedent in #13, this is a data-freshness fix an
unattended audit can safely make without touching prod schema or config: I
manually dispatched `poll.yml` with `source=all`
(https://github.com/noahfinkelstein/BrownSync/actions/workflows/poll.yml).
It completed normally with a real runner; `/api/health` at 12:58Z shows
`livewhale`, `athletics_ics`, `bdh`, and `dedup` all fresh. No code change
was needed — the workflow itself is healthy, only its scheduled trigger
stalled.

## Workflow health

- Poll: green on every completed run; today's gap was a trigger stall, not a failure (see above), and is now cleared.
- Refresh data artifacts: red, 27/27 scheduled runs failed since 2026-08-08 — never once succeeded. Root cause diagnosed and fixed on-branch (#21, tested, clean); the `arcgis` leg is separately blocked by a repo setting (#25). Confirmed today by re-reading the latest failed run's logs: same signature as #25 — `pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)`, failing at the final "Open a pull request if anything actually changed" step, after every prior step (capture, rebuild, offline suite, seed QA) passes clean.
- CI: green.
- Deploy: green; still on the 2026-08-08 launch commit — **zero merges to `main` in 23 days**.
- Seed Load: one-time manual (`workflow_dispatch` only), last ran 2026-07-29 — no recurring schedule by design, so the STALE reading on its six sources above may be a threshold-registration gap rather than a regression (tracked in #12/#19/#20).
- 60-day cron auto-disable: not an immediate risk (23 days since last push to `main`), but the margin is now well under half the window with zero merge activity to reset it.

## Web + data currency

- `brownsync.pages.dev` → 200.
- `/api/events`, next 7 days (2026-08-31–2026-09-07): **241 events** — healthy, non-empty.

## Backlog

**19 open PRs** (#11–#29), all opened by this routine since 2026-08-08, **none merged**. Of note:
- #21 — tested, clean fix for the `refresh.yml` pytest-gate red streak (ready since 2026-08-19).
- #25 — repo-settings fix (owner action) for the `arcgis` leg's PR-creation block (ready since 2026-08-23).
- #23 — unrelated `brown_news` scraper-drift fix (ready since 2026-08-21).
- #29 (2026-08-30) independently re-derives the same fix as #21 — the **fifth** time this routine has re-solved an already-fixed defect because the canonical fix sits unmerged. Recommend closing #29 in favor of #21 once triaged.

**Re-deriving already-solved fixes, not finding new defects, remains the primary cost of running this routine daily while the backlog sits unreviewed.**

## Single most important next action

**Merge #21** (clears the 27/27 daily-refresh red streak) and flip **Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"** (clears the `arcgis` leg, #25). Both are zero-risk, already tested, and have been sitting ready since 2026-08-19 and 2026-08-23 respectively — 12 and 8 days now.

## Overall verdict: AMBER

The web app, live-polled sources, and upcoming-events count are all healthy
in substance — today's only new event (a several-hour Poll cron stall) was
cleared by a manual dispatch within the session, no code was at fault. The
standing risk is unchanged and now the most severe fact in this report: 23
days and a 19-PR review backlog, including two zero-risk tested fixes, sitting
completely unmerged. That backlog — not missing engineering — is what stands
between this repo and green.

---
_Generated by [Claude Code](https://claude.ai/code)_
