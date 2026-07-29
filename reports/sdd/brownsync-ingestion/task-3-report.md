# Task 3 Report: Recorded source evidence

Date: 2026-07-28

## Status

Complete with explicit gaps. Live capture ran through the production
`CachedHttpClient` (exact UA `BrownSync/1.0 (+noah_finkelstein@brown.edu)`,
one request per second per host, retry/backoff, on-disk caching). LiveWhale
events, LiveWhale groups, and Overpass College Hill building geometry were
recorded and manifested. CAB and the two Pantheon-hosted Drupal directories
(student activities, dining) actively refuse the mandated non-browser client:
CAB answers every route with an AWS WAF JavaScript bot challenge and Pantheon
answers 403 at the edge. Bypassing bot-detection is not permitted, so those
sources are recorded as explicit manifest gaps — no synthetic fixture was
fabricated, and the new integrity test makes silent substitution impossible.
This task claims parser evidence only, not data completeness.

## Changed files

- `ingest/brownsync_ingest/fixtures_capture.py` (new capture harness)
- `ingest/fixtures/manifest.json` (new)
- `ingest/fixtures/recorded/livewhale/events.json` (new, 3,119,877 bytes)
- `ingest/fixtures/recorded/livewhale/groups.json` (new, 39,217 bytes)
- `ingest/fixtures/recorded/overpass/college-hill-buildings.json` (new, 1,937,642 bytes)
- `ingest/tests/test_fixtures.py` (new integrity gate)
- `ingest/pyproject.toml` / `ingest/uv.lock` (added `beautifulsoup4` for
  option/pager/script-src extraction; `lxml` deferred to the first parser task)
- `reports/sdd/brownsync-ingestion/task-3-brief.md`
- `reports/sdd/brownsync-ingestion/task-3-report.md`
- `reports/sdd/brownsync-ingestion/progress.md`

## Capture inventory

| Source | Result | Detail |
|---|---|---|
| `livewhale_events` | recorded | `GET https://events.brown.edu/live/json/events?max=200` — strict JSON, 1,000 events, coordinates/group/`event_types`/`is_canceled`/`repeats` fields confirmed |
| `livewhale_groups` | recorded | `GET https://events.brown.edu/live/json/groups` — 218 groups with `id`/`title`/`fullname`/`web_address`/`timezone` |
| `overpass_buildings` | recorded | exact contract §5 query; 2,155 elements (2,150 ways, 5 relations); `Sayles Hall` and `Barus` present; ODbL attribution noted in manifest |
| `cab_home`, `cab_bootstrap`, `cab_search`, `cab_details` | **gap** | every `cab.brown.edu` route (home and FOSE API) answers HTTP 202 with `x-amzn-waf-action: challenge` (AWS WAF JavaScript challenge) for the mandated UA; bot-detection is never bypassed |
| `clubs_undergraduate`, `clubs_graduate` | **gap** | `studentactivities.brown.edu` (server: Pantheon, via varnish) answers 403 Forbidden at the edge for the mandated UA, with or without standard browser `Accept` headers |
| `dining_landing`, `dining_bundle` | **gap** | `dining.brown.edu` — same Pantheon edge 403 |

All eight gaps are entries in `manifest.json` `gaps` with single-line reasons;
the integrity test requires every required source to be either present at its
minimum count or declared there.

## Implementation

- `fixtures_capture.py` is a live-network harness (never imported by tests).
  `CaptureSession` wraps `CachedHttpClient` with a wide-timeout transport
  (Overpass runs a 60-second server-side query), follows up to five redirects
  manually (the client treats 3xx as errors), and refuses to store anything
  that is not a plain 200: a `x-amzn-waf-action` header or a challenge-shaped
  202 raises `CaptureBlockedError`, which the per-group wrapper converts into
  explicit gaps for every uncaptured source key of that group.
- Each fixture's manifest entry is built completely — including expected
  parser facts — before any bytes touch disk, so a failing fact-builder can
  never leave an unmanifested file behind (an early defect the integrity test
  caught during development).
- The manifest records route, request body (for POSTs), the client's own
  cache fingerprint (computed with the client's identity helper over method,
  normalized URL, body, and non-sensitive headers), UTC retrieval time,
  SHA-256 and length of the stored bytes, a scrub flag, and per-fixture
  expected facts anchored by `body_contains` strings.
- Scrubbing: every email-like string is replaced with
  `scrubbed@example.invalid`, preserving a leading JSON escape letter when the
  match starts inside an escape sequence (the naive replacement corrupted
  `\n<email>` into an invalid `\s` escape and broke the stored JSON — found
  and fixed during capture). LiveWhale `contact_info` values (staff
  names/titles; no contract field consumes them) are blanked wholesale before
  the email scrub. No request or response headers, cookies, or tokens are
  stored.
- `tests/test_fixtures.py` verifies: manifest schema v1 with the exact
  recorded UA; per-entry byte-for-byte hash/length match; no unmanifested
  file anywhere under `recorded/**` and nothing stray beside the manifest;
  unique paths/fingerprints; well-formed fingerprints, hashes, routes,
  statuses, and timezone-aware non-future retrieval times; POST entries carry
  their request body; every `body_contains` anchor present in the stored
  bytes; required-source minimums (20 distinct CRNs for `cab_details`) unless
  explicitly gapped; and an independent email scan of every stored body.

## TDD evidence

### Integrity RED (before any manifest existed)

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_fixtures.py -q
E           Failed: fixture manifest is missing: /Users/noah_finkelstein/Developer/BrownSync/ingestion-worktree/ingest/fixtures/manifest.json
8 errors in 0.14s
```

### Integrity GREEN (after live capture)

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_fixtures.py -q
SKIPPED [1] tests/test_fixtures.py:161: cab_details declared as an explicit gap
7 passed, 1 skipped in 0.12s
```

The single skip is the CRN-distinctness check, which only applies when
`cab_details` fixtures exist; it activates automatically once the CAB gap is
closed.

The integrity test also went RED mid-task for real cause twice: once when a
fact-builder crash left `recorded/livewhale/events.json` on disk unmanifested
(unmanifested-file check), and once when the email scan flagged the
scrubber's own escape-corruption artifact. Both harness defects were fixed
and capture re-run.

## Final regression

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest -q
169 passed, 8 skipped in 0.31s
```

Totals: 177 collected — 169 passed, 7 postgres-marked skips pending a
database, 1 fixture skip pending the CAB gap. The prior 162 offline tests all
still pass.

## Self-review

- Every recorded byte flowed through `CachedHttpClient`; the harness contains
  no direct HTTP path. Etiquette during capture: at most one request per
  second per host, four attempts with exponential backoff, all responses
  cached in a scratch directory outside the repository.
- No fixture was fabricated, edited by hand, or downgraded from an error
  page: only plain 200 bodies are storable, and challenge responses raise
  before the write path.
- The unmanifested-file and hash checks were observed catching real defects
  during this task (see TDD evidence), so the gate is demonstrably active,
  not decorative.
- Stored bodies were re-scanned independently by the test for email leakage;
  `contact_info` blanking was verified to leave exactly one distinct value
  (`[contact scrubbed]`) across all 650 non-null occurrences.
- Parser-relevant findings recorded in manifest notes: LiveWhale ignores the
  documented `?max=` filter (returned 1,000 events for `?max=200`), and the
  events feed uses `\/` escaping with embedded HTML fragments in text fields.
- Overpass output carries the ODbL/OpenStreetMap attribution note required by
  the plan.

## Concerns

- **CAB is the critical gap**: Task 6 needs 20+ real detail fixtures and
  cannot proceed on synthetic data. Closing it needs one of: an allowlist/
  robots arrangement with Brown OIT for the `BrownSync/1.0` UA, or a
  user-driven capture session (a human completing the WAF challenge in their
  own browser) whose responses are then fingerprinted into this manifest.
  That decision belongs to the controller/user, not this worker.
- The clubs (Task 7 needs 400+ organizations) and dining (Task 8) gaps have
  the same shape: Pantheon's edge rejects the mandated UA before Drupal ever
  sees the request. Same remediation options as CAB.
- `CachedHttpClient` caches any 2xx, including AWS WAF challenge 202s, so a
  challenged host replays its challenge from cache even after the WAF cools
  off. The harness detects challenge-shaped 202s regardless, but the Task 2
  owner may want to restrict caching to status 200 (not changed here — out of
  this packet's file scope).
- The manifest fingerprint for a redirected capture is computed against the
  final URL with the original body; a 303-downgraded POST would fingerprint
  as its GET equivalent. No recorded fixture involved a redirect, so this is
  latent-only, documented for the next reviewer.
- LiveWhale `?max=` not being honored means the events fixture is a full
  1,000-event window; fine as parser evidence, but Task 7/9 rate-budget
  math should not assume `max` works for pagination.
