# Task 2A: Cache-first HTTP etiquette and atomic checkpoints

## Context

This packet creates the only network boundary used by later source adapters and the resumable state store used by CAB. It must be fully testable without real network or real sleep.

## Binding constraints

- Work only in `/Users/noah_finkelstein/Developer/BrownSync/ingestion-worktree`.
- Edit only the files listed below and the task report.
- Do not stage, commit, switch branches, or touch app-side files.
- Every outbound request uses exact UA `BrownSync/1.0 (+<contact email>)`.
- No host receives more than one uncached request per second.
- Transient failures retry with exponential backoff; permanent 4xx failures do not.
- Successful responses are cached on disk so ordinary reruns perform no network request.
- LiveWhale callers can require a ten-minute freshness window; repeated calls during that window perform no network request.
- Tests use `httpx.MockTransport`, fake clock, and fake sleeper only. No test may reach the network or wait in real time.
- Strict TDD with recorded RED/GREEN evidence is required.
- Run uv with `UV_CACHE_DIR=/private/tmp/brownsync-uv-cache` in this sandbox.

## Files

- Modify `ingest/pyproject.toml`
- Modify `ingest/uv.lock`
- Create `ingest/brownsync_ingest/common/__init__.py`
- Create `ingest/brownsync_ingest/common/http.py`
- Create `ingest/brownsync_ingest/common/checkpoint.py`
- Create `ingest/tests/common/__init__.py`
- Create `ingest/tests/common/test_http.py`
- Create `ingest/tests/common/test_checkpoint.py`

## Exact HTTP interface

```python
class CachedHttpClient:
    def __init__(
        self,
        *,
        contact_email: str,
        cache_dir: Path,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], datetime] = utc_now,
        sleeper: Callable[[float], None] = time.sleep,
        min_interval_seconds: float = 1.0,
        max_attempts: int = 4,
    ) -> None: ...

    def request(
        self,
        method: str,
        url: str,
        *,
        json_body: JsonValue | None = None,
        content: bytes | None = None,
        headers: Mapping[str, str] | None = None,
        max_age_seconds: float | None = None,
        force_refresh: bool = False,
    ) -> httpx.Response: ...

    def get(self, url: str, **kwargs: object) -> httpx.Response: ...
    def post(self, url: str, **kwargs: object) -> httpx.Response: ...
```

`max_age_seconds=None` means a successful cache entry remains reusable indefinitely. LiveWhale passes `600`. `force_refresh=True` bypasses a cache hit but still obeys rate limits and then replaces the cache entry.

## Exact HTTP behavior

1. Reject empty, newline-bearing, or non-email contact values before constructing a client.
2. User-supplied headers cannot override `User-Agent`.
3. Canonical cache identity includes uppercased method, normalized URL, JSON body or content bytes, and non-sensitive request headers. It never persists `Authorization`, `Cookie`, proxy credentials, or other secret header values.
4. Cache layout uses a SHA-256 filename, a JSON metadata file, and a binary body file. Metadata contains status, selected response headers, retrieval UTC timestamp, and request fingerprint, but no sensitive headers.
5. Cache writes use sibling temporary files, flush/fsync, and `os.replace`; an incomplete pair is ignored.
6. Cache only successful `2xx` responses. Cache hits reconstruct an `httpx.Response` with request URL/method and exact body/status/content-type/ETag/Last-Modified values.
7. Rate limiting is per normalized host/port within the client. The first request is immediate. Before each later transport attempt, sleep only the remaining portion of one second. Retries count as requests and are rate-limited.
8. Retry `httpx.TransportError` and statuses `429, 500, 502, 503, 504` up to four total attempts with exponential delays. Honor numeric `Retry-After` when it is longer. Do not retry other 4xx.
9. After retries, raise `httpx.HTTPStatusError` for non-success responses.
10. A fresh cache hit performs no clock sleep and no transport call.

## Exact checkpoint interface

```python
class CheckpointStore:
    def __init__(self, root: Path) -> None: ...
    def load(self, job: str, fingerprint: str) -> dict[str, JsonValue] | None: ...
    def save(
        self,
        job: str,
        fingerprint: str,
        state: Mapping[str, JsonValue],
    ) -> None: ...
    def clear(self, job: str) -> None: ...
```

Checkpoint JSON contains `version: 1`, `job`, `fingerprint`, and `state`. Reject unsafe job names. A fingerprint mismatch, corrupt JSON, wrong version, or wrong job returns `None` without deleting evidence. Save validates JSON-safety, writes atomically through a sibling temp file, flushes/fsyncs, and leaves the previous checkpoint unchanged on failure. `clear` is idempotent.

## Required tests

### HTTP

- invalid contact values;
- exact non-overridable UA;
- cache key changes for method/URL/body/relevant header and ignores sensitive header values in metadata;
- successful first call then zero-call cache hit with response reconstruction;
- expired `max_age_seconds=600` refresh and fresh LiveWhale cache no-call behavior;
- `force_refresh`;
- first-call immediate, same-host one-second spacing, different-host independence, retry attempts rate-limited;
- retry matrix for transport error/429/500/502/503/504;
- numeric Retry-After;
- no retry for 400/401/403/404;
- non-2xx never cached;
- interrupted/incomplete cache ignored; failed refresh preserves last complete cache entry.

### Checkpoints

- round-trip and exact envelope;
- fingerprint/version/job mismatch and corrupt JSON return `None`;
- unsafe job names rejected;
- state must be JSON-safe and finite;
- atomic replacement preserves prior checkpoint on injected failure;
- clear removes only the named checkpoint and is idempotent.

## Required test cycle

1. `cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/common/test_http.py -q` — RED then GREEN.
2. `cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/common/test_checkpoint.py -q` — RED then GREEN.
3. `cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_contract.py tests/test_policy.py tests/test_output.py tests/common -q` — final regression run.

## Report

Write `reports/sdd/brownsync-ingestion/task-2a-report.md` with changed files, exact RED/GREEN commands and output, test totals, self-review, and concerns. Do not edit the ledger.
