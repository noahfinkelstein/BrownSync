-- 0007_place_resolution.sql — contract §2 place resolution, in SQL.
--
-- ADDITIVE ONLY: one new table, one trigger on `places`, two functions.
-- No contract §1 table is altered.
--
-- THE BUG THIS FIXES
--
-- /api/events returns 500 rows with ZERO placeId. The seed bundle ships 229
-- resolved place_ids; services/poller/src/livewhale/normalize.ts emits
-- `place_id: null` (the poller has no gazetteer), and db.ts's upsert wrote
-- `place_id = excluded.place_id` — so the first live refresh after a seed load
-- nulls every resolved place. The map layer, the "what's happening here" panel
-- and half of the dedup blocking query all depend on that column.
--
-- WHY IN SQL RATHER THAN PORTED TO TYPESCRIPT
--
-- The Python resolver (ingest/brownsync_ingest/gazetteer/resolver.py) was
-- explicitly BUILT to mirror pg_trgm — its `trigrams()` reimplements pg_trgm's
-- default build flags, and test_trigram_postgres.py exists precisely because
-- that parity is hard to hold. Postgres already has pg_trgm and places.aliases.
-- Putting resolution here makes the mirror the original: one implementation
-- that every writer (seed loader, poller, ingest --out postgres, a human
-- running an INSERT) goes through, instead of a third hand-maintained copy.
--
-- A lookup/cache table was considered and rejected: it goes stale silently and
-- by construction cannot resolve a string it has never seen, which is exactly
-- the case that matters as new sources arrive with new location strings.
--
-- Parity with the Python resolver is PINNED by
-- ingest/tests/gazetteer/test_sql_resolver_parity.py, which replays the
-- resolver's fixture corpus through both implementations and asserts identical
-- (place_id, room, method).

-- ---------------------------------------------------------------------------
-- normalize_alias — the ONE thing that had to be ported.
--
-- Mirrors ingest/brownsync_ingest/gazetteer/aliases.py:27-45 exactly:
--   casefold -> NFKD -> drop combining marks -> drop apostrophes ->
--   every other non-alphanumeric becomes a space -> collapse runs -> trim.
--
-- Two deliberate details:
--  * Apostrophes are DELETED, not spaced, so "Jo's" and "Jos" agree. Every
--    other separator becomes a space, so "Barus & Holley", "Barus and Holley"
--    and "barus_holley" all normalize compatibly.
--  * Combining marks are DELETED rather than spaced. After NFKD an accent is
--    its own character; spacing it would turn "Ré1" into "re 1" while Python
--    produces "re1". The ranges cover the Unicode combining-mark blocks that
--    Latin text decomposes into.
--
-- Known, documented divergence from Python's casefold(): SQL lower() does not
-- expand the German sharp s (casefold('ß') = 'ss', lower('ß') = 'ß', which
-- then becomes a space here). No catalog entry contains one; the parity test
-- would surface it the moment one did.
--
-- Returns NULL where Python raises "normalizes to nothing" — callers treat
-- NULL as unresolvable, which is the same fail-closed outcome.
-- ---------------------------------------------------------------------------
create or replace function normalize_alias(p_text text)
returns text
language sql
immutable
strict
parallel safe
-- Every non-ASCII character below is written as a Unicode escape on purpose:
-- this file is applied by plain psql in CI and must not depend on the client
-- encoding or on an editor preserving combining marks correctly.
--   \u0300-\u036f  Combining Diacritical Marks (what NFKD of Latin text yields)
--   \u1ab0-\u1aff  Combining Diacritical Marks Extended
--   \u1dc0-\u1dff  Combining Diacritical Marks Supplement
--   \u20d0-\u20ff  Combining Diacritical Marks for Symbols
--   \ufe20-\ufe2f  Combining Half Marks
-- U&'\0027\2019\02BC' is U+0027 apostrophe, U+2019 right single quote,
-- U+02BC modifier letter apostrophe -- the three the Python side drops.
as $$
  select nullif(
    btrim(
      regexp_replace(
        translate(
          regexp_replace(
            normalize(lower(p_text), NFKD),
            '[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]',
            '',
            'g'
          ),
          U&'\0027\2019\02BC',
          ''
        ),
        '[^a-z0-9]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

comment on function normalize_alias(text) is
  'Case/punctuation/accent-insensitive alias key. Verbatim port of '
  'brownsync_ingest.gazetteer.aliases.normalize_alias; parity is pinned by '
  'ingest/tests/gazetteer/test_sql_resolver_parity.py.';

-- ---------------------------------------------------------------------------
-- place_aliases — the resolver's index, derived from places.
--
-- Populated by a TRIGGER on `places` rather than by each writer, so db/seed.ts,
-- the ingest `--out postgres` path and a manual INSERT all stay consistent
-- with no third code path to keep in step. Nobody can forget to call it.
-- ---------------------------------------------------------------------------
create table if not exists place_aliases (
  place_id   text not null references places(id) on delete cascade,
  -- The alias exactly as curated, kept for the fuzzy stage's tie-break and
  -- for reporting which alias matched.
  alias      text not null,
  alias_norm text not null,
  primary key (place_id, alias_norm)
);

-- The fuzzy stage's scan; also the access path for any future `%` prefilter.
create index if not exists place_aliases_trgm_idx
  on place_aliases using gin (alias_norm gin_trgm_ops);
-- The exact and prefix stages, which is where the overwhelming majority of
-- real strings resolve (94% of the seeded course meetings).
create index if not exists place_aliases_norm_idx
  on place_aliases (alias_norm);

create or replace function place_aliases_sync()
returns trigger
language plpgsql
as $$
begin
  delete from place_aliases where place_id = new.id;
  insert into place_aliases (place_id, alias, alias_norm)
  select distinct on (normalize_alias(a.alias))
    new.id, a.alias, normalize_alias(a.alias)
  from unnest(array[new.name] || coalesce(new.aliases, '{}'::text[])) as a(alias)
  where normalize_alias(a.alias) is not null
  -- Deterministic pick when a place lists two aliases that normalize the
  -- same ("Smith-Buonanno" / "Smith Buonanno"): shortest, then lexical.
  order by normalize_alias(a.alias), length(a.alias), a.alias
  on conflict (place_id, alias_norm) do nothing;
  return new;
end
$$;

drop trigger if exists places_alias_sync on places;
create trigger places_alias_sync
  after insert or update of name, aliases on places
  for each row execute function place_aliases_sync();

-- Backfill whatever is already in the gazetteer.
insert into place_aliases (place_id, alias, alias_norm)
select distinct on (p.id, normalize_alias(a.alias))
  p.id, a.alias, normalize_alias(a.alias)
from places p
cross join lateral unnest(array[p.name] || coalesce(p.aliases, '{}'::text[])) as a(alias)
where normalize_alias(a.alias) is not null
order by p.id, normalize_alias(a.alias), length(a.alias), a.alias
on conflict (place_id, alias_norm) do nothing;

-- ---------------------------------------------------------------------------
-- room_shaped — "may the tokens after position `p_prefix_len` be a room?"
--
-- Both resolution stages ask the same question, and getting it wrong in one of
-- them is precisely how a resolver starts inventing rooms, so it lives in one
-- place. Three rules, all from real data:
--
--   * 1 to `p_max_tokens` tokens. Longer remainders are not room numbers.
--   * At least one of them contains a DIGIT. Without this, "Sayles Hall
--     Auditorium" resolves to Sayles Hall with room "Auditorium".
--   * The split may never land MID RAW TOKEN. In "Wilson-Annex 3", "Annex" is
--     inside the raw token "Wilson-Annex", so only the whitespace-aligned "3"
--     may be split off — otherwise "Wilson" matches at similarity 1.0 with the
--     invented room "Annex 3".
-- ---------------------------------------------------------------------------
create or replace function room_shaped(
  p_words      text[],
  p_firsts     boolean[],
  p_prefix_len int,
  p_n_words    int,
  p_max_tokens int
)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_prefix_len >= 1
     and p_prefix_len < p_n_words
     and p_n_words - p_prefix_len <= p_max_tokens
     and coalesce(p_firsts[p_prefix_len + 1], false)
     and exists (
       select 1
       from unnest(p_words[p_prefix_len + 1 : p_n_words]) as t(w)
       where t.w ~ '[0-9]'
     );
$$;

-- ---------------------------------------------------------------------------
-- resolve_place — contract §2, verbatim.
--
--   exact alias hit
--     -> longest alias PREFIX with a room-shaped remainder
--        -> trigram similarity >= 0.55
--           -> NULL
--
-- and a strict tie between two places at the top score is AMBIGUOUS, which
-- fails closed to NULL. Never guess below the threshold; never guess between
-- two equal candidates. A null place_id with location_raw intact is a fixable
-- gap; a wrong building is a lie the UI renders confidently.
--
-- Two rules carried over from the Python resolver that are easy to miss and
-- both exist because of real data:
--
--  * A ROOM MAY NEVER START MID RAW TOKEN. In "Wilson-Annex 3", "Annex" sits
--    inside the raw token "Wilson-Annex", so "Annex 3" can never be treated as
--    the room — only the whitespace-aligned "3" may be split off.
--  * A ROOM MUST CONTAIN A DIGIT and be at most two tokens. "Sayles Hall
--    Auditorium" therefore does not resolve to Sayles Hall with room
--    "Auditorium"; it stays unresolved, as it should.
--
-- The room is returned with its RAW capitalisation ("B101", "2NDFLOOR"),
-- sliced out of the original string rather than rebuilt from normalized words.
--
-- Returns exactly one row. method is 'exact' | 'exact-room' | 'trigram' |
-- 'unresolved'.
-- ---------------------------------------------------------------------------
create or replace function resolve_place(p_raw text)
returns table (place_id text, room text, method text, score real)
language plpgsql
stable
as $$
declare
  TRIGRAM_THRESHOLD constant real := 0.55;
  MAX_ROOM_TOKENS   constant int  := 2;

  -- Token stream: one entry per NORMALIZED word, carrying where its raw
  -- whitespace-token started and whether it opened that raw token.
  words      text[]    := '{}';
  starts     int[]     := '{}';
  firsts     boolean[] := '{}';

  i          int;
  j          int;
  n_chars    int;
  raw_tok    text;
  norm_tok   text;
  parts      text[];
  k          int;

  n_words     int;
  full_norm   text;
  prefix_len  int;
  prefix_norm text;
  n_strip     int;

  -- Fuzzy-stage candidate variants, as parallel arrays.
  v_texts    text[];
  v_rooms    text[];
  v_strips   int[];

  r_place_id text := null;
  r_room     text := null;
  r_method   text := 'unresolved';
  r_score    real := null;

  best_score real;
  n_tied     int;
begin
  if p_raw is null then
    return query select r_place_id, r_room, r_method, r_score;
    return;
  end if;

  -- --- tokenize, preserving raw offsets ------------------------------------
  -- Split on whitespace runs exactly like Python's \S+ scan, so `first_in_raw`
  -- and the room slice below refer to the ORIGINAL string.
  i := 1;
  n_chars := length(p_raw);
  while i <= n_chars loop
    if substring(p_raw from i for 1) ~ '\s' then
      i := i + 1;
      continue;
    end if;
    j := i;
    while j <= n_chars and substring(p_raw from j for 1) !~ '\s' loop
      j := j + 1;
    end loop;
    raw_tok := substring(p_raw from i for j - i);
    norm_tok := normalize_alias(raw_tok);
    if norm_tok is not null then
      parts := string_to_array(norm_tok, ' ');
      for k in 1 .. cardinality(parts) loop
        words  := words  || parts[k];
        starts := starts || i;
        firsts := firsts || (k = 1);
      end loop;
    end if;
    i := j;
  end loop;

  n_words := coalesce(cardinality(words), 0);
  if n_words = 0 then
    -- "empty after normalization" — nothing to match on.
    return query select r_place_id, r_room, r_method, r_score;
    return;
  end if;
  full_norm := array_to_string(words, ' ');

  -- --- stage 1: exact alias hit --------------------------------------------
  -- A single distinct place must own the alias. Two places sharing one
  -- normalized alias is a catalog defect (both the Python catalog loader and
  -- the resolver refuse to construct with one); here it fails closed rather
  -- than silently picking a winner.
  select count(distinct pa.place_id), min(pa.place_id)
    into n_tied, r_place_id
  from place_aliases pa
  where pa.alias_norm = full_norm;
  if n_tied = 1 then
    return query select r_place_id, null::text, 'exact'::text, null::real;
    return;
  end if;
  r_place_id := null;
  if n_tied > 1 then
    return query select null::text, null::text, 'unresolved'::text, null::real;
    return;
  end if;

  -- --- stage 2: longest alias prefix + room remainder ----------------------
  -- Longest first, so "Salomon Center 101" binds via the "Salomon Center"
  -- alias with room "101", never via "Salomon" with room "Center 101".
  for prefix_len in reverse (n_words - 1) .. 1 loop
    continue when not room_shaped(words, firsts, prefix_len, n_words, MAX_ROOM_TOKENS);
    prefix_norm := array_to_string(words[1 : prefix_len], ' ');

    select count(distinct pa.place_id), min(pa.place_id)
      into n_tied, r_place_id
    from place_aliases pa
    where pa.alias_norm = prefix_norm;
    if n_tied = 1 then
      return query select
        r_place_id,
        btrim(substring(p_raw from starts[prefix_len + 1])),
        'exact-room'::text,
        null::real;
      return;
    end if;
    r_place_id := null;
  end loop;

  -- --- stage 3: trigram ----------------------------------------------------
  -- Candidate variants: the full query, plus up to MAX_ROOM_TOKENS versions
  -- with a room-shaped tail stripped off, so a MISSPELLED building name still
  -- matches when a room number trails it ("Bakgammon Terminal 12"). `stripped`
  -- is the tie-break after score: prefer matching more of what the source
  -- actually said.
  --
  -- The variants are materialised into parallel arrays HERE, in plpgsql,
  -- rather than being derived inside the query below: array subscripting a
  -- plpgsql variable from within embedded SQL is exactly the kind of construct
  -- that is easy to get subtly wrong, and this keeps the query itself plain.
  v_texts  := array[full_norm];
  v_rooms  := array[null::text];
  v_strips := array[0];
  for n_strip in 1 .. MAX_ROOM_TOKENS loop
    prefix_len := n_words - n_strip;
    exit when prefix_len < 1;
    continue when not room_shaped(words, firsts, prefix_len, n_words, MAX_ROOM_TOKENS);
    v_texts  := v_texts  || array_to_string(words[1 : prefix_len], ' ');
    v_rooms  := v_rooms  || btrim(substring(p_raw from starts[prefix_len + 1]));
    v_strips := v_strips || n_strip;
  end loop;

  -- Column aliases below deliberately avoid the OUT parameter names (`room`,
  -- `score`): a plpgsql variable and a column of the same name in one query is
  -- an ambiguity error waiting for the one input that reaches this branch.
  select w.place_id, w.room_raw, w.sim, w.n_top
    into r_place_id, r_room, best_score, n_tied
  from (
    select
      b.place_id,
      b.room_raw,
      b.sim,
      -- Number of DISTINCT PLACES sharing this score. At the top score, > 1
      -- is the ambiguity that must fail closed.
      count(*) over (partition by b.sim) as n_top,
      rank() over (order by b.sim desc)  as rnk
    from (
      -- Best (score desc, fewest stripped tokens, alias asc) per place — the
      -- same key the Python resolver minimises on.
      select distinct on (s.place_id) s.place_id, s.sim, s.room_raw, s.strip_n, s.alias
      from (
        select
          pa.place_id,
          pa.alias,
          similarity(v.text_norm, pa.alias_norm) as sim,
          v.strip_n,
          v.room_raw
        from place_aliases pa
        cross join unnest(v_texts, v_rooms, v_strips) as v(text_norm, room_raw, strip_n)
      ) s
      order by s.place_id, s.sim desc, s.strip_n asc, s.alias asc
    ) b
  ) w
  where w.rnk = 1
  limit 1;

  best_score := coalesce(best_score, 0.0);
  if best_score < TRIGRAM_THRESHOLD or coalesce(n_tied, 0) <> 1 then
    -- Below threshold, or a strict tie between distinct places: fail closed.
    -- Reporting the best score even on a refusal is deliberate — it is what
    -- makes the unresolved-strings report usable for alias growth.
    return query select null::text, null::text, 'unresolved'::text, best_score;
    return;
  end if;

  return query select r_place_id, r_room, 'trigram'::text, best_score;
end
$$;

comment on function resolve_place(text) is
  'DATA_CONTRACT.md §2 place resolution: exact alias -> longest alias prefix '
  'with a room remainder -> trigram similarity >= 0.55 -> NULL. Ambiguity '
  'fails closed. Parity with the Python resolver is pinned by '
  'ingest/tests/gazetteer/test_sql_resolver_parity.py.';
