# Task 2A Report: Cache-first HTTP etiquette and atomic checkpoints

Date: 2026-07-28

## Status

Complete. The ingestion package now has its single cache-first HTTP boundary
and job-scoped atomic checkpoint store. No files were staged, committed, or
changed outside the Task 2A brief.

## Changed files

- `ingest/pyproject.toml`
- `ingest/uv.lock`
- `ingest/brownsync_ingest/common/__init__.py`
- `ingest/brownsync_ingest/common/http.py`
- `ingest/brownsync_ingest/common/checkpoint.py`
- `ingest/tests/common/__init__.py`
- `ingest/tests/common/test_http.py`
- `ingest/tests/common/test_checkpoint.py`
- `reports/sdd/brownsync-ingestion/task-2a-report.md`

## Implementation

- `CachedHttpClient` validates its contact address and always applies the exact
  BrownSync user agent. Its request identity normalizes method, URL, body, and
  non-sensitive headers; it never serializes request secrets.
- Successful responses are stored as SHA-256-named metadata/body pairs using
  flushed, fsynced sibling temporary files and `os.replace`. Missing or bad
  pairs are cache misses. Reconstructed hits retain status, body, content type,
  ETag, Last-Modified, request method, and URL.
- It enforces a per-normalized-host/port one-second interval for uncached
  transport attempts, including retries. Transient transport/status failures
  use exponential backoff and numeric `Retry-After`; permanent client failures
  raise immediately and are never cached.
- `CheckpointStore` validates safe lower-kebab job names and finite JSON-only
  state. It writes its versioned envelope via a flushed, fsynced sibling
  temporary file and replacement; loading invalid evidence returns `None`
  without removing it.

## TDD evidence

### HTTP RED

The first required invocation needed the new `httpx` dependency. Its sandboxed
attempt could not resolve PyPI, so the same required command was rerun with
approved package download access. It failed for the expected missing-module
reason before implementation:

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/common/test_http.py -q
E   ModuleNotFoundError: No module named 'brownsync_ingest.common'
1 error in 0.52s
```

### HTTP GREEN

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/common/test_http.py -q
.....................                                                    [100%]
21 passed in 0.18s
```

### Checkpoint RED

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/common/test_checkpoint.py -q
E   ModuleNotFoundError: No module named 'brownsync_ingest.common.checkpoint'
1 error in 0.05s
```

### Checkpoint GREEN

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/common/test_checkpoint.py -q
................                                                         [100%]
16 passed in 0.06s
```

## Final regression

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_contract.py tests/test_policy.py tests/test_output.py tests/common -q
........................................................................ [ 67%]
...................................                                      [100%]
107 passed in 0.13s
```

## Self-review

- Tests use only `httpx.MockTransport`, fake monotonic/wall clocks, and fake
  sleepers; they make no real HTTP request and do not wait in real time.
- Tested invalid contacts, UA protection, sensitive-header exclusion, cache
  reconstruction and freshness, force refresh, incomplete entries, failed
  refresh preservation, host-scoped spacing, retry statuses/errors, numeric
  Retry-After, permanent client errors, and non-cacheable failures.
- Tested checkpoint envelopes, mismatch/corruption handling, safe job names,
  finite JSON validation, replacement failure preservation, and idempotent
  selective clearing.
- Confirmed the dependency lock contains the declared `httpx` package and the
  exact requested combined suite passes.

## Concerns

- A two-file cache entry cannot be atomically replaced as one filesystem object;
  the reader deliberately treats a missing/incomplete pair as a cache miss.
  Each individual metadata/body write is itself fsynced and atomically replaced.
- Atomic replacement assumes the temporary file and destination remain on the
  same filesystem, as they do because both use the cache/checkpoint directory.

## Fix Round 1 — Cache commit integrity, credential isolation, and scheduling

Date: 2026-07-28

### Findings addressed

1. Cache writes now create a generation-specific body first and atomically
   replace only metadata as the commit pointer. A metadata replacement failure
   removes the new uncommitted generation and leaves the prior metadata/body
   pair readable.
2. Requests containing sensitive credential headers (including API-key/token
   equivalents) bypass cache reads and writes completely. Their values remain
   absent from all metadata.
3. Committed metadata now records a generation body filename, byte length, and
   SHA-256 digest. Cache loads reject missing, truncated, or altered bodies.
4. A per-host lock covers scheduling and the transport attempt, preventing
   concurrent same-host callers (including retries) from violating the interval.
5. Retry orchestration now uses the locked `tenacity` dependency while retaining
   four total attempts, exponential backoff, numeric `Retry-After`, and the
   existing retry/status policy.

### Covering tests

- `test_cache_identity_has_independent_method_url_json_content_and_header_components`
- `test_credentialed_requests_bypass_cache_without_persisting_secret_values`
- `test_corrupt_cached_body_is_rejected_and_refetched`
- `test_metadata_commit_failure_keeps_the_prior_complete_cache_entry`
- `test_transient_exhaustion_uses_all_four_attempts_and_exponential_backoff`
- `test_concurrent_same_host_requests_are_scheduled_one_second_apart`

### Focused HTTP RED

Before the production fix, the focused suite demonstrated the credential
cross-user cache hit, corrupt-body cache hit, and failed-refresh body swap:

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/common/test_http.py -q
......................FFF..                                              [100%]
3 failed, 24 passed in 0.20s
```

The failures were respectively `account-1` returned instead of `account-2`,
`b'truncated'` returned instead of a refetched body, and `b'new'` returned
through old metadata after an injected metadata replacement failure.

### Focused HTTP GREEN

The first sandboxed GREEN attempt could not resolve the newly declared
`tenacity` package. The same command was then run with approved package access:

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/common/test_http.py -q
...........................                                              [100%]
27 passed in 0.12s
```

### Equivalent credential-header RED/GREEN

The credential cache-bypass test was expanded after the initial fix to include
the `X-Api-Key` credential equivalent. It first failed under the narrower
three-header classification, then passed after the cache bypass and identity
filter were extended:

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/common/test_http.py::test_credentialed_requests_bypass_cache_without_persisting_secret_values -q
...F                                                                     [100%]
1 failed, 3 passed in 0.15s

$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/common/test_http.py -q
..............................                                           [100%]
30 passed in 0.11s
```

### Final regression

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/test_contract.py tests/test_policy.py tests/test_output.py tests/common -q
........................................................................ [ 62%]
............................................                             [100%]
116 passed in 0.13s
```

### Fix Round 1 self-review

- The cache reader accepts only the metadata-selected generation whose body
  digest and length match; a failed write cannot make a newer body visible via
  older metadata.
- Credentialed calls neither use nor replace a shared cache entry.
- The host lock surrounds both rate scheduling and network transport, while
  locks remain independent across hosts.
- All retry delays continue through the injected sleeper, so tests use no real
  network or real sleeps.

### Fix Round 1 concerns

- Superseded generation body files are intentionally retained after a later
  successful refresh. They are unreachable and safe, but a future bounded
  garbage-collection policy could reclaim them if cache size becomes material.
