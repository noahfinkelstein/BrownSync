-- 0004_bdh_licence_purge.sql — retain BDH headlines only, never article bodies.
--
-- The Brown Daily Herald's Terms of Use prohibit obtaining, copying,
-- monitoring, indexing, or data-mining their site or contents by robot or any
-- automated device, and their content is copyright The Brown Daily Herald, Inc.
-- Their robots.txt permits crawling (`Crawl-delay: 10`), but terms of service
-- govern over a permissive robots.txt.
--
-- Their RSS <description> carries the FULL article body in CDATA — a single
-- item in services/poller/fixtures/bdh-feed.xml is 5.5 kB of multi-paragraph
-- prose. Until 2026-07-29 the poller stored 500 characters of that body in
-- events.description and the ENTIRE parsed item, body included, in events.raw.
--
-- services/poller/src/bdh/normalize.ts now emits description = null and a
-- metadata allowlist for raw. This migration removes what was already stored,
-- so the exposure does not persist in the window before the next poll.
--
-- Scope: source = 'bdh' only. Nothing is deleted — rows keep their headline,
-- link, timestamp, byline, and section, which is what the product surfaces.
-- Idempotent: safe to re-run on any database state, including one where the
-- new normalizer has already written allowlisted rows.
--
-- See BROWNSYNC_V2_PLAN.md gate G1. Loosening this requires written permission
-- from herald@browndailyherald.com AND a coordinated change to the normalizer,
-- its tests, and (once contract v2 lands) source_registry.license.

-- 1. Drop stored article bodies.
update events
set description = null
where source = 'bdh'
  and description is not null;

-- 2. Rebuild raw from the metadata allowlist: identifiers and bibliographic
--    facts only. Mirrors safeMetadata() in the normalizer. Any key not named
--    here is dropped, so a body stored under a future element name (e.g.
--    content:encoded) is removed rather than surviving a denylist.
--
--    jsonb_strip_nulls drops absent fields instead of storing explicit nulls.
--    Non-string scalars are coerced with ->> so a guid carrying XML attributes
--    ({"#text": ..., "@_isPermaLink": ...}) collapses to its text rather than
--    smuggling a nested object through.
update events e
set raw = (
  select jsonb_strip_nulls(
    jsonb_build_object(
      'guid',    e.raw ->> 'guid',
      'link',    e.raw ->> 'link',
      'pubDate', e.raw ->> 'pubDate',
      'author',  coalesce(e.raw ->> 'author', e.raw ->> 'dc:creator')
    )
    || case
         -- The normalizer emits 'categories' (array); the pre-fix rows carry
         -- the raw RSS 'category', which is a string for one and an array for
         -- many. Normalize both to an array under the new name.
         when e.raw ? 'categories' and jsonb_typeof(e.raw -> 'categories') = 'array'
           then jsonb_build_object('categories', e.raw -> 'categories')
         when e.raw ? 'category' and jsonb_typeof(e.raw -> 'category') = 'array'
           then jsonb_build_object('categories', e.raw -> 'category')
         when e.raw ? 'category' and e.raw ->> 'category' is not null
           then jsonb_build_object('categories', jsonb_build_array(e.raw ->> 'category'))
         else '{}'::jsonb
       end
  )
)
where e.source = 'bdh'
  and e.raw is not null
  -- Only touch rows that still carry something outside the allowlist. Rows the
  -- new normalizer already wrote are left byte-identical, which keeps re-runs
  -- free and makes the guard the idempotency proof.
  and exists (
    select 1
    from jsonb_object_keys(e.raw) as k(key)
    where k.key not in ('guid', 'link', 'pubDate', 'author', 'categories')
  );
