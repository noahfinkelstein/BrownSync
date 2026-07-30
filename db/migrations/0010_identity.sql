-- 0010_identity.sql — Brown/Google admission and member profiles.
--
-- The original kickoff sketch combined admission and profile creation in one
-- AFTER INSERT trigger, called an undefined derive_handle(), and trusted
-- user-editable verification metadata. This migration deliberately separates
-- the transactional BEFORE INSERT admission gate from the AFTER INSERT
-- profile side effect and trusts only auth.users.raw_app_meta_data.

begin;

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  handle        text unique not null,
  display_name  text not null,
  avatar_url    text,
  class_year    int,
  concentration text,
  bio           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_handle_ck check (handle ~ '^[a-z0-9_]{3,24}$')
);

-- Trusted Google provenance may be represented by Supabase as either the
-- primary provider string or an entry in the providers array.
create function public.brownsync_has_google_provider(p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    pg_catalog.lower(coalesce(p_metadata ->> 'provider', '')) = 'google'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(
        case
          when pg_catalog.jsonb_typeof(p_metadata -> 'providers') = 'array'
            then p_metadata -> 'providers'
          else '[]'::jsonb
        end
      ) as provider(value)
      where pg_catalog.lower(provider.value) = 'google'
    )
$$;

-- THE admission gate. Raising from a BEFORE INSERT trigger aborts the entire
-- auth.users insert before an account or dependent profile can land.
create function public.brownsync_enforce_user_admission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.email, '')
       !~* '^[^@[:space:]]+@brown[.]edu$'
     or not public.brownsync_has_google_provider(
       coalesce(new.raw_app_meta_data, '{}'::jsonb)
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ADMISSION_DENIED';
  end if;

  return new;
end
$$;

create trigger brownsync_auth_user_admission
  before insert on auth.users
  for each row execute function public.brownsync_enforce_user_admission();

-- Race-safe profile creation. Attempt zero is the normalized email local part.
-- On a collision, attempts 1..8 use a deterministic 8-hex digest derived from
-- the immutable user UUID and attempt number. Every attempt is one
-- INSERT ... ON CONFLICT DO NOTHING; there is no select-then-insert race.
create function public.brownsync_insert_profile(
  p_id uuid,
  p_email text,
  p_user_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt      int;
  v_base         text;
  v_candidate    text;
  v_display_name text;
  v_inserted     int;
  v_suffix       text;
  v_uuid_hex     text := pg_catalog.replace(p_id::text, '-', '');
begin
  v_base := pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.split_part(coalesce(p_email, ''), '@', 1)),
    '[^a-z0-9_]+',
    '_',
    'g'
  );
  v_base := pg_catalog.regexp_replace(v_base, '_+', '_', 'g');
  v_base := pg_catalog.btrim(v_base, '_');
  v_base := pg_catalog.rtrim(pg_catalog.left(v_base, 24), '_');

  if pg_catalog.length(v_base) < 3 then
    if v_base = '' then
      v_base := 'member_' || pg_catalog.left(v_uuid_hex, 8);
    else
      v_base := v_base || '_' || pg_catalog.left(v_uuid_hex, 8);
    end if;
  end if;
  v_base := pg_catalog.rtrim(pg_catalog.left(v_base, 24), '_');

  v_display_name := coalesce(
    nullif(
      pg_catalog.btrim(
        coalesce(
          p_user_metadata ->> 'full_name',
          p_user_metadata ->> 'name',
          ''
        )
      ),
      ''
    ),
    nullif(
      pg_catalog.split_part(coalesce(p_email, ''), '@', 1),
      ''
    ),
    'Brown Student'
  );

  for v_attempt in 0..8 loop
    if v_attempt = 0 then
      v_candidate := v_base;
    else
      v_suffix := pg_catalog.left(
        pg_catalog.md5(p_id::text || ':' || v_attempt::text),
        8
      );
      v_candidate :=
        pg_catalog.left(v_base, 24 - 1 - pg_catalog.length(v_suffix))
        || '_'
        || v_suffix;
    end if;

    v_inserted := null;
    insert into public.profiles (id, handle, display_name)
    values (p_id, v_candidate, v_display_name)
    on conflict do nothing
    returning 1 into v_inserted;

    if v_inserted = 1 then
      return;
    end if;
  end loop;

  raise exception using
    errcode = 'P0001',
    message = 'BROWNSYNC_PROFILE_HANDLE_EXHAUSTED';
end
$$;

create function public.brownsync_create_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.brownsync_insert_profile(
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  );
  return new;
end
$$;

create trigger brownsync_auth_user_profile
  after insert on auth.users
  for each row execute function public.brownsync_create_user_profile();

-- Existing auth rows predate the new admission trigger. Backfill only rows
-- that independently satisfy the exact Brown/Google admission predicate.
-- Ineligible legacy rows receive no profile and is_brown_member() below also
-- rejects their JWT claims, so they cannot gain member-table access.
do $$
declare
  existing_user record;
begin
  for existing_user in
    select
      u.id,
      u.email,
      coalesce(u.raw_user_meta_data, '{}'::jsonb) as user_metadata
    from auth.users u
    where coalesce(u.email, '')
            ~* '^[^@[:space:]]+@brown[.]edu$'
      and public.brownsync_has_google_provider(
        coalesce(u.raw_app_meta_data, '{}'::jsonb)
      )
      and not exists (
        select 1 from public.profiles p where p.id = u.id
      )
  loop
    perform public.brownsync_insert_profile(
      existing_user.id,
      existing_user.email,
      existing_user.user_metadata
    );
  end loop;
end
$$;

-- Defense in depth for every member-facing policy. Only the trusted JWT
-- top-level email and app_metadata participate; user_metadata is ignored.
create function public.is_brown_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(auth.jwt() ->> 'email', '')
      ~* '^[^@[:space:]]+@brown[.]edu$'
    and public.brownsync_has_google_provider(
      coalesce(auth.jwt() -> 'app_metadata', '{}'::jsonb)
    )
$$;

create function public.brownsync_profiles_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

create trigger brownsync_profiles_updated_at
  before update on public.profiles
  for each row execute function public.brownsync_profiles_set_updated_at();

-- Trigger/helpers are callable only through their trigger/function owners.
-- is_brown_member() is granted explicitly to authenticated in 0011_rls.sql.
revoke all on function public.brownsync_has_google_provider(jsonb)
  from public, anon, authenticated;
revoke all on function public.brownsync_enforce_user_admission()
  from public, anon, authenticated;
revoke all on function public.brownsync_insert_profile(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.brownsync_create_user_profile()
  from public, anon, authenticated;
revoke all on function public.is_brown_member()
  from public, anon, authenticated;
revoke all on function public.brownsync_profiles_set_updated_at()
  from public, anon, authenticated;

commit;
