# Task 1 Report: Contract Rows, Policy Checks, and Atomic NDJSON Publication

Date: 2026-07-28

## Status

Complete. Task 1 contract, policy, and output behavior aligns with the binding
brief, and the exact combined suite passes.

No files were staged or committed.

## Files

### Inherited and inspected

- `ingest/pyproject.toml`
- `ingest/.gitignore`
- `ingest/uv.lock`
- `ingest/brownsync_ingest/__init__.py`
- `ingest/brownsync_ingest/contract.py`
- `ingest/brownsync_ingest/policy.py`
- `ingest/tests/test_contract.py`
- `ingest/tests/test_policy.py`
- `ingest/tests/test_output.py`

### Added in this continuation

- `ingest/brownsync_ingest/output.py`
- `reports/sdd/brownsync-ingestion/task-1-report.md`

## Brief Alignment

The inherited contract implementation was checked against `DATA_CONTRACT.md`
sections 1 and 6 and the Task 1 brief:

- All five required row models inherit a strict Pydantic v2 base with unknown
  fields forbidden.
- Contract fields, defaults, optional database-default fields, literal values,
  and absence of `OrganizationRow.raw` match the brief.
- Event and source-run datetimes reject naive values and normalize aware values
  to UTC.
- List defaults use independent factories.
- Course day tokens enforce non-empty, unique canonical ordering while
  consuming `Th` and `Su` before one-character tokens.
- Raw JSON fields use Pydantic `JsonValue`.
- Slug, coordinate, confidence, polygon, and CAB temporal checks remain in
  policy functions rather than Pydantic construction.

The added output implementation:

- Materializes and validates every input as the requested model before creating
  destination or staging artifacts.
- Uses non-null IDs as `("id", value)` and ID-less event source pairs as
  `("event", source, source_id)`.
- Rejects duplicate identities before publication.
- Sorts rows deterministically by identity.
- Serializes with `model_dump(mode="json", exclude_none=True)` as compact UTF-8
  NDJSON.
- Writes beneath the supplied staging root, flushes, fsyncs, and calls
  `os.replace`.
- Removes its staging file after success or failure.
- Leaves an existing destination unchanged on validation, duplicate, staging
  write, or replacement failure.
- Makes an atomicity claim for one destination file only.

## TDD Evidence

### Inherited contract suite

The contract implementation and tests were already present when this
continuation began. Their original RED cycle was not recreated because doing so
would require removing inherited production code. Fresh current-state evidence:

```text
$ cd ingest && uv run pytest tests/test_contract.py -q
...........................                                              [100%]
27 passed in 0.06s
```

### Inherited policy suite

The policy implementation and tests were already present when this continuation
began. Their original RED cycle was not recreated because doing so would require
removing inherited production code. Fresh current-state evidence:

```text
$ cd ingest && uv run pytest tests/test_policy.py -q
.............................                                            [100%]
29 passed in 0.05s
```

### Output RED

Before `output.py` was added, the required test command failed for the expected
missing-module reason:

```text
$ cd ingest && uv run pytest tests/test_output.py -q
==================================== ERRORS ====================================
____________________ ERROR collecting tests/test_output.py _____________________
tests/test_output.py:12: in <module>
    from brownsync_ingest.output import model_identity, publish_ndjson
E   ModuleNotFoundError: No module named 'brownsync_ingest.output'
=========================== short test summary info ============================
ERROR tests/test_output.py
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
1 error in 0.12s
```

The first sandboxed invocation could not initialize the external uv cache and
did not reach pytest. The authorized rerun above is the canonical RED evidence.

### Output GREEN

After the minimal implementation:

```text
$ cd ingest && uv run pytest tests/test_output.py -q
.......                                                                  [100%]
7 passed in 0.25s
```

### Final combined suite

```text
$ cd ingest && uv run pytest tests/test_contract.py tests/test_policy.py tests/test_output.py -q
...............................................................          [100%]
63 passed in 0.06s
```

## Totals

- Contract: 27 passed
- Policy: 29 passed
- Output: 7 passed
- Combined: 63 passed, 0 failed, 0 errors

## Self-review

- Re-read the brief and relevant data-contract sections after inspecting the
  inherited files.
- Confirmed validation and duplicate detection happen before filesystem
  mutation.
- Confirmed deterministic ordering and compact non-ASCII-preserving JSON.
- Confirmed the staging file is closed before replacement, fsynced before
  replacement, and cleaned in a `finally` block.
- Confirmed failure tests preserve the prior destination byte-for-byte.
- Ran the exact individual and combined commands required by the brief.
- Confirmed no Task 1 regression required changes to inherited contract or
  policy code.

## Concerns

- `os.replace` is atomic only when the supplied staging root and destination are
  on the same filesystem. The prescribed repository paths satisfy that
  deployment assumption; a cross-filesystem staging root will fail without
  replacing the existing destination.
- This task intentionally guarantees atomicity per file, not across a set of
  seed files.

## Fix Round 1 — Important Review Findings

Date: 2026-07-28

### Scope and fixes

1. Raw JSON now rejects `NaN`, positive infinity, and negative infinity
   recursively in both `EventRow.raw` and `CourseMeetingRow.raw`.
   `publish_ndjson` also sets `allow_nan=False`, so even an unchecked model
   instance cannot emit non-standard JSON or replace an existing seed.
2. The polygon policy now validates the nested structure of plain 2D
   `MULTIPOLYGON` WKT without adding Shapely. It requires numeric coordinate
   pairs, at least four coordinates per ring, finite numbers, closed rings, and
   valid polygon/ring nesting.
3. The original contract and policy RED evidence was recovered from the prior
   Task 1 execution and is recorded below. The earlier statement that those RED
   cycles could not be recovered is superseded by this section.

### Covering tests

- `test_raw_json_rejects_non_finite_numbers_recursively`
- `test_publisher_refuses_non_finite_json_and_preserves_existing_seed`
- `test_polygon_policy_accepts_plain_multipolygon_and_null`
- `test_polygon_policy_rejects_non_plain_multipolygon_wkt`
- `test_polygon_policy_rejects_malformed_content_inside_wrapper`

### Finite JSON and output RED

```text
$ cd ingest && uv run pytest tests/test_contract.py::test_raw_json_rejects_non_finite_numbers_recursively tests/test_output.py::test_publisher_refuses_non_finite_json_and_preserves_existing_seed -q
FFFF                                                                     [100%]
FAILED tests/test_contract.py::test_raw_json_rejects_non_finite_numbers_recursively[nan]
FAILED tests/test_contract.py::test_raw_json_rejects_non_finite_numbers_recursively[inf]
FAILED tests/test_contract.py::test_raw_json_rejects_non_finite_numbers_recursively[-inf]
FAILED tests/test_output.py::test_publisher_refuses_non_finite_json_and_preserves_existing_seed
4 failed in 0.18s
```

The contract cases failed with `Failed: DID NOT RAISE ValidationError`; the
publisher case failed with `Failed: DID NOT RAISE ValueError`. This confirmed
that both construction and serialization accepted non-finite JSON before the
production changes.

### Finite JSON and output GREEN

```text
$ cd ingest && uv run pytest tests/test_contract.py::test_raw_json_rejects_non_finite_numbers_recursively tests/test_output.py::test_publisher_refuses_non_finite_json_and_preserves_existing_seed -q
....                                                                     [100%]
4 passed in 0.11s
```

### MULTIPOLYGON structure RED

```text
$ cd ingest && uv run pytest tests/test_policy.py::test_polygon_policy_rejects_malformed_content_inside_wrapper -q
FFF                                                                      [100%]
FAILED tests/test_policy.py::test_polygon_policy_rejects_malformed_content_inside_wrapper[MULTIPOLYGON((not-wkt))]
FAILED tests/test_policy.py::test_polygon_policy_rejects_malformed_content_inside_wrapper[MULTIPOLYGON(((0 0, 1 1, 0 0)))]
FAILED tests/test_policy.py::test_polygon_policy_rejects_malformed_content_inside_wrapper[MULTIPOLYGON(((0 0, 1 1, 1 0, 2 2)))]
3 failed in 0.15s
```

Each case failed with `Failed: DID NOT RAISE ValueError`, confirming that the
old wrapper-only regex accepted malformed content.

### MULTIPOLYGON structure GREEN

```text
$ cd ingest && uv run pytest tests/test_policy.py::test_polygon_policy_accepts_plain_multipolygon_and_null tests/test_policy.py::test_polygon_policy_rejects_non_plain_multipolygon_wkt tests/test_policy.py::test_polygon_policy_rejects_malformed_content_inside_wrapper -q
......                                                                   [100%]
6 passed in 0.08s
```

### Recovered original contract and policy TDD evidence

Recovered verbatim from the original Task 1 execution:

Contract RED: `cd ingest && uv run pytest tests/test_contract.py -q` -> `ModuleNotFoundError: No module named 'brownsync_ingest'` during collection; `1 error in 0.33s`.

Contract GREEN: `27 passed in 1.15s`.

Policy RED: `cd ingest && uv run pytest tests/test_policy.py -q` -> `ModuleNotFoundError: No module named 'brownsync_ingest.policy'` during collection; `1 error in 0.58s`.

Policy GREEN: `29 passed in 0.60s`.

### Fix Round 1 full verification

```text
$ cd ingest && uv run pytest tests/test_contract.py tests/test_policy.py tests/test_output.py -q
......................................................................   [100%]
70 passed in 0.07s
```

Fix Round 1 total: 70 passed, 0 failed, 0 errors.

### Fix Round 1 self-review and concerns

- The raw-number validator walks only JSON containers and does not move
  coordinate or confidence policy bounds into Pydantic construction.
- `allow_nan=False` independently protects the output boundary and the existing
  destination if validation is bypassed by an unchecked model instance.
- The WKT implementation is deliberately a structural 2D parser, not a full
  geometry/topology engine. It rejects malformed seed text without adding a
  Task 1 dependency; PostGIS remains responsible for deeper topology checks.
- No files were staged or committed.
