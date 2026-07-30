-- 0010_ci_auth_bootstrap.sql
--
-- Disposable-CI prerequisite only. This supplies the smallest Supabase Auth
-- surface needed by migrations 0010+ when they run in a plain PostgreSQL
-- service container. Never apply this file to a hosted Supabase project.
--
-- Every object is created only when absent so an accidental invocation cannot
-- replace a real Supabase Auth table or helper implementation.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data  jsonb not null default '{}'::jsonb
);

do $$
begin
  if to_regprocedure('auth.jwt()') is null then
    execute $create$
      create function auth.jwt()
      returns jsonb
      language sql
      stable
      set search_path = ''
      as $body$
        select coalesce(
          nullif(pg_catalog.current_setting('request.jwt.claims', true), ''),
          '{}'
        )::jsonb
      $body$
    $create$;
  end if;

  if to_regprocedure('auth.uid()') is null then
    execute $create$
      create function auth.uid()
      returns uuid
      language sql
      stable
      set search_path = ''
      as $body$
        select nullif(
          coalesce(
            nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
            (
              coalesce(
                nullif(pg_catalog.current_setting('request.jwt.claims', true), ''),
                '{}'
              )::jsonb ->> 'sub'
            )
          ),
          ''
        )::uuid
      $body$
    $create$;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

commit;
