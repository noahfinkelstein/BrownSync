-- 0007_place_resolution_checks.sql — semantic checks for the SQL resolver.
--
-- Run by CI's postgis job right after migrations:
--   psql -v ON_ERROR_STOP=1 -f db/checks/0007_place_resolution_checks.sql
--
-- ROLLBACK-SAFE: one transaction that always rolls back; fixture place ids are
-- prefixed chk-; assertions test membership or the resolution of chk-prefixed
-- strings, so pre-existing gazetteer rows cannot break them.
--
-- The Python resolver's own test suite is mirrored here case for case. The
-- authoritative cross-implementation proof is
-- ingest/tests/gazetteer/test_sql_resolver_parity.py, which replays the same
-- corpus through both; this file is the SQL-side smoke that runs even when the
-- Python suite does not.

begin;

-- ---------------------------------------------------------------------------
-- normalize_alias — the ported function
-- ---------------------------------------------------------------------------
do $chk$
begin
  if normalize_alias('Sayles Hall') <> 'sayles hall' then
    raise exception 'normalize_alias: casefold failed (%)', normalize_alias('Sayles Hall');
  end if;
  -- every separator becomes a space, so these three agree
  if normalize_alias('Barus & Holley') <> 'barus holley'
     or normalize_alias('barus_holley') <> 'barus holley'
     or normalize_alias('Barus   Holley') <> 'barus holley' then
    raise exception 'normalize_alias: separator handling diverged (%, %, %)',
      normalize_alias('Barus & Holley'),
      normalize_alias('barus_holley'),
      normalize_alias('Barus   Holley');
  end if;
  -- apostrophes are DELETED, not spaced: "Jo's" and "Jos" must be one key
  if normalize_alias('Jo''s') <> 'jos' then
    raise exception 'normalize_alias: apostrophe not dropped (%)', normalize_alias('Jo''s');
  end if;
  if normalize_alias(U&'Jo\2019s') <> 'jos' then
    raise exception 'normalize_alias: curly apostrophe not dropped (%)',
      normalize_alias(U&'Jo\2019s');
  end if;
  -- a combining mark BETWEEN two alphanumerics must vanish, not become a
  -- space: this is the one place a naive port silently diverges from Python.
  if normalize_alias(U&'R\00e91') <> 're1' then
    raise exception 'normalize_alias: precomposed accent not stripped (%)',
      normalize_alias(U&'R\00e91');
  end if;
  if normalize_alias(U&'Re\03011') <> 're1' then
    raise exception 'normalize_alias: decomposed accent not stripped (%)',
      normalize_alias(U&'Re\03011');
  end if;
  -- leading/trailing separators trim; a separator-only string is NULL, which
  -- is how "normalizes to nothing" fails closed here
  if normalize_alias('  The  Ratty  ') <> 'the ratty' then
    raise exception 'normalize_alias: trim/collapse failed (%)', normalize_alias('  The  Ratty  ');
  end if;
  if normalize_alias(' & ') is not null or normalize_alias('') is not null then
    raise exception 'normalize_alias: separator-only input did not normalize to NULL';
  end if;
  if normalize_alias(null) is not null then
    raise exception 'normalize_alias: null input must stay null';
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- place_aliases is maintained BY TRIGGER, so every writer stays consistent
-- ---------------------------------------------------------------------------
insert into places (id, name, aliases, kind, lat, lng) values
  ('chk-salomon-center', 'Chk Salomon Center', '{"Chk Salomon"}', 'academic', 41.8262, -71.4032),
  ('chk-smith',          'Chk Smith Buonanno Hall', '{}',         'academic', 41.8265, -71.4020),
  ('chk-wilson',         'Chk Wilson',              '{}',         'academic', 41.8259, -71.4010),
  ('chk-jos',            'Chk Jo''s',               '{}',         'dining',   41.8270, -71.4000),
  ('chk-quincy-north',   'Chk Quincy Annex North',  '{}',         'academic', 41.8280, -71.4050),
  ('chk-quincy-south',   'Chk Quincy Annex South',  '{}',         'academic', 41.8281, -71.4051);

do $chk$
declare
  keys text[];
begin
  select coalesce(array_agg(alias_norm order by alias_norm), '{}') into keys
  from place_aliases where place_id = 'chk-salomon-center';
  if keys <> array['chk salomon', 'chk salomon center'] then
    raise exception '0007: trigger did not index name + aliases (got %)', keys;
  end if;

  -- growing the gazetteer must reach the resolver with no second code path
  update places set aliases = '{"Chk Salomon","Chk Sal"}' where id = 'chk-salomon-center';
  select coalesce(array_agg(alias_norm order by alias_norm), '{}') into keys
  from place_aliases where place_id = 'chk-salomon-center';
  if keys <> array['chk sal', 'chk salomon', 'chk salomon center'] then
    raise exception '0007: trigger did not resync on UPDATE (got %)', keys;
  end if;

  -- and shrinking it must retract, or the index accumulates stale aliases
  update places set aliases = '{"Chk Salomon"}' where id = 'chk-salomon-center';
  select coalesce(array_agg(alias_norm order by alias_norm), '{}') into keys
  from place_aliases where place_id = 'chk-salomon-center';
  if keys <> array['chk salomon', 'chk salomon center'] then
    raise exception '0007: trigger did not drop a removed alias (got %)', keys;
  end if;
end
$chk$;

-- Every real gazetteer row must be indexed too — the 0007 backfill.
do $chk$
declare
  missing int;
begin
  select count(*) into missing
  from places p
  where normalize_alias(p.name) is not null
    and not exists (select 1 from place_aliases pa where pa.place_id = p.id);
  if missing > 0 then
    raise exception '0007: % place(s) have no alias index row — backfill missed them', missing;
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- resolve_place: stage 1, exact
-- ---------------------------------------------------------------------------
do $chk$
declare
  r record;
begin
  select * into r from resolve_place('Chk Salomon Center');
  if (r.place_id, r.room, r.method) is distinct from ('chk-salomon-center', null, 'exact') then
    raise exception 'resolve exact: got (%, %, %)', r.place_id, r.room, r.method;
  end if;

  -- case, punctuation and whitespace insensitive
  select * into r from resolve_place('  chk   SALOMON  center ');
  if r.place_id <> 'chk-salomon-center' or r.method <> 'exact' then
    raise exception 'resolve exact: normalization not applied (%, %)', r.place_id, r.method;
  end if;

  -- apostrophes: the alias index and the query must agree
  select * into r from resolve_place('Chk Jos');
  if r.place_id <> 'chk-jos' or r.method <> 'exact' then
    raise exception 'resolve exact: apostrophe alias missed (%, %)', r.place_id, r.method;
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- resolve_place: stage 2, longest alias prefix + room
-- ---------------------------------------------------------------------------
do $chk$
declare
  r record;
begin
  -- LONGEST prefix wins: never "Chk Salomon" with room "Center 101"
  select * into r from resolve_place('Chk Salomon Center 101');
  if (r.place_id, r.room, r.method)
     is distinct from ('chk-salomon-center', '101', 'exact-room') then
    raise exception 'resolve room: longest prefix lost (%, %, %)', r.place_id, r.room, r.method;
  end if;

  -- the shorter alias still works when it is the longest that matches
  select * into r from resolve_place('Chk Salomon 101');
  if (r.place_id, r.room, r.method)
     is distinct from ('chk-salomon-center', '101', 'exact-room') then
    raise exception 'resolve room: alias prefix failed (%, %, %)', r.place_id, r.room, r.method;
  end if;

  -- the room keeps its RAW capitalisation — it is sliced out of the original
  select * into r from resolve_place('Chk Salomon B101');
  if r.room <> 'B101' then
    raise exception 'resolve room: raw capitalisation lost (%)', r.room;
  end if;

  -- a two-token room is allowed
  select * into r from resolve_place('Chk Salomon 001 A');
  if (r.place_id, r.room, r.method)
     is distinct from ('chk-salomon-center', '001 A', 'exact-room') then
    raise exception 'resolve room: two-token room failed (%, %, %)',
      r.place_id, r.room, r.method;
  end if;

  -- a DIGITLESS remainder is not a room. "Auditorium" must not be split off,
  -- so this can only ever come back through the fuzzy stage with room null.
  select * into r from resolve_place('Chk Salomon Center Auditorium');
  if r.method = 'exact-room' or r.room is not null then
    raise exception 'resolve room: digitless remainder treated as a room (%, %)',
      r.method, r.room;
  end if;

  -- a room may never START MID RAW TOKEN. In "Chk Wilson-Annex 3", "Annex"
  -- lives inside the raw token "Wilson-Annex": only the whitespace-aligned
  -- "3" may be stripped. If the rule were broken, "Chk Wilson" would match at
  -- similarity 1.0 with room "Annex 3".
  select * into r from resolve_place('Chk Wilson-Annex 3');
  if r.place_id <> 'chk-wilson' or r.room <> '3' then
    raise exception 'resolve room: mid-token split (%, %)', r.place_id, r.room;
  end if;
  if r.score >= 1.0 then
    raise exception 'resolve room: matched a mid-token split at score %', r.score;
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- resolve_place: stage 3, trigram — acceptance, refusal, ambiguity
-- ---------------------------------------------------------------------------
do $chk$
declare
  r record;
begin
  -- a typo still resolves
  select * into r from resolve_place('Chk Smith Buonano Hall');
  if r.place_id <> 'chk-smith' or r.method <> 'trigram' then
    raise exception 'resolve trigram: typo not matched (%, %)', r.place_id, r.method;
  end if;
  if r.room is not null then
    raise exception 'resolve trigram: invented a room (%)', r.room;
  end if;

  -- garbage stays unresolved rather than binding to the nearest building
  select * into r from resolve_place('zzzz qqqq xyxyx');
  if r.place_id is not null or r.method <> 'unresolved' then
    raise exception 'resolve trigram: garbage resolved to % via %', r.place_id, r.method;
  end if;

  -- AMBIGUITY FAILS CLOSED. Two places tie exactly; guessing either would put
  -- a confident wrong building on the map.
  select * into r from resolve_place('Chk Quincy Annex');
  if r.place_id is not null or r.method <> 'unresolved' then
    raise exception 'resolve trigram: ambiguous tie resolved to % via %', r.place_id, r.method;
  end if;
  if r.score < 0.55 then
    raise exception 'resolve trigram: ambiguity fixture scored % — below threshold, so the '
      'assertion above proves nothing', r.score;
  end if;

  -- empty and separator-only input
  for r in select * from resolve_place('') union all select * from resolve_place(' & ')
           union all select * from resolve_place(null::text) loop
    if r.place_id is not null or r.method <> 'unresolved' then
      raise exception 'resolve: empty input resolved to % via %', r.place_id, r.method;
    end if;
  end loop;
end
$chk$;

-- ---------------------------------------------------------------------------
-- The 0.55 threshold itself, at the exact boundary.
--
-- similarity('Backgammon','Backgammon Terminal')  = 11/20 = 0.55  -> accept
-- similarity('Backgammon','Backgammon Terminals') = 11/21 ≈ 0.524 -> refuse
--
-- Each side runs against a gazetteer containing ONLY its own fixture, so the
-- other cannot mask the result; savepoints scope them inside this
-- already-rolling-back transaction.
-- ---------------------------------------------------------------------------
do $chk$
begin
  if similarity('backgammon', 'backgammon terminal') < 0.55 then
    raise exception 'pg_trgm: the 11/20 boundary pair fell below 0.55 (%)',
      similarity('backgammon', 'backgammon terminal');
  end if;
  if similarity('backgammon', 'backgammon terminals') >= 0.55 then
    raise exception 'pg_trgm: the 11/21 pair cleared 0.55 (%)',
      similarity('backgammon', 'backgammon terminals');
  end if;
end
$chk$;

savepoint chk_boundary_accept;
insert into places (id, name, aliases, kind, lat, lng)
values ('chk-bg-terminal', 'Backgammon Terminal', '{}', 'other', 41.8262, -71.4032);
do $chk$
declare
  r record;
begin
  select * into r from resolve_place('Backgammon');
  if r.place_id <> 'chk-bg-terminal' or r.method <> 'trigram' then
    raise exception 'resolve threshold: exactly 0.55 was refused (%, %, score %)',
      r.place_id, r.method, r.score;
  end if;
end
$chk$;
rollback to savepoint chk_boundary_accept;

savepoint chk_boundary_refuse;
insert into places (id, name, aliases, kind, lat, lng)
values ('chk-bg-terminals', 'Backgammon Terminals', '{}', 'other', 41.8262, -71.4032);
do $chk$
declare
  r record;
begin
  select * into r from resolve_place('Backgammon');
  if r.place_id is not null then
    raise exception 'resolve threshold: just below 0.55 was accepted (%, score %)',
      r.place_id, r.score;
  end if;
  -- the best score is still reported, which is what makes the unresolved
  -- report usable for alias growth
  if r.score is null or r.score <= 0.0 then
    raise exception 'resolve threshold: refusal reported no best score (%)', r.score;
  end if;
end
$chk$;
rollback to savepoint chk_boundary_refuse;

rollback;

\echo '0007_place_resolution_checks: all assertions passed (transaction rolled back)'
