\set ON_ERROR_STOP on

-- 0021_articles_checks.sql — semantic checks for the articles table, its
-- license CHECK architecture, and the brown_news registry row.
--
-- Run by CI's postgis job AFTER migrations with:
--   psql -v ON_ERROR_STOP=1 -f db/checks/0021_articles_checks.sql
-- from the repo root (the \i below resolves relative to the cwd).
--
-- ROLLBACK-SAFE: everything happens inside one transaction that is rolled
-- back at the end. Fixture source_ids use a chk- prefix that real listing
-- paths (/news/YYYY-MM-DD/slug) can never collide with, so this is safe to
-- point at a live database.
--
-- The negative assertions here are the point: 0004 exists because a
-- normalizer once STORED article bodies and a migration had to purge them.
-- 0021 turns that rule into CHECK constraints, and this file proves the
-- database actually rejects what the rule forbids. If a rejection assertion
-- starts failing, a constraint was weakened — fix the schema, do not relax
-- the assertion.

begin;

-- Re-apply the migration: everything in 0021 must be idempotent
-- (if-not-exists / create-or-replace / on-conflict-do-nothing).
\i db/migrations/0021_articles.sql

do $chk$
declare
  r record;
  n int;
begin
  -- 1. REJECTION: a headline_only row must not carry body text.
  begin
    insert into articles (source, source_id, title, url, published_at, license, body_text)
    values ('brown_news', 'chk-body', 'Chk', 'https://x.test/chk',
            timestamptz '2026-08-06T04:00:00Z', 'headline_only', 'article prose');
    raise exception 'articles 0021: headline_only row accepted body_text';
  exception when check_violation then null;
  end;

  -- 2. REJECTION: a headline_only row must not carry a description/excerpt.
  begin
    insert into articles (source, source_id, title, url, published_at, license, description)
    values ('brown_news', 'chk-desc', 'Chk', 'https://x.test/chk',
            timestamptz '2026-08-06T04:00:00Z', 'headline_only', 'a dek');
    raise exception 'articles 0021: headline_only row accepted a description';
  exception when check_violation then null;
  end;

  -- 3. REJECTION: an excerpt row may carry a description but never body text.
  begin
    insert into articles (source, source_id, title, url, published_at, license, body_text)
    values ('bpr', 'chk-excerpt-body', 'Chk', 'https://x.test/chk',
            timestamptz '2026-08-06T04:00:00Z', 'excerpt', 'full body');
    raise exception 'articles 0021: excerpt row accepted body_text';
  exception when check_violation then null;
  end;

  -- 4. REJECTION: license outside the fixed set.
  begin
    insert into articles (source, source_id, title, url, published_at, license)
    values ('brown_news', 'chk-license', 'Chk', 'https://x.test/chk',
            timestamptz '2026-08-06T04:00:00Z', 'everything');
    raise exception 'articles 0021: unknown license value accepted';
  exception when check_violation then null;
  end;

  -- 5. REJECTION: raw outside the metadata allowlist (a body under a future
  --    element name must fail at write time, not need a purge).
  begin
    insert into articles (source, source_id, title, url, published_at, license, raw)
    values ('brown_news', 'chk-raw', 'Chk', 'https://x.test/chk',
            timestamptz '2026-08-06T04:00:00Z', 'headline_only',
            jsonb_build_object('content:encoded', '<p>smuggled prose</p>'));
    raise exception 'articles 0021: raw accepted a key outside the allowlist';
  exception when check_violation then null;
  end;

  -- 6. REJECTION: raw must be a jsonb OBJECT (or null) — a bare string could
  --    carry arbitrary prose past the key allowlist.
  begin
    insert into articles (source, source_id, title, url, published_at, license, raw)
    values ('brown_news', 'chk-raw-scalar', 'Chk', 'https://x.test/chk',
            timestamptz '2026-08-06T04:00:00Z', 'headline_only',
            to_jsonb('a whole article as a string'::text));
    raise exception 'articles 0021: raw accepted a non-object value';
  exception when check_violation then null;
  end;

  -- 7. ADMISSION: the shape the brown_news producer actually writes.
  insert into articles (source, source_id, title, url, published_at, license, raw)
  values ('brown_news', '/news/2026-08-06/chk-slug',
          'Chk: a real headline-only row',
          'https://www.brown.edu/news/2026-08-06/chk-slug',
          timestamptz '2026-08-06T04:00:00Z', 'headline_only',
          jsonb_build_object('listing_date', '2026-08-06'));

  -- 8. UPSERT IDEMPOTENCY: the producer's on-conflict clause, twice, must
  --    leave exactly one row with the refreshed title and never a duplicate.
  insert into articles (source, source_id, title, url, published_at, author, license, raw)
  values ('brown_news', '/news/2026-08-06/chk-slug',
          'Chk: a re-seen headline',
          'https://www.brown.edu/news/2026-08-06/chk-slug',
          timestamptz '2026-08-06T04:00:00Z', null, 'headline_only',
          jsonb_build_object('listing_date', '2026-08-06'))
  on conflict (source, source_id) do update set
    title        = excluded.title,
    url          = excluded.url,
    published_at = excluded.published_at,
    author       = excluded.author,
    license      = excluded.license,
    raw          = excluded.raw,
    last_seen_at = now();

  select count(*) into n from articles
  where source = 'brown_news' and source_id = '/news/2026-08-06/chk-slug';
  if n <> 1 then
    raise exception 'articles 0021: upsert produced % rows, expected 1', n;
  end if;
  select * into r from articles
  where source = 'brown_news' and source_id = '/news/2026-08-06/chk-slug';
  if r.title <> 'Chk: a re-seen headline' then
    raise exception 'articles 0021: on-conflict update did not refresh the title';
  end if;

  -- 9. SOFT REMOVAL: is_removed hides a row from the read model without
  --    deleting it, and the on-conflict clause does not resurrect it.
  update articles set is_removed = true
  where source = 'brown_news' and source_id = '/news/2026-08-06/chk-slug';
  if exists (
    select 1 from v_articles_api v
    where v.source = 'brown_news' and v.url like '%chk-slug'
  ) then
    raise exception 'articles 0021: a removed row leaked through v_articles_api';
  end if;

  -- 10. READ MODEL: window filter, newest-first order, publication label.
  insert into articles (source, source_id, title, url, published_at, license) values
    ('brown_news', '/news/2026-08-01/chk-old', 'Chk old',
     'https://www.brown.edu/news/2026-08-01/chk-old',
     timestamptz '2026-08-01T04:00:00Z', 'headline_only'),
    ('brown_news', '/news/2026-08-05/chk-new', 'Chk new',
     'https://www.brown.edu/news/2026-08-05/chk-new',
     timestamptz '2026-08-05T04:00:00Z', 'headline_only');

  select count(*) into n
  from api_articles(timestamptz '2026-08-02T00:00:00Z', timestamptz '2026-08-07T00:00:00Z') a
  where a.source = 'brown_news' and a.url like '%chk-%';
  if n <> 1 then
    raise exception 'articles 0021: api_articles window filter returned % chk rows, expected 1', n;
  end if;

  select * into r
  from api_articles(null, null) a
  where a.source = 'brown_news' and a.url like '%chk-%'
  order by a.published_at desc
  limit 1;
  if r.title <> 'Chk new' then
    raise exception 'articles 0021: api_articles is not newest-first (got %)', r.title;
  end if;
  if r.publication <> 'Brown News' then
    raise exception 'articles 0021: publication label not joined from the registry (got %)',
      r.publication;
  end if;
  if r.license <> 'headline_only' then
    raise exception 'articles 0021: license missing from the read model';
  end if;

  -- 11. REGISTRY: the brown_news row carries the vetted operational policy.
  select * into r from source_registry where source = 'brown_news';
  if r is null then
    raise exception 'articles 0021: brown_news registry row missing';
  end if;
  if r.lane <> 'worker' or r.enabled <> true
     or r.cadence_seconds <> 1800 or r.stale_after_seconds <> 7200
     or r.license <> 'headline_only' then
    raise exception 'articles 0021: brown_news registry policy drifted (lane=% enabled=% cadence=% stale=% license=%)',
      r.lane, r.enabled, r.cadence_seconds, r.stale_after_seconds, r.license;
  end if;
  if coalesce(r.robots_note, '') = '' or coalesce(r.tos_note, '') = '' then
    raise exception 'articles 0021: brown_news registry row must carry the vetting record';
  end if;
end $chk$;

rollback;
