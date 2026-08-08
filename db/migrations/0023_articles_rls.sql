-- 0023: RLS for articles — the 0011 discipline applied to the v1.9 table.
--
-- 0021 created `articles` without row security; db/checks/0011_rls_checks.sql
-- correctly went red (every application-owned public table carries RLS).
-- 0021 is applied to prod, so the fix is additive here rather than an edit.
-- Same shape as every v1 read table: RLS on, public-read policy, select
-- grants for the PostgREST roles. Writes stay owner-connection-only (the
-- Worker's Hyperdrive path); FORCE stays off so owner paths bypass, exactly
-- as 0011's check pins.

alter table public.articles enable row level security;

create policy "articles public read"
  on public.articles
  for select
  to anon, authenticated
  using (not is_removed);

grant select on table public.articles, public.v_articles_api to anon, authenticated;
