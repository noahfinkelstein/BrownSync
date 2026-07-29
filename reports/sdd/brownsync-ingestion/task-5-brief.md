# Task 5: Resolver and place-resolution report

## Context

Task 4 produced the curated gazetteer (`aliases.yaml`, 148 places, globally
unique normalized aliases) and the catalog build. This packet adds the shared
place resolver that CAB (Task 6), clubs (Task 7), and athletics (Task 8) will
call, plus the place-resolution report generator that renders the >=90% CAB
section gate. Resolution follows `DATA_CONTRACT.md` §2 exactly: exact alias
match (case/punct-insensitive) first, then trigram similarity >= 0.55 against
names+aliases, else null with `location_raw` kept. Never guess below
threshold.

## Binding constraints

- Work only in `/Users/noah_finkelstein/Developer/BrownSync/ingestion-worktree`
  on branch `codex/ingestion`; edit only the files listed below plus the task
  report and ledger lines.
- Run uv with `UV_CACHE_DIR=/private/tmp/brownsync-uv-cache`.
- Tests are offline; the postgres-marked parity test skips without
  `TEST_DATABASE_URL` and Docker is not started here.
- Strict TDD with captured RED/GREEN evidence for every behavior.
- Fuzzy acceptance is a portable Python implementation of PostgreSQL
  `pg_trgm` `similarity()`; threshold `>= 0.55` is authoritative. RapidFuzz
  `token_set_ratio` ranks and is reported but can never veto a contract-valid
  trigram match.
- Golden parity vectors prove Python-vs-PostgreSQL `similarity()` agreement
  when a pg_trgm database is configured.
- Raw values are preserved byte-for-byte on every resolution outcome.

## Files

- Create `ingest/brownsync_ingest/gazetteer/resolver.py`
- Create `ingest/brownsync_ingest/gazetteer/report.py`
- Create `ingest/tests/gazetteer/conftest.py` (shared parity vectors)
- Create `ingest/tests/gazetteer/test_resolver.py`
- Create `ingest/tests/gazetteer/test_report.py`
- Create `ingest/tests/gazetteer/test_trigram_postgres.py` (postgres-marked)
- Modify `ingest/pyproject.toml` + `ingest/uv.lock` (add `rapidfuzz>=3,<4`)
- Write `reports/sdd/brownsync-ingestion/task-5-report.md`, append
  `reports/sdd/brownsync-ingestion/progress.md` ledger lines

## Exact interfaces

```python
# gazetteer/resolver.py
TRIGRAM_THRESHOLD = 0.55

def trigrams(text: str) -> frozenset[str]: ...
    # pg_trgm trigram set: lowercase, split words on non-alphanumerics
    # (underscore is a separator, as in C isalnum), pad each word with two
    # leading and one trailing space, take every 3-char window, dedupe.

def trigram_similarity(a: str, b: str) -> float: ...
    # |A ∩ B| / |A ∪ B|; 0.0 when either trigram set is empty
    # (mirrors pg_trgm cnt_sml's explicit empty guard).

@dataclass(frozen=True)
class Candidate:
    place_id: str
    alias: str            # curated alias that produced the best trigram score
    trigram: float        # authoritative score
    token_set_ratio: float  # RapidFuzz 0..100, rank/report only
    room: str | None      # room implied by the winning query variant

@dataclass(frozen=True)
class Resolution:
    query: str            # the raw value, preserved exactly
    place_id: str | None
    room: str | None
    method: str           # "exact" | "exact-room" | "trigram" | "unresolved"
    reason: str | None    # unresolved only: "empty-after-normalization" |
                          # "below-threshold" | "ambiguous"
    score: float | None   # trigram score of the accepted (or best) fuzzy
                          # candidate; None for exact/exact-room/empty
    candidates: tuple[Candidate, ...]  # fuzzy stage only; ranked by
                          # (token_set_ratio desc, trigram desc, place_id asc)

class PlaceResolver:
    def __init__(self, catalog: CuratedCatalog, *, threshold: float = TRIGRAM_THRESHOLD): ...
    @classmethod
    def from_files(cls, aliases_path: Path | None = None) -> "PlaceResolver": ...
    def resolve(self, value: str) -> Resolution: ...
```

```python
# gazetteer/report.py
@dataclass(frozen=True)
class ResolutionSample:
    source: str                 # "cab" | "clubs" | "athletics" | ...
    resolution: Resolution
    section_id: str | None = None  # required for source == "cab"

@dataclass(frozen=True)
class SourceStats:
    total: int
    resolved: int
    # hit_rate property: resolved / total

@dataclass(frozen=True)
class PlaceResolutionReport:
    by_source: mapping of source -> SourceStats
    method_counts / reason_counts: mapping of str -> int
    top_unresolved: tuple[(raw value, count), ...]  # count desc, value asc
    cab_sections_total/resolved, cab_section_rate: float | None
    cab_patterns_total/resolved, cab_pattern_rate: float | None
    gate_threshold: float
    gate_passed: bool | None    # None = no CAB sections observed

def build_report(samples, *, gate_threshold=0.90, top_unresolved_limit=20) -> PlaceResolutionReport
def render_markdown(report, *, generated_at: str | None = None) -> str
```

## Resolution pipeline (decisions)

1. Normalize the query with the Task 4 `normalize_alias` rules applied
   token-by-token over whitespace-separated raw tokens, tracking each
   normalized token's raw-token index, raw character offset, and position
   within its raw token. Empty normalization -> unresolved
   `empty-after-normalization`.
2. **Exact**: the full normalized token sequence matches a curated alias ->
   `method="exact"`, `room=None`. Exact runs before any room stripping, so
   address aliases like "85 Waterman Street" / "85 Waterman" never lose their
   leading number ("no-strip").
3. **Longest alias prefix + room** (`method="exact-room"`): scan prefix
   lengths from longest to shortest; the first prefix that is a curated alias
   and whose remainder "looks like a room" wins. Longest-first means
   "Salomon Center 101" binds alias "Salomon Center" with room "101", never
   alias "Salomon" with room "Center 101". A remainder looks like a room iff
   it has 1-2 tokens, at least one token contains a digit, and the split
   falls on a raw-token boundary (a normalized token that is mid-raw-token,
   e.g. the "annex" in "Wilson-Annex", can never start a room). The room is
   the raw substring from the split offset, stripped — raw case/punctuation
   preserved ("B101" stays "B101").
4. **Trigram fuzzy**: score every curated alias against the full normalized
   query and against room-stripped variants (trailing 1-2 room-looking
   tokens, raw-boundary-aligned). Per place keep the best
   (score, fewest-stripped-tokens, alias) triple. Accept the top place iff
   its score `>= threshold` (`>=` — the 0.55 boundary accepts). A tie in
   trigram score between two distinct places is `reason="ambiguous"`
   (fail-closed: the contract's "never guess" wins; RapidFuzz must not break
   the tie because that would let it veto/decide a contract-level match).
   Otherwise `reason="below-threshold"` with the best score reported.
5. Candidates (top 5 by trigram) are reported for every fuzzy-stage outcome,
   ranked by `token_set_ratio` — proving RapidFuzz ranks/reports while the
   accepted match is chosen by trigram alone.

## Report decisions

- A sample is resolved iff `resolution.place_id is not None`.
- Hit rate by source: resolved/total per `source`, plus method and
  unresolved-reason counts and the top unresolved raw values
  (count desc, value asc, default top 20).
- CAB section-level rate: a section (`section_id`) is resolved iff **all** of
  its samples resolved (strict, fail-closed). CAB samples without a
  `section_id` raise `ValueError` — silent exclusion could hide gate rows.
- CAB pattern-level rate: distinct raw values among CAB samples; a pattern is
  resolved iff all its samples resolved.
- Gate: `cab_section_rate >= gate_threshold` on the exact fraction (never the
  rounded display); rendered explicitly as `PASS`/`FAIL` with rate, counts,
  and threshold. With no CAB sections the render says the gate was **not
  evaluated** (never an implicit pass).
- `render_markdown` is deterministic; `generated_at` is caller-supplied.

## Parity vectors

`ingest/tests/gazetteer/conftest.py` holds ~26 golden `(a, b, expected)`
vectors (ASCII-only so libc/ICU lowercasing differences cannot skew pg
results): identity, case folding, hyphen-vs-space, `&`/apostrophe word
splitting, digit tokens, single-char and empty words, repeated-trigram
dedupe, the exact 11/20 = 0.55 boundary pair, and realistic campus strings.
The offline test pins `trigram_similarity` to the golden fractions; the
postgres-marked test (skips without `TEST_DATABASE_URL`) runs
`select similarity(a, b)` for every vector and asserts agreement with the
Python value within float4 tolerance.

## Required test cycle

1. `cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/gazetteer/test_resolver.py -q`
   — RED (module missing) then GREEN.
2. Same for `tests/gazetteer/test_report.py`.
3. `uv run pytest tests/gazetteer/test_trigram_postgres.py -q` — collects and
   skips cleanly offline.
4. Full offline suite green: baseline 298 passed + 8 skipped, plus the new
   tests (postgres skips grow by the parity test count).

## Report

Write `reports/sdd/brownsync-ingestion/task-5-report.md` with changed files,
RED/GREEN evidence, decisions, self-review, and concerns. Append ledger lines
to `progress.md`. One conventional commit staging explicit paths; do not push.
