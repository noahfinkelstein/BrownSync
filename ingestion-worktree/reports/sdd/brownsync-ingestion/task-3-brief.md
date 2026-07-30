# Task 3: Recorded source evidence

## Context

This packet captures the real upstream responses that every later parser task
(4–8) tests against. Capture is LIVE network access to public Brown pages and
endpoints — permitted and expected for this task — and every byte flows
through the Task 2A `CachedHttpClient` so etiquette (exact UA, one request per
second per host, retry/backoff, on-disk caching) is enforced by production
code, not by the harness. The output is a fixture tree plus a manifest that
later tasks and the integrity test treat as the only legitimate source of
recorded evidence. This task establishes parser evidence only; it makes no
data-completeness claim for any source.

## Binding constraints

- Work only in `/Users/noah_finkelstein/Developer/BrownSync/ingestion-worktree`.
- Edit only the files listed below, this brief, the task report, and the
  progress ledger. `pyproject.toml`/`uv.lock` may change only to add
  dependencies actually needed by the harness.
- All capture goes through `CachedHttpClient` with contact email
  `noah_finkelstein@brown.edu`, producing the exact UA
  `BrownSync/1.0 (+noah_finkelstein@brown.edu)`. No direct `httpx`/`urllib`
  fetches in the harness.
- The capture cache directory lives outside the repository (scratch space);
  only scrubbed fixture bodies and the manifest are committed.
- Scrub stored bodies: every email address is replaced with
  `scrubbed@example.invalid` (instructor *names* in public CAB listings stay,
  per contract; instructor/contact email addresses do not). No cookies,
  session tokens, or request/response headers are stored in fixtures.
- Recorded SHA-256 values are computed over the stored (post-scrub) bytes.
- If a source is unreachable after the client's polite retries, capture what
  is available, record the gap explicitly in `manifest.json` `gaps` and in the
  report, and never fabricate a fixture.
- Tests are offline: the integrity test only reads committed files and must be
  RED before `ingest/fixtures/manifest.json` exists in final form.
- Run uv with `UV_CACHE_DIR=/private/tmp/brownsync-uv-cache`.
- Do not stage, commit, or push until the finish step; commit stages explicit
  paths only.

## Files

- Create `ingest/brownsync_ingest/fixtures_capture.py` (capture harness)
- Create `ingest/fixtures/manifest.json`
- Create `ingest/fixtures/recorded/**` (fixture bodies)
- Create `ingest/tests/test_fixtures.py` (integrity test)
- Modify `ingest/pyproject.toml` / `ingest/uv.lock` only if the harness needs
  new dependencies (HTML link/option extraction)

## Capture inventory (minimums)

| Source key | Route | Minimum |
|---|---|---|
| `cab_home` | `GET https://cab.brown.edu/` | 1 (must contain the Fall 2026 srcdb evidence) |
| `cab_bootstrap` | bootstrap JSON discovered from the home page, if a distinct endpoint exists | 1 or an explicit note that bootstrap data is embedded in the home document |
| `cab_search` | `POST https://cab.brown.edu/api/?page=fose&route=search` with the exact §5 payload | 2 distinct subjects |
| `cab_details` | `POST https://cab.brown.edu/api/?page=fose&route=details` with the exact §5 payload | 20 distinct CRNs, drawn across subjects and diverse `meets` strings (incl. TBA/arranged when present) |
| `clubs_undergraduate` | `GET https://studentactivities.brown.edu/student-groups/undergraduate-student-groups` + discovered pagination | every pager page |
| `clubs_graduate` | graduate directory page(s) discovered from the same site | 1 page or explicit gap |
| `livewhale_events` | `GET https://events.brown.edu/live/json/events` (bounded with `?max=`) | 1 |
| `livewhale_groups` | LiveWhale groups listing (`/live/json/groups` or discovered equivalent) | 1 or explicit gap |
| `overpass_buildings` | `POST https://overpass-api.de/api/interpreter` with the exact §5 College Hill query | 1 |
| `dining_landing` | `GET https://dining.brown.edu/` | 1 |
| `dining_bundle` | same-host script/config bundles referenced by the landing page | 1 or explicit gap |

Fixture bodies live under `ingest/fixtures/recorded/<source dir>/<name>` with
stable, descriptive names (`cab/details/<srcdb>-<crn>.json`,
`clubs/undergraduate-page-00.html`, ...).

## Manifest schema (v1)

`ingest/fixtures/manifest.json`:

```json
{
  "schema_version": 1,
  "generated_at": "<UTC ISO Z>",
  "recorded_user_agent": "BrownSync/1.0 (+noah_finkelstein@brown.edu)",
  "notes": ["free-form capture notes"],
  "gaps": [{"source": "<source key>", "reason": "<non-empty>"}],
  "fixtures": [
    {
      "path": "recorded/...",
      "source": "<source key>",
      "route": "GET|POST <normalized url>",
      "request_body": null | <JSON body as sent>,
      "request_fingerprint": "<64-hex CachedHttpClient cache fingerprint>",
      "retrieved_at": "<UTC ISO Z>",
      "status": 200,
      "content_type": "<response content-type>",
      "sha256": "<64-hex of stored bytes>",
      "bytes": <stored length>,
      "scrubbed": <bool — true when scrubbing changed bytes>,
      "expected": {"body_contains": ["..."], ...parser facts}
    }
  ]
}
```

`request_fingerprint` is computed with the same identity function the client
uses for its cache (method, normalized URL, body, non-sensitive headers), so a
fixture can always be tied back to a real client request. `expected` carries
per-fixture parser facts (counts, sample CRNs/titles/names, element counts)
plus `body_contains` strings the integrity test verifies against the stored
bytes.

## Integrity test behavior to prove (`ingest/tests/test_fixtures.py`)

- The manifest exists, parses, and is schema v1 with the exact recorded UA.
- Every manifest entry's file exists, is non-empty, and matches `sha256` and
  `bytes` exactly.
- Every file under `ingest/fixtures/recorded/**` is manifested — no
  unmanifested fixture can ride along, and no manifest entry may point outside
  `recorded/`.
- Paths and request fingerprints are unique; fingerprints are 64-char hex;
  `retrieved_at` parses as timezone-aware UTC and is not in the future;
  `status` is 200; routes are `GET`/`POST` on `https://` URLs.
- Every `expected.body_contains` string occurs in the stored bytes.
- Coverage gate blocking silent synthetic substitution: each source key in the
  inventory table is either present with its minimum count (20 distinct CRNs
  for `cab_details`) or named in `gaps` with a non-empty reason. Absences are
  loud, never silent.
- Scrub gate: no fixture body contains an email address other than
  `scrubbed@example.invalid`.

## Required test cycle

1. Write `ingest/tests/test_fixtures.py` first. Run
   `cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_fixtures.py -q`
   — RED because `ingest/fixtures/manifest.json` does not exist.
2. Implement the harness; run live capture through `CachedHttpClient`; write
   fixtures + manifest.
3. Re-run the same command — GREEN.
4. `cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest -q`
   — full suite green (previously 169 collected: 162 passed + 7
   postgres-skipped, plus the new fixture tests).

## Report

Write `reports/sdd/brownsync-ingestion/task-3-report.md` with changed files,
the capture inventory actually recorded (counts per source), explicit gaps,
exact RED/GREEN commands/output, totals, self-review, and concerns. Append the
Task 3 ledger lines to `progress.md`.
