-- 0013_org_enrichment.sql — source-owned organization enrichment.
--
-- contact_emails is retained for owner-side claim verification but is never
-- exposed through the public PostgREST table grant.

begin;

alter table public.organizations
  add column contact_emails text[] not null default '{}',
  add column advisor text,
  add column funding_category text,
  add column website_url text,
  add column facebook_url text,
  add column linkedin_url text,
  add column youtube_url text,
  add column twitter_url text,
  add column tiktok_url text,
  add column logo_url text;

revoke select on table public.organizations from anon, authenticated;

grant select (
  id,
  name,
  kind,
  category,
  description,
  url,
  instagram,
  default_place_id,
  source,
  advisor,
  funding_category,
  website_url,
  facebook_url,
  linkedin_url,
  youtube_url,
  twitter_url,
  tiktok_url
) on table public.organizations to anon, authenticated;

commit;
