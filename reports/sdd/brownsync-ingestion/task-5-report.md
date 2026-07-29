# Task 5 Report: Resolver and place-resolution report

Date: 2026-07-28

## Status

Complete. The shared place resolver now implements the contract §2 pipeline —
exact normalized alias match, longest-alias-prefix room extraction, then
portable pg_trgm trigram acceptance at `>= 0.55` — with RapidFuzz
`token_set_ratio` ranking/reporting candidates but never able to veto (or
decide) a contract-valid trigram match. The report module aggregates
resolution samples into per-source hit rates, method/reason counts, top
unresolved values, CAB section- and pattern-level rates, and an explicitly
rendered PASS/FAIL/NOT-EVALUATED `>= 90%` gate. 26 golden parity vectors pin
the Python `similarity()` behavior offline and replay against PostgreSQL
`similarity()` in a postgres-marked test that skips without
`TEST_DATABASE_URL` (Docker was not started, per the brief).

## Changed files

- `ingest/brownsync_ingest/gazetteer/resolver.py` (new)
- `ingest/brownsync_ingest/gazetteer/report.py` (new)
- `ingest/tests/gazetteer/conftest.py` (new: golden parity vectors + hook)
- `ingest/tests/gazetteer/test_resolver.py` (new)
- `ingest/tests/gazetteer/test_report.py` (new)
- `ingest/tests/gazetteer/test_trigram_postgres.py` (new, postgres-marked)
- `ingest/pyproject.toml` + `ingest/uv.lock` (add `rapidfuzz>=3,<4`)
- `reports/sdd/brownsync-ingestion/task-5-brief.md`, this report,
  `progress.md`

## TDD evidence (RED then GREEN per module)

```text
tests/gazetteer/test_resolver.py
  RED:   ModuleNotFoundError: No module named 'brownsync_ingest.gazetteer.resolver'
         (collection error)
  GREEN: 56 passed in 0.08s

tests/gazetteer/test_report.py
  RED:   ModuleNotFoundError: No module named 'brownsync_ingest.gazetteer.report'
         (collection error)
  GREEN: 17 passed in 0.04s

tests/gazetteer/test_trigram_postgres.py (offline)
  26 skipped — "TEST_DATABASE_URL is not set; postgres integration tests
  need a disposable database"
```

## What the resolver proves

- **Trigram portability** (`trigrams` / `trigram_similarity`): mirrors
  pg_trgm's default build — lowercase, words split on every non-alphanumeric
  (underscore included), two-space/one-space word padding, deduped
  3-char windows, Jaccard similarity, and pg's explicit 0.0 guard for empty
  trigram sets. 26 golden vectors (ASCII-only so database-locale
  lowercasing cannot skew the pg comparison) are pinned offline as exact
  fractions and replayed against `select similarity(a, b)` when
  `TEST_DATABASE_URL` exists; `11/20 == 0.55` is one of them, proving the
  boundary accepts under float `>=`.
- **Exact stage**: full normalized token match; "the ratty" ->
  `sharpe-refectory`, "SMITH-BUONANNO  HALL" -> `smith-buonanno-hall`; the
  raw query is preserved byte-for-byte; "Barus Building" / "Barus & Holley"
  / "B&H" all land on the right distinct place; address aliases
  ("85 Waterman Street", "85 Waterman") never lose their leading number
  because exact runs before any room stripping.
- **Room extraction**: longest alias prefix with a room-looking remainder
  (1-2 tokens, at least one digit, split aligned to a raw-token boundary).
  "Salomon Center 101" binds "Salomon Center" + room "101" (never "Salomon"
  + "Center 101"); rooms keep raw capitalization ("B101"); two-token rooms
  work ("001 A"); "Wilson-Annex 3" proves a room can never start mid raw
  token; "Sayles Hall Auditorium" proves a digitless remainder is not a
  room and stays fail-closed.
- **Fuzzy stage**: full-query and room-stripped variants score against every
  alias; the trigram score alone decides acceptance at `>= 0.55`.
  "MacMillan 117" resolves by trigram with room "117" (score 10/15);
  "Smith Buonano Hall" (typo) resolves at 6/7; a constructed
  Granite-Hall-vs-Granite-Hall-Anex catalog proves RapidFuzz ranks the
  candidate list (token_set_ratio 100 first) while the accepted match is the
  higher-trigram place it ranked second — ranks and reports, never vetoes.
  Equal top trigram scores between distinct places fail closed as
  `ambiguous` (the contract's "never guess"); candidates are capped at 5 and
  reported for below-threshold and ambiguous outcomes to feed alias growth.
- **Determinism**: alias collisions raise at construction; all orderings
  (candidate ranking, tie enumeration) have total, documented sort keys.

## What the report proves

- Hit rate by source, method counts (exact / exact-room / trigram /
  unresolved), unresolved reason counts, and top unresolved raw values
  (count desc, value asc, limit honored, pipes escaped in Markdown).
- CAB section-level rate counts a section as resolved only when **every**
  sample of that section resolved (strict, fail-closed); pattern-level rate
  does the same over distinct raw values; CAB samples without a
  `section_id` raise.
- The gate is computed on the exact fraction (9/10 passes at exactly 0.90;
  8/9 fails) and rendered explicitly:
  `Gate (CAB section resolution >= 90.0%): PASS|FAIL — <rate> (r/t sections)`,
  or `NOT EVALUATED` when no CAB sections were observed — never an implicit
  pass. Rendering is deterministic; `generated_at` is caller-supplied.

## Read-only preview against the user-supplied Fall 2026 CSV

To give Task 6 evidence (not part of the committed suite; the CSV stays
unmanifested until the task that consumes it), the resolver was run over
`ingest/fixtures/user_provided/brown_fall_2026_classes_and_locations.csv`,
keeping only `location_status == "Physical location published"` rows
(1,501 samples over 254 distinct locations; 3,328 TBA / 274 unpublished /
100 cross-list / 72 online rows skipped):

- Sections resolved: 1253/1501 (83.5%) -> gate currently **FAIL** (as
  expected before Task 10 alias growth); patterns 197/254 (77.6%).
- Methods: 1083 exact-room, 170 trigram, 248 unresolved (216
  below-threshold, 32 ambiguous).
- Top unresolved values are almost all street addresses missing from the
  curated catalog ("101 Thayer Street (VGQ 1st fl) 116E", "67 George Street
  104", "190 Hope Street 203", "Geo-Chemistry Building 039", ...).
- The 32 ambiguous samples are same-street ties, e.g. "67 George Street"
  scoring identically against the "180 George Street" and "182 George
  Street" aliases — precisely the fail-closed behavior the contract wants;
  the fix is adding the missing address aliases, never guessing.

## Full regression

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest -q
371 passed, 34 skipped in 0.85s
```

73 new passing tests (56 resolver + 17 report) over the inherited 298; skips
grew from 8 to 34 (the 26 parity vectors each skip as one postgres-marked
test without `TEST_DATABASE_URL`).

## Self-review

- The exact-0.55 boundary is proven twice: as a golden fraction
  (`11/20`) through the public `trigram_similarity`, and end-to-end through
  `PlaceResolver.resolve` accepting at that exact score, with the 11/21
  neighbor rejected.
- The never-veto test would fail if RapidFuzz influenced acceptance: the
  token_set_ratio-preferred candidate loses to the higher-trigram one.
- Ambiguity is checked only after the threshold, so sub-threshold ties
  report `below-threshold` (the actionable reason), not `ambiguous`.
- The preview run exercised the real catalog against 1,501 real CAB rows
  with zero exceptions, and its unresolved/ambiguous output is exactly the
  alias-growth worklist shape Task 10 needs.

## Concerns

- pg parity for the empty-string guard (`similarity('','') = 0`) relies on
  pg_trgm's documented `cnt_sml` empty check; the postgres-marked test will
  verify it the first time a `TEST_DATABASE_URL` run happens (Task 10).
- Room text is the raw tail after the split, whitespace-stripped only —
  "Salomon 101." would keep the trailing period. Real CAB values in the
  user CSV show no such trailing punctuation; revisit in Task 6 if parsing
  evidence says otherwise.
- `PlaceResolver` resolves against the curated catalog, not the built
  `PlaceRow` set; today `build_catalog` drops no curated place (0
  diagnostics), but if a future catalog edit ever drops one, a resolution
  could point at a place absent from the seed. Task 9's offline integration
  (foreign-key validation) is the backstop.
- The preview's 83.5% section rate is below the 90% gate; that is expected
  at this stage and is Task 10's alias-growth work, but it is worth flagging
  that ~57 distinct unresolved patterns (mostly bare street addresses) need
  curated entries or aliases before CAB can publish.
