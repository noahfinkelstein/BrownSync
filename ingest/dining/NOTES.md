# Dining discovery — blocked, documented (Task 8)

Status: **BLOCKED at the network edge. No discovery ran.** Written
2026-07-29; supersedes nothing (this is the first dining artifact).

## Evidence of the block

During the Task 3 capture round (2026-07-28), `https://dining.brown.edu/`
answered **HTTP 403 Forbidden** from the Pantheon edge to the exact mandated
identity `BrownSync/1.0 (+noah_finkelstein@brown.edu)`, sent through the
production `CachedHttpClient` (polite retries, one-second host spacing).
Both dining sources are recorded as explicit gaps in
`ingest/fixtures/manifest.json`:

- `dining_landing` — "capture failed after polite retries: HTTPStatusError:
  Client error '403 Forbidden' for url 'https://dining.brown.edu/'"
- `dining_bundle` — same edge, same identity.

`studentactivities.brown.edu` (also Pantheon-fronted) rejects the same UA
the same way, so this is a platform-level bot policy, not a dining-specific
misconfiguration.

## Why no discovery ran in Task 8

The plan's discovery bullets (landing/script scan, API/GraphQL candidates,
one-hour/request-budget stop) all presuppose reachable pages. Working around
the 403 — browser impersonation, header spoofing, third-party mirrors —
would evade bot detection, which this workstream categorically does not do.
Zero requests were sent to `dining.brown.edu` in Task 8; the request budget
was never started. The stop condition is recorded as **blocked-at-edge**
rather than budget-exhausted or no-endpoint.

## What the user must provide to unblock

Either of:

1. **OIT allowlist** — ask Brown OIT (or the Pantheon site owner) to allow
   the UA `BrownSync/1.0 (+noah_finkelstein@brown.edu)` (or a registered
   alternative) for `dining.brown.edu`, after which Task 10 can run the
   documented discovery inside the one-hour/request-budget bounds; or
2. **Exported pages** — save the dining landing page plus any linked
   menu/hours pages or XHR/JSON responses from a normal browser session and
   drop them under `ingest/fixtures/user_provided/` (they will be
   hash-pinned in the manifest with provenance, exactly like the Fall 2026
   CAB CSV that fills the CAB WAF gaps).

## Why this does not block contract v1 output

- **Contract v1 has no dining-hours row.** DATA_CONTRACT.md defines no
  table or seed for menus/hours; even a proven endpoint would only be
  documented here, never published as rows.
- **The six fixed dining places are already seeded.** `db/seeds/places.ndjson`
  carries `sharpe-refectory`, `andrews-commons`, `verney-woolley-dining-hall`,
  `blue-room`, `ivy-room`, and `josiahs`, each with `kind="dining"`
  (published in Task 6B, republished unchanged in Task 8's 164-row
  regeneration).

The user-input dependency is registered in
`reports/app_side_dependencies.md`.
