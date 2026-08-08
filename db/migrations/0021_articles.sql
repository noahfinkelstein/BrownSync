-- 0021_articles.sql — the `articles` table (contract v1.9) and its first
-- producer's registry row (`brown_news`).
--
-- ADDITIVE ONLY: one new table, one immutable helper function, one view, one
-- API function, one registry seed row. No contract §1 table is altered.
-- Numbering continues from 0020 (Lane B's paper allocation 0008/0009 is
-- permanently dead — see 0018's header).
--
-- WHY THIS TABLE EXISTS
--
-- News articles have been riding `events` (source = 'bdh') since the MVP —
-- a shape misfit the Lane B plan records explicitly ("Fixes the BDH-in-events
-- misfit"). This migration gives articles their own home. BDH itself is NOT
-- migrated here: its rows stay in `events` untouched, and moving them is a
-- separate, deliberate PR. The first writer is the `brown_news` Worker
-- producer (packages/sources/src/brown_news).
--
-- THE LICENSE ARCHITECTURE (0004's lesson, made structural)
--
-- Migration 0004 had to PURGE stored article bodies after a normalizer
-- stored 500 chars of BDH prose plus the full RSS item in `raw`. The fix
-- there was code + a data repair; here the same rule is a CHECK constraint,
-- so the database PHYSICALLY REJECTS a body for a headline-only source
-- instead of trusting every future normalizer to remember. A future
-- permission grant is an explicit, auditable `update` of the row's license
-- plus a normalizer change — never a code path that quietly starts storing
-- more.
--
-- `raw` is bounded the same way: an immutable allowlist function constrains
-- BOTH keys and value shapes (mirroring 0004's rebuild allowlist, enforced at
-- write time rather than purged after the fact). Keys must come from the
-- allowlist; every value must be a scalar of at most 512 serialized
-- characters, except `categories`, which may instead be an array of such
-- strings. So a body smuggled under a NEW element name is rejected by the key
-- rule, and a body smuggled INSIDE an allowlisted key ({"section": <5000
-- words>} or a nested object) is rejected by the value rule.
--
-- NO POSTGRES ENUM TYPES; CHECK constraints on this NEW table only
-- (DATA_CONTRACT.md §1 recorded decision).

-- ---------------------------------------------------------------------------
-- raw allowlist — identifiers and bibliographic facts, never article text.
--
-- Key-closed AND value-closed. A key allowlist alone is value-open:
-- {"section": <a whole article>} or {"categories": {"body": ...}} would pass
-- it, and `raw` would become the smuggling path 0004 existed to shut. So the
-- rule is:
--
--   * raw is NULL, or a jsonb object;
--   * every key is on the allowlist;
--   * every value is a SCALAR (string/number/boolean/null) whose jsonb text
--     serialization is at most 512 characters — long enough for any real
--     guid/link/byline, far too short for prose;
--   * `categories` alone may instead be an array, each element a string
--     under the same 512-character bound.
--
-- Extending the allowlist or the shapes is a deliberate `create or replace`
-- in a future migration, reviewed like any other schema change.
-- ---------------------------------------------------------------------------
create or replace function articles_raw_allowlisted(p_raw jsonb)
returns boolean
language sql
immutable
as $$
  select p_raw is null
      or (jsonb_typeof(p_raw) = 'object'
          and not exists (
            select 1
            from jsonb_each(p_raw) as e(key, value)
            where
              -- key must be allowlisted…
              e.key not in
                ('guid', 'link', 'pubDate', 'published', 'author',
                 'categories', 'section', 'listing_date')
              -- …and the value must be a bounded scalar,
              or not (
                (jsonb_typeof(e.value) in ('string', 'number', 'boolean', 'null')
                 and length(e.value::text) <= 512)
                -- or, for categories only, an array of bounded strings.
                or (e.key = 'categories'
                    and jsonb_typeof(e.value) = 'array'
                    and not exists (
                      select 1
                      from jsonb_array_elements(e.value) as a(item)
                      where jsonb_typeof(a.item) <> 'string'
                         or length(a.item::text) > 512
                    ))
              )
          ));
$$;

comment on function articles_raw_allowlisted(jsonb) is
  'CHECK helper for articles.raw: key allowlist + value-shape bound (scalars '
  '<= 512 serialized chars; categories may be an array of such strings). '
  '0004''s BDH allowlist, enforced at write time instead of purged after '
  'the fact.';

create table if not exists articles (
  id            uuid primary key default gen_random_uuid(),
  -- Matches source_registry.source by convention, never by FK (0006's rule:
  -- a new source must not fail to upsert because nobody registered it).
  source        text not null,
  -- Stable ID within the source. For brown_news: the dateful listing path
  -- '/news/YYYY-MM-DD/slug'.
  source_id     text not null,
  title         text not null,
  url           text not null,
  published_at  timestamptz not null,
  author        text,
  -- How much of the article we are permitted to store and redistribute.
  -- Copied per row from the source's registry policy so the CHECKs below can
  -- gate the row itself: policy lives in source_registry, proof lives here.
  license       text not null,
  -- Dek/excerpt-level text: permitted only when license allows ('excerpt' or
  -- 'full'). brown_news never writes it — headline+URL+date only.
  description   text,
  -- Full body text: 'full' license only. No current source qualifies.
  body_text     text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  -- Soft removal flag. Nothing hard-deletes an article (contract §2's "never
  -- hard-delete", same as events.is_canceled): a removed/retracted piece is
  -- flagged out of the read API but its row and provenance survive.
  is_removed    boolean not null default false,
  raw           jsonb,
  unique (source, source_id),
  constraint articles_license_ck
    check (license in ('headline_only', 'excerpt', 'full')),
  -- THE LEGAL GATE, STRUCTURAL: a headline-only row can carry no text beyond
  -- its title. This is what 0004 had to repair after the fact for events.
  constraint articles_headline_only_ck
    check (license <> 'headline_only'
           or (description is null and body_text is null)),
  constraint articles_body_ck
    check (license = 'full' or body_text is null),
  constraint articles_raw_allowlist_ck
    check (articles_raw_allowlisted(raw))
);

comment on table articles is
  'News articles, one row per (source, source_id). License CHECKs make '
  'headline-only structural: the DB rejects body text for a headline_only '
  'row. BDH rows remain in events until their own migration PR.';

-- The feed read pattern: newest first, optionally per source.
create index if not exists articles_published_idx
  on articles (published_at desc, id);
create index if not exists articles_source_published_idx
  on articles (source, published_at desc);

-- ---------------------------------------------------------------------------
-- v_articles_api — the read model. Removed rows are invisible; the registry
-- label rides along as `publication` so attribution ("Brown News") is data
-- from the same row that records the source's robots/ToS findings.
-- ---------------------------------------------------------------------------
create or replace view v_articles_api as
select
  a.id,
  a.title,
  a.url,
  a.published_at,
  a.author,
  a.source,
  coalesce(r.label, a.source) as publication,
  a.license
from articles a
left join source_registry r on r.source = a.source
where a.is_removed = false;

-- ---------------------------------------------------------------------------
-- api_articles — time-window filtering, newest first. Both bounds nullable =
-- unfiltered; the API layer supplies its own defaults (contract §3).
-- ---------------------------------------------------------------------------
create or replace function api_articles(
  p_from timestamptz default null,
  p_to   timestamptz default null
) returns setof v_articles_api
language sql
stable
as $$
  select v.*
  from v_articles_api v
  where (p_from is null or v.published_at >= p_from)
    and (p_to   is null or v.published_at <= p_to)
  order by v.published_at desc, v.id asc
  limit 500;
$$;

-- ---------------------------------------------------------------------------
-- Registry row: brown_news (vetted and CLEARED 2026-08-07 — see
-- reports/ops/2026-08-07-source-vetting.md). `on conflict do nothing` so
-- re-running never clobbers live operator tuning (0006's convention).
-- feed_weight 0.9 matches the other news source (bdh).
-- ---------------------------------------------------------------------------
insert into source_registry (
  source, label, lane, enabled, cadence_seconds, stale_after_seconds,
  etiquette_min_interval_seconds, robots_note, tos_note, license,
  feed_weight, endpoint, notes
) values
  ('brown_news', 'Brown News', 'worker', true, 1800, 7200, 1,
   'www.brown.edu robots.txt (fetched 2026-08-07): standard Drupal profile; '
   '/news is NOT disallowed (blocks are /core/, /admin/, /search/, /user/*). '
   'No crawl-delay directive.',
   'Publisher is Brown University itself; still headline+URL+date only, '
   'consistent with every articles row. NO live feed exists: root rss.xml is '
   'a dead 2019 channel (never use it); /news/feed, /news/rss 404; '
   '/news?_format=rss 406. The producer parses the server-rendered listing '
   '(stable dateful hrefs /news/YYYY-MM-DD/slug).',
   'headline_only', 0.9,
   'https://www.brown.edu/news',
   'Producer: packages/sources/src/brown_news (Worker dispatcher lane). '
   'FAIL-CLOSED GATE: <10 parsed listing items means selector drift — the '
   'run records partial and upserts NOTHING, previous rows untouched. '
   'Recorded fixture: services/poller/fixtures/brown-news-listing.html.')
on conflict (source) do nothing;
