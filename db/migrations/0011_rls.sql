-- 0011_rls.sql — explicit public/member grants and row-level security.
--
-- FORCE ROW LEVEL SECURITY is intentionally not used: the deployed Worker
-- connects through Hyperdrive as the database owner and must retain its owner
-- path. Clients receive only the grants and policies below.

begin;

revoke all privileges on all tables in schema public
  from public, anon, authenticated;
revoke all privileges on all sequences in schema public
  from public, anon, authenticated;
revoke all privileges on all functions in schema public
  from public, anon, authenticated;

alter default privileges in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke all privileges on sequences from public, anon, authenticated;
alter default privileges in schema public
  revoke all privileges on functions from public, anon, authenticated;

alter table public.places enable row level security;
alter table public.organizations enable row level security;
alter table public.events enable row level security;
alter table public.course_meetings enable row level security;
alter table public.term_calendar enable row level security;
alter table public.source_runs enable row level security;
alter table public.source_registry enable row level security;
alter table public.place_aliases enable row level security;
alter table public.profiles enable row level security;

create policy "places public read"
  on public.places
  for select
  to anon, authenticated
  using (true);

create policy "organizations public read"
  on public.organizations
  for select
  to anon, authenticated
  using (true);

create policy "events public read"
  on public.events
  for select
  to anon, authenticated
  using (true);

create policy "course meetings public read"
  on public.course_meetings
  for select
  to anon, authenticated
  using (true);

create policy "term calendar public read"
  on public.term_calendar
  for select
  to anon, authenticated
  using (true);

create policy "members read profiles"
  on public.profiles
  for select
  to authenticated
  using (public.is_brown_member());

create policy "owners update profiles"
  on public.profiles
  for update
  to authenticated
  using (
    public.is_brown_member()
    and auth.uid() = id
  )
  with check (
    public.is_brown_member()
    and auth.uid() = id
  );

grant select on table
  public.places,
  public.organizations,
  public.events,
  public.course_meetings,
  public.term_calendar,
  public.v_events_api
to anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (
  display_name,
  avatar_url,
  class_year,
  concentration,
  bio
) on table public.profiles to authenticated;

-- Existing public read RPCs remain public; resolver/trigger helpers and the
-- internal health tables remain owner-only.
grant execute on function public.api_events(
  timestamptz,
  timestamptz,
  double precision,
  double precision,
  double precision,
  double precision,
  text,
  text
) to anon, authenticated;
grant execute on function public.api_meetings_at(timestamptz)
  to anon, authenticated;
grant execute on function public.is_brown_member()
  to authenticated;

-- auth.uid() is referenced directly by the owner-update policy. The CI
-- bootstrap supplies this function only when a real Supabase implementation
-- is absent.
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

commit;
