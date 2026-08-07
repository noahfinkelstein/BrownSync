-- 0020_bdh_guid_checks.sql — the attributed-guid collapse guarantee.
--
-- Run by CI's postgis job AFTER migrations with:
--   psql -v ON_ERROR_STOP=1 -f db/checks/0020_bdh_guid_checks.sql
-- from the repo root (the \i below resolves relative to the cwd).
--
-- ROLLBACK-SAFE: inserts fixture rows in both broken shapes (nested-object
-- guid, and the stringified-object guid 0004's `->>`-coercion produced),
-- applies 0004 then 0020 — 0020 twice, proving idempotency — asserts every
-- guid is collapsed to bare text, and rolls back. This file owns the guarantee
-- db/checks/0004_bdh_licence_checks.sql historically asserted (red) against
-- 0004 alone; see 0020's migration header.

begin;

delete from events where source = 'bdh' and source_id like 'chk20-%';

insert into events (source, source_id, title, description, start_ts, tags, url, raw) values
  -- Pre-0004 shape: guid is a nested attributed object (plus a body so 0004's
  -- allowlist rebuild actually fires on this row).
  ('bdh', 'chk20-obj', 'Chk20 Object Guid', null,
   timestamptz '2026-07-10T04:36:45Z', array['news'], 'https://x.test/chk20a',
   jsonb_build_object('guid', jsonb_build_object('#text', 'chk20-obj',
                                                 '@_isPermaLink', 'true'),
                      'description', 'body prose that 0004 strips')),
  -- Post-0004 mis-collapse shape: guid already a stringified object.
  ('bdh', 'chk20-str', 'Chk20 Stringified Guid', null,
   timestamptz '2026-07-10T04:36:45Z', array['news'], 'https://x.test/chk20b',
   jsonb_build_object('guid', '{"#text": "chk20-str", "@_isPermaLink": "true"}',
                      'link', 'https://x.test/chk20b')),
  -- A '{'-prefixed guid that is NOT valid JSON must survive untouched.
  ('bdh', 'chk20-braces', 'Chk20 Brace Guid', null,
   timestamptz '2026-07-10T04:36:45Z', array['news'], 'https://x.test/chk20c',
   jsonb_build_object('guid', '{not-json-at-all',
                      'link', 'https://x.test/chk20c')),
  -- An already-clean text guid must be left byte-identical.
  ('bdh', 'chk20-clean', 'Chk20 Clean', null,
   timestamptz '2026-07-10T04:36:45Z', array['news'], 'https://x.test/chk20d',
   jsonb_build_object('guid', 'chk20-clean', 'link', 'https://x.test/chk20d'));

\i db/migrations/0004_bdh_licence_purge.sql
\i db/migrations/0020_bdh_guid_collapse.sql
-- Second application must be a no-op (idempotency).
\i db/migrations/0020_bdh_guid_collapse.sql

do $chk$
declare
  r events%rowtype;
begin
  -- 1. The pre-0004 nested object collapses to bare text through the pair.
  select * into r from events where source = 'bdh' and source_id = 'chk20-obj';
  if jsonb_typeof(r.raw -> 'guid') <> 'string' or r.raw ->> 'guid' <> 'chk20-obj' then
    raise exception 'bdh 0020: nested-object guid did not collapse (got %)', r.raw -> 'guid';
  end if;

  -- 2. 0004's stringified-object output is repaired.
  select * into r from events where source = 'bdh' and source_id = 'chk20-str';
  if jsonb_typeof(r.raw -> 'guid') <> 'string' or r.raw ->> 'guid' <> 'chk20-str' then
    raise exception 'bdh 0020: stringified guid not repaired (got %)', r.raw -> 'guid';
  end if;

  -- 3. Invalid-JSON brace guid untouched.
  select * into r from events where source = 'bdh' and source_id = 'chk20-braces';
  if r.raw ->> 'guid' <> '{not-json-at-all' then
    raise exception 'bdh 0020: non-JSON brace guid was mangled (got %)', r.raw -> 'guid';
  end if;

  -- 4. Clean guid untouched.
  select * into r from events where source = 'bdh' and source_id = 'chk20-clean';
  if r.raw ->> 'guid' <> 'chk20-clean' then
    raise exception 'bdh 0020: clean guid was mangled (got %)', r.raw -> 'guid';
  end if;
end $chk$;

rollback;
