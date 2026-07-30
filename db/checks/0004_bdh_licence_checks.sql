-- 0004_bdh_licence_checks.sql — semantic checks for the BDH headline-only purge.
--
-- Run by CI's postgis job AFTER migrations with:
--   psql -v ON_ERROR_STOP=1 -f db/checks/0004_bdh_licence_checks.sql
-- from the repo root (the \i below resolves relative to the cwd).
--
-- ROLLBACK-SAFE: the transaction inserts pre-fix BDH fixture rows (bodies in
-- both description and raw), re-applies the migration via \i — twice, proving
-- idempotency — asserts the outcome, and rolls everything back. Fixture
-- source_ids use a chk- prefix that real BDH guids (absolute URLs) can never
-- collide with, so this is safe to point at a live database.
--
-- This file is the regression guard for gate G1 in BROWNSYNC_V2_PLAN.md. If it
-- starts failing because a normalizer began storing bodies again, that is the
-- test doing its job — fix the normalizer, do not relax the assertion.

begin;

delete from events where source = 'bdh' and source_id like 'chk-%';

-- Pre-fix world, exactly as the old normalizer wrote it: a truncated body in
-- description, and the whole parsed RSS item in raw.
insert into events (source, source_id, title, description, start_ts, tags, url, raw) values
  ('bdh', 'chk-body', 'Chk Headline',
   'The Generative AI in Teaching and Learning Committee report found asymmetric patterns.',
   timestamptz '2026-07-10T04:36:45Z', array['news'],
   'https://www.browndailyherald.com/article/chk-body',
   jsonb_build_object(
     'title', 'Chk Headline',
     'description', '<p>Full multi-paragraph article body that must not survive.</p>',
     'category', jsonb_build_array('University News', 'homepage'),
     'author', 'Ivy Huang',
     'pubDate', 'Fri, 10 Jul 2026 00:36:45 -0400',
     'guid', 'https://www.browndailyherald.com/article/chk-body',
     'link', 'https://www.browndailyherald.com/article/chk-body')),
  -- Single <category> parses as a string, not an array.
  ('bdh', 'chk-single-cat', 'Chk Single Category', 'body',
   timestamptz '2026-07-10T04:36:45Z', array['news'], 'https://x.test/chk2',
   jsonb_build_object('category', 'Sports', 'guid', 'chk-single-cat',
                      'description', 'body prose', 'link', 'https://x.test/chk2')),
  -- guid carrying XML attributes must collapse to its text, not a nested object.
  ('bdh', 'chk-guid-obj', 'Chk Guid Object', null,
   timestamptz '2026-07-10T04:36:45Z', array['news'], 'https://x.test/chk3',
   jsonb_build_object('guid', jsonb_build_object('#text', 'chk-guid-obj',
                                                 '@_isPermaLink', 'true'),
                      'description', 'more prose')),
  -- A row the NEW normalizer already wrote must be left byte-identical.
  ('bdh', 'chk-already-clean', 'Chk Clean', null,
   timestamptz '2026-07-10T04:36:45Z', array['news'], 'https://x.test/chk4',
   jsonb_build_object('guid', 'chk-already-clean', 'link', 'https://x.test/chk4',
                      'pubDate', 'Fri, 10 Jul 2026 00:36:45 -0400',
                      'categories', jsonb_build_array('Metro'), 'author', 'A Reporter'));

-- A non-BDH row that must be untouched (the migration is source-scoped).
insert into events (source, source_id, title, description, start_ts, raw) values
  ('livewhale', 'chk-untouched', 'Chk Other Source', 'this description must survive',
   timestamptz '2026-07-10T04:36:45Z', jsonb_build_object('anything', 'preserved'));

\i db/migrations/0004_bdh_licence_purge.sql
-- Second application must be a no-op (idempotency).
\i db/migrations/0004_bdh_licence_purge.sql

do $chk$
declare
  r record;
  bad text;
begin
  -- 1. No BDH row retains a description.
  if exists (select 1 from events
             where source = 'bdh' and source_id like 'chk-%' and description is not null) then
    raise exception 'bdh 0004: a description survived the purge';
  end if;

  -- 2. No BDH raw retains a key outside the allowlist.
  select string_agg(distinct k.key, ', ') into bad
  from events e, jsonb_object_keys(e.raw) as k(key)
  where e.source = 'bdh' and e.source_id like 'chk-%'
    and k.key not in ('guid', 'link', 'pubDate', 'author', 'categories');
  if bad is not null then
    raise exception 'bdh 0004: disallowed keys survived in raw: %', bad;
  end if;

  -- 3. No article prose anywhere in the retained payload.
  if exists (select 1 from events
             where source = 'bdh' and source_id like 'chk-%'
               and (raw::text ilike '%prose%' or raw::text ilike '%article body%')) then
    raise exception 'bdh 0004: article prose survived in raw';
  end if;

  -- 4. Bibliographic metadata is retained, and <category> is normalized to a
  --    'categories' array regardless of whether it arrived as one or many.
  select * into r from events where source = 'bdh' and source_id = 'chk-body';
  if r.raw ->> 'author' <> 'Ivy Huang' then
    raise exception 'bdh 0004: author was dropped (got %)', r.raw ->> 'author';
  end if;
  if r.raw -> 'categories' <> jsonb_build_array('University News', 'homepage') then
    raise exception 'bdh 0004: categories not carried over (got %)', r.raw -> 'categories';
  end if;
  if r.raw ->> 'pubDate' <> 'Fri, 10 Jul 2026 00:36:45 -0400' then
    raise exception 'bdh 0004: pubDate was dropped';
  end if;
  if r.title <> 'Chk Headline' or r.url is null then
    raise exception 'bdh 0004: headline or link was lost — the row must stay usable';
  end if;

  select * into r from events where source = 'bdh' and source_id = 'chk-single-cat';
  if r.raw -> 'categories' <> jsonb_build_array('Sports') then
    raise exception 'bdh 0004: single category not normalized to an array (got %)',
      r.raw -> 'categories';
  end if;

  -- 5. A guid arriving as an attributed object collapses to its text.
  select * into r from events where source = 'bdh' and source_id = 'chk-guid-obj';
  if jsonb_typeof(r.raw -> 'guid') <> 'string' or r.raw ->> 'guid' <> 'chk-guid-obj' then
    raise exception 'bdh 0004: attributed guid did not collapse to text (got %)', r.raw -> 'guid';
  end if;

  -- 6. An already-clean row keeps every allowlisted field.
  select * into r from events where source = 'bdh' and source_id = 'chk-already-clean';
  if r.raw ->> 'author' <> 'A Reporter'
     or r.raw -> 'categories' <> jsonb_build_array('Metro')
     or r.raw ->> 'link' <> 'https://x.test/chk4' then
    raise exception 'bdh 0004: an already-clean row was damaged (raw=%)', r.raw;
  end if;

  -- 7. The migration is source-scoped: other sources are untouched.
  select * into r from events where source = 'livewhale' and source_id = 'chk-untouched';
  if r.description is distinct from 'this description must survive'
     or r.raw ->> 'anything' <> 'preserved' then
    raise exception 'bdh 0004: migration leaked outside source = bdh';
  end if;
end $chk$;

rollback;
