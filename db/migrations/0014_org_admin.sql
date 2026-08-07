-- 0014_org_admin.sql — private organization claims, administration, and
-- seed-surviving content overlays.
--
-- Product writes enter through owner-only SECURITY DEFINER routines called by
-- the verified Worker. RLS remains enabled as defense in depth, but production
-- client roles receive no direct table DML or function execution.

begin;

create table public.org_reviewers (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint org_reviewers_no_self_grant_ck
    check (granted_by is null or granted_by <> user_id),
  constraint org_reviewers_granted_at_ck
    check (pg_catalog.isfinite(granted_at))
);

create table public.org_claims (
  id              uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id text not null
                    references public.organizations(id) on delete cascade,
  user_id         uuid not null
                    references public.profiles(id) on delete cascade,
  status          text not null default 'pending',
  evidence        text,
  decision_kind   text,
  reviewed_by     uuid references public.profiles(id) on delete set null,
  reviewed_at     timestamptz,
  review_note     text,
  granted_role    text,
  created_at      timestamptz not null default pg_catalog.clock_timestamp(),
  unique (organization_id, user_id),
  constraint org_claims_status_ck
    check (status in ('pending', 'approved', 'rejected')),
  constraint org_claims_evidence_ck check (
    evidence is null
    or (
      pg_catalog.char_length(evidence) between 1 and 2000
      and evidence = pg_catalog.btrim(evidence)
    )
  ),
  constraint org_claims_decision_kind_ck check (
    decision_kind is null
    or decision_kind in ('contact_auto', 'owner_review', 'platform_review')
  ),
  constraint org_claims_note_ck
    check (review_note is null or pg_catalog.char_length(review_note) <= 2000),
  constraint org_claims_role_ck
    check (granted_role is null or granted_role in ('owner', 'editor')),
  constraint org_claims_time_ck check (
    pg_catalog.isfinite(created_at)
    and (reviewed_at is null or pg_catalog.isfinite(reviewed_at))
  ),
  constraint org_claims_state_ck check (
    (
      status = 'pending'
      and decision_kind is null
      and reviewed_by is null
      and reviewed_at is null
      and review_note is null
      and granted_role is null
    )
    or (
      status = 'approved'
      and decision_kind is not null
      and reviewed_at is not null
      and granted_role is not null
      and (
        decision_kind <> 'contact_auto'
        or reviewed_by is null
      )
    )
    or (
      status = 'rejected'
      and decision_kind in ('owner_review', 'platform_review')
      and reviewed_at is not null
      and granted_role is null
    )
  )
);

create table public.org_admins (
  organization_id text not null
                    references public.organizations(id) on delete cascade,
  user_id         uuid not null
                    references public.profiles(id) on delete cascade,
  role            text not null,
  grant_source    text not null,
  granted_by      uuid references public.profiles(id) on delete set null,
  granted_at      timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (organization_id, user_id),
  constraint org_admins_role_ck
    check (role in ('owner', 'editor')),
  constraint org_admins_grant_source_ck
    check (grant_source in ('contact_auto', 'manual_claim', 'owner_grant', 'creator')),
  constraint org_admins_no_self_grant_ck
    check (granted_by is null or granted_by <> user_id),
  constraint org_admins_granted_at_ck
    check (pg_catalog.isfinite(granted_at))
);

create index org_admins_user_idx
  on public.org_admins (user_id, organization_id);

create table public.org_overrides (
  organization_id text primary key
                    references public.organizations(id) on delete cascade,
  description     text,
  about_md        text,
  meeting_info    text,
  links           jsonb,
  avatar_url      text,
  banner_url      text,
  revision        bigint not null,
  updated_by      uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null,
  constraint org_overrides_description_ck
    check (description is null or pg_catalog.char_length(description) <= 10000),
  constraint org_overrides_about_ck
    check (about_md is null or pg_catalog.char_length(about_md) <= 20000),
  constraint org_overrides_meeting_ck
    check (meeting_info is null or pg_catalog.char_length(meeting_info) <= 4000),
  constraint org_overrides_links_top_ck check (
    links is null
    or (
      pg_catalog.jsonb_typeof(links) = 'array'
      and pg_catalog.jsonb_array_length(links) <= 20
    )
  ),
  constraint org_overrides_avatar_ck check (
    avatar_url is null
    or (
      pg_catalog.char_length(avatar_url) <= 2048
      and avatar_url ~ '^https://[^[:space:]]+$'
    )
  ),
  constraint org_overrides_banner_ck check (
    banner_url is null
    or (
      pg_catalog.char_length(banner_url) <= 2048
      and banner_url ~ '^https://[^[:space:]]+$'
    )
  ),
  constraint org_overrides_revision_ck check (revision > 0),
  constraint org_overrides_updated_at_ck
    check (pg_catalog.isfinite(updated_at))
);

create table public.org_edits (
  id              uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id text not null
                    references public.organizations(id) on delete cascade,
  actor_user_id   uuid references public.profiles(id) on delete set null,
  target_user_id  uuid references public.profiles(id) on delete set null,
  claim_id        uuid references public.org_claims(id) on delete set null,
  action          text not null,
  revision        bigint,
  before_state    jsonb not null default '{}'::jsonb,
  after_state     jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default pg_catalog.clock_timestamp(),
  constraint org_edits_action_ck check (action in (
    'org_created',
    'claim_submitted',
    'claim_auto_approved',
    'claim_approved',
    'claim_rejected',
    'admin_granted',
    'admin_role_changed',
    'admin_removed',
    'admin_left',
    'content_edited',
    'content_reverted'
  )),
  constraint org_edits_state_ck check (
    pg_catalog.jsonb_typeof(before_state) = 'object'
    and pg_catalog.jsonb_typeof(after_state) = 'object'
  ),
  constraint org_edits_revision_ck check (
    (
      action in ('content_edited', 'content_reverted')
      and revision is not null
      and revision > 0
    )
    or (
      action not in ('content_edited', 'content_reverted')
      and revision is null
    )
  ),
  constraint org_edits_created_at_ck
    check (pg_catalog.isfinite(created_at))
);

create unique index org_edits_revision_uidx
  on public.org_edits (organization_id, revision)
  where revision is not null;

create index org_edits_org_created_idx
  on public.org_edits (organization_id, created_at, id);

create table public.org_write_limits (
  user_id           uuid not null
                      references public.profiles(id) on delete cascade,
  bucket            text not null,
  window_started_at timestamptz not null,
  count             integer not null default 0,
  primary key (user_id, bucket),
  constraint org_write_limits_bucket_ck
    check (bucket in ('claim_day', 'mutation_minute')),
  constraint org_write_limits_count_ck
    check (count between 0 and 30),
  constraint org_write_limits_time_ck
    check (pg_catalog.isfinite(window_started_at))
);

create index org_claims_user_org_idx
  on public.org_claims (user_id, organization_id);
create index org_claims_pending_created_idx
  on public.org_claims (created_at, id)
  where status = 'pending';
create index org_claims_reviewed_by_idx
  on public.org_claims (reviewed_by)
  where reviewed_by is not null;
create index org_reviewers_granted_by_idx
  on public.org_reviewers (granted_by)
  where granted_by is not null;
create index org_admins_granted_by_idx
  on public.org_admins (granted_by)
  where granted_by is not null;
create index org_overrides_updated_by_idx
  on public.org_overrides (updated_by)
  where updated_by is not null;
create index org_edits_actor_user_idx
  on public.org_edits (actor_user_id)
  where actor_user_id is not null;
create index org_edits_target_user_idx
  on public.org_edits (target_user_id)
  where target_user_id is not null;
create index org_edits_claim_idx
  on public.org_edits (claim_id)
  where claim_id is not null;

alter table public.org_reviewers enable row level security;
alter table public.org_claims enable row level security;
alter table public.org_admins enable row level security;
alter table public.org_overrides enable row level security;
alter table public.org_edits enable row level security;
alter table public.org_write_limits enable row level security;

-- Require a surviving admitted identity, independently of the Worker's JWT
-- verification. Holding an old signed token after account deletion is not
-- sufficient because both rows must still exist.
create function public.brownsync_require_org_actor(p_actor uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if p_actor is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_UNAUTHORIZED';
  end if;

  select pg_catalog.lower(pg_catalog.btrim(u.email))
  into v_email
  from auth.users as u
  where u.id = p_actor
    and coalesce(u.email, '') ~* '^[^@[:space:]]+@brown[.]edu$'
    and public.brownsync_has_google_provider(
      coalesce(u.raw_app_meta_data, '{}'::jsonb)
    )
  for key share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_UNAUTHORIZED';
  end if;

  perform 1
  from public.profiles as p
  where p.id = p_actor
  for key share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_UNAUTHORIZED';
  end if;

  return v_email;
end
$$;

-- Safety-reducing operations must serialize with account deletion without
-- requiring the target to remain an eligible Brown/Google actor. Match the
-- auth.users -> profiles order used by auth account deletion before any
-- organization child row is locked.
create function public.brownsync_lock_org_subject(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null then
    return false;
  end if;

  perform 1
  from auth.users as u
  where u.id = p_user
  for key share;
  if not found then
    return false;
  end if;

  perform 1
  from public.profiles as p
  where p.id = p_user
  for key share;
  return found;
end
$$;

create function public.brownsync_is_org_reviewer(p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor is not null
    and exists (
      select 1
      from public.org_reviewers as r
      where r.user_id = p_actor
    )
$$;

create function public.brownsync_is_org_admin(
  p_actor uuid,
  p_organization_id text,
  p_required_role text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor is not null
    and p_organization_id is not null
    and exists (
      select 1
      from public.org_admins as a
      where a.organization_id = p_organization_id
        and a.user_id = p_actor
        and (
          p_required_role is null
          or a.role = p_required_role
        )
    )
$$;

create function public.brownsync_lock_organization(p_organization_id text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations%rowtype;
begin
  select o.*
  into v_org
  from public.organizations as o
  where o.id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_NOT_FOUND';
  end if;

  return v_org;
end
$$;

create function public.brownsync_validate_org_links(p_links jsonb)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_item       jsonb;
  v_label      text;
  v_normalized text;
  v_platform   text;
  v_seen       text[] := '{}';
  v_url        text;
begin
  if p_links is null then
    return true;
  end if;

  if pg_catalog.jsonb_typeof(p_links) <> 'array'
     or pg_catalog.jsonb_array_length(p_links) > 20 then
    return false;
  end if;

  for v_item in
    select value from pg_catalog.jsonb_array_elements(p_links)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or not (v_item ? 'platform')
       or not (v_item ? 'url')
       or (v_item - array['platform', 'url', 'label']::text[]) <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(v_item -> 'platform') <> 'string'
       or pg_catalog.jsonb_typeof(v_item -> 'url') <> 'string' then
      return false;
    end if;

    v_platform := v_item ->> 'platform';
    v_url := v_item ->> 'url';
    if v_platform not in (
      'instagram',
      'discord',
      'facebook',
      'linkedin',
      'youtube',
      'x',
      'tiktok',
      'website',
      'other'
    ) or pg_catalog.char_length(v_url) > 2048
       or v_url !~ '^https://[^[:space:]]+$' then
      return false;
    end if;

    if v_item ? 'label'
       and pg_catalog.jsonb_typeof(v_item -> 'label') not in ('string', 'null') then
      return false;
    end if;
    v_label := v_item ->> 'label';
    if v_label is not null and pg_catalog.char_length(v_label) > 80 then
      return false;
    end if;

    v_normalized := pg_catalog.lower(
      pg_catalog.rtrim(pg_catalog.btrim(v_url), '/')
    );
    if v_normalized = any(v_seen) then
      return false;
    end if;
    v_seen := pg_catalog.array_append(v_seen, v_normalized);
  end loop;

  return true;
end
$$;

alter table public.org_overrides
  add constraint org_overrides_links_structural_ck
  check (public.brownsync_validate_org_links(links));

create function public.brownsync_org_override_snapshot(
  p_description text,
  p_about_md text,
  p_meeting_info text,
  p_links jsonb,
  p_avatar_url text,
  p_banner_url text
)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'description', p_description,
    'about_md', p_about_md,
    'meeting_info', p_meeting_info,
    'links', p_links,
    'avatar_url', p_avatar_url,
    'banner_url', p_banner_url
  )
$$;

create function public.brownsync_consume_org_write_limit(
  p_actor uuid,
  p_bucket text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count             integer;
  v_limit             integer;
  v_now               timestamptz;
  v_window            interval;
  v_window_started_at timestamptz;
begin
  perform public.brownsync_require_org_actor(p_actor);

  if p_bucket = 'claim_day' then
    v_limit := 5;
    v_window := interval '24 hours';
  elsif p_bucket = 'mutation_minute' then
    v_limit := 30;
    v_window := interval '60 seconds';
  else
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_RATE_LIMITED';
  end if;

  v_now := pg_catalog.clock_timestamp();
  insert into public.org_write_limits (
    user_id,
    bucket,
    window_started_at,
    count
  ) values (
    p_actor,
    p_bucket,
    v_now,
    0
  )
  on conflict (user_id, bucket) do nothing;

  select l.window_started_at, l.count
  into v_window_started_at, v_count
  from public.org_write_limits as l
  where l.user_id = p_actor
    and l.bucket = p_bucket
  for update;

  v_now := pg_catalog.clock_timestamp();
  if v_now >= v_window_started_at + v_window then
    update public.org_write_limits
    set window_started_at = v_now,
        count = 1
    where user_id = p_actor
      and bucket = p_bucket;
  elsif v_count >= v_limit then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_RATE_LIMITED';
  else
    update public.org_write_limits
    set count = count + 1
    where user_id = p_actor
      and bucket = p_bucket;
  end if;
end
$$;

-- A user-created organization is outside the seed producer's namespace. If a
-- future source row collides with its deterministic id, the seed upsert is a
-- no-op rather than overwriting user-owned identity/content.
create function public.brownsync_protect_user_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.source = 'user' then
    return old;
  end if;
  return new;
end
$$;

create trigger brownsync_protect_user_organization
  before update on public.organizations
  for each row execute function public.brownsync_protect_user_organization();

create function public.brownsync_seed_org_links(
  p_website text,
  p_instagram text,
  p_facebook text,
  p_linkedin text,
  p_youtube text,
  p_twitter text,
  p_tiktok text
)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(v.item order by v.rank)
      filter (where v.item is not null),
    '[]'::jsonb
  )
  from (
    values
      (
        1,
          case when p_website is null
               or pg_catalog.char_length(p_website) > 2048
               or p_website !~ '^https://[^[:space:]]+$' then null else
          pg_catalog.jsonb_build_object('platform', 'website', 'url', p_website)
        end
      ),
      (
        2,
          case when p_instagram is null
               or pg_catalog.char_length(p_instagram) > 2048
               or p_instagram !~ '^https://[^[:space:]]+$' then null else
          pg_catalog.jsonb_build_object('platform', 'instagram', 'url', p_instagram)
        end
      ),
      (
        3,
          case when p_facebook is null
               or pg_catalog.char_length(p_facebook) > 2048
               or p_facebook !~ '^https://[^[:space:]]+$' then null else
          pg_catalog.jsonb_build_object('platform', 'facebook', 'url', p_facebook)
        end
      ),
      (
        4,
          case when p_linkedin is null
               or pg_catalog.char_length(p_linkedin) > 2048
               or p_linkedin !~ '^https://[^[:space:]]+$' then null else
          pg_catalog.jsonb_build_object('platform', 'linkedin', 'url', p_linkedin)
        end
      ),
      (
        5,
          case when p_youtube is null
               or pg_catalog.char_length(p_youtube) > 2048
               or p_youtube !~ '^https://[^[:space:]]+$' then null else
          pg_catalog.jsonb_build_object('platform', 'youtube', 'url', p_youtube)
        end
      ),
      (
        6,
          case when p_twitter is null
               or pg_catalog.char_length(p_twitter) > 2048
               or p_twitter !~ '^https://[^[:space:]]+$' then null else
          pg_catalog.jsonb_build_object('platform', 'x', 'url', p_twitter)
        end
      ),
      (
        7,
          case when p_tiktok is null
               or pg_catalog.char_length(p_tiktok) > 2048
               or p_tiktok !~ '^https://[^[:space:]]+$' then null else
          pg_catalog.jsonb_build_object('platform', 'tiktok', 'url', p_tiktok)
        end
      )
  ) as v(rank, item)
$$;

create view public.v_organizations_api
with (security_barrier = true)
as
select
  o.id,
  o.name,
  o.kind,
  o.category,
  coalesce(x.description, o.description) as description,
  o.url,
  o.instagram,
  o.default_place_id,
  o.source,
  o.advisor,
  o.funding_category,
  o.website_url,
  o.facebook_url,
  o.linkedin_url,
  o.youtube_url,
  o.twitter_url,
  o.tiktok_url,
  null::text as logo_url,
  x.about_md,
  x.meeting_info,
  coalesce(
    x.links,
    public.brownsync_seed_org_links(
      o.website_url,
      o.instagram,
      o.facebook_url,
      o.linkedin_url,
      o.youtube_url,
      o.twitter_url,
      o.tiktok_url
    )
  ) as links,
  x.avatar_url,
  x.banner_url,
  pg_catalog.array_remove(
    array[
      case when x.description is not null then 'description' end,
      case when x.about_md is not null then 'about_md' end,
      case when x.meeting_info is not null then 'meeting_info' end,
      case when x.links is not null then 'links' end,
      case when x.avatar_url is not null then 'avatar_url' end,
      case when x.banner_url is not null then 'banner_url' end
    ]::text[],
    null
  ) as overridden_fields,
  coalesce(x.revision, 0::bigint) as revision,
  x.updated_at
from public.organizations as o
left join public.org_overrides as x
  on x.organization_id = o.id;

create policy "members read relevant org admins"
  on public.org_admins
  for select
  to authenticated
  using (
    public.is_brown_member()
    and (
      user_id = auth.uid()
      or public.brownsync_is_org_admin(auth.uid(), organization_id)
      or public.brownsync_is_org_reviewer(auth.uid())
    )
  );

create policy "members read relevant org claims"
  on public.org_claims
  for select
  to authenticated
  using (
    public.is_brown_member()
    and (
      user_id = auth.uid()
      or public.brownsync_is_org_admin(auth.uid(), organization_id, 'owner')
      or public.brownsync_is_org_reviewer(auth.uid())
    )
  );

create policy "public reads organization overrides"
  on public.org_overrides
  for select
  to anon, authenticated
  using (true);

-- No production UPDATE grant accompanies this policy. The rollback-safe check
-- temporarily grants the content columns to prove a non-admin update filters
-- to zero rows.
create policy "organization admins update overrides"
  on public.org_overrides
  for update
  to authenticated
  using (
    public.is_brown_member()
    and public.brownsync_is_org_admin(auth.uid(), organization_id)
  )
  with check (
    public.is_brown_member()
    and public.brownsync_is_org_admin(auth.uid(), organization_id)
  );

create policy "organization admins read audit"
  on public.org_edits
  for select
  to authenticated
  using (
    public.is_brown_member()
    and (
      public.brownsync_is_org_admin(auth.uid(), organization_id)
      or public.brownsync_is_org_reviewer(auth.uid())
    )
  );

revoke all on table
  public.org_reviewers,
  public.org_claims,
  public.org_admins,
  public.org_overrides,
  public.org_edits,
  public.org_write_limits
from public, anon, authenticated;

revoke all on table public.v_organizations_api
  from public, anon, authenticated;
grant select on table public.v_organizations_api
  to anon, authenticated;

create function public.brownsync_claim_organization(
  p_actor uuid,
  p_organization_id text,
  p_evidence text
)
returns table (
  claim_id uuid,
  claim_status text,
  admin_role text,
  disposition text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim       public.org_claims%rowtype;
  v_claim_id    uuid;
  v_email       text;
  v_evidence    text;
  v_is_contact  boolean;
  v_now         timestamptz;
  v_org         public.organizations%rowtype;
  v_role        text;
begin
  v_email := public.brownsync_require_org_actor(p_actor);
  v_org := public.brownsync_lock_organization(p_organization_id);

  select a.role
  into v_role
  from public.org_admins as a
  where a.organization_id = p_organization_id
    and a.user_id = p_actor
  for update;

  if found then
    select c.id
    into v_claim_id
    from public.org_claims as c
    where c.organization_id = p_organization_id
      and c.user_id = p_actor;

    return query
      select v_claim_id, 'approved'::text, v_role, 'already_admin'::text;
    return;
  end if;

  select c.*
  into v_claim
  from public.org_claims as c
  where c.organization_id = p_organization_id
    and c.user_id = p_actor
  for update;

  if found then
    if v_claim.status = 'pending' then
      return query
        select v_claim.id, v_claim.status, null::text, 'already_pending'::text;
      return;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_CLAIM_ALREADY_DECIDED';
  end if;

  if v_org.kind <> 'club' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_NOT_CLAIMABLE';
  end if;

  select exists (
    select 1
    from pg_catalog.unnest(v_org.contact_emails) as contact(email)
    where pg_catalog.lower(pg_catalog.btrim(contact.email)) = v_email
      and pg_catalog.lower(pg_catalog.btrim(contact.email))
            ~ '^[^@[:space:]]+@brown[.]edu$'
  )
  into v_is_contact;

  if not v_is_contact then
    v_evidence := pg_catalog.btrim(coalesce(p_evidence, ''));
    if pg_catalog.char_length(v_evidence) not between 1 and 2000 then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_EVIDENCE_INVALID';
    end if;
  else
    v_evidence := null;
  end if;

  perform public.brownsync_consume_org_write_limit(p_actor, 'claim_day');
  v_now := pg_catalog.clock_timestamp();
  v_claim_id := pg_catalog.gen_random_uuid();

  if v_is_contact then
    insert into public.org_claims (
      id,
      organization_id,
      user_id,
      status,
      decision_kind,
      reviewed_at,
      granted_role,
      created_at
    ) values (
      v_claim_id,
      p_organization_id,
      p_actor,
      'approved',
      'contact_auto',
      v_now,
      'owner',
      v_now
    );

    insert into public.org_admins (
      organization_id,
      user_id,
      role,
      grant_source,
      granted_by,
      granted_at
    ) values (
      p_organization_id,
      p_actor,
      'owner',
      'contact_auto',
      null,
      v_now
    );

    insert into public.org_edits (
      organization_id,
      actor_user_id,
      target_user_id,
      claim_id,
      action,
      before_state,
      after_state,
      created_at
    ) values (
      p_organization_id,
      p_actor,
      p_actor,
      v_claim_id,
      'claim_auto_approved',
      '{}'::jsonb,
      pg_catalog.jsonb_build_object(
        'claim_status', 'approved',
        'admin_role', 'owner'
      ),
      v_now
    );

    return query
      select v_claim_id, 'approved'::text, 'owner'::text, 'auto_approved'::text;
  else
    insert into public.org_claims (
      id,
      organization_id,
      user_id,
      status,
      evidence,
      created_at
    ) values (
      v_claim_id,
      p_organization_id,
      p_actor,
      'pending',
      v_evidence,
      v_now
    );

    insert into public.org_edits (
      organization_id,
      actor_user_id,
      target_user_id,
      claim_id,
      action,
      before_state,
      after_state,
      created_at
    ) values (
      p_organization_id,
      p_actor,
      p_actor,
      v_claim_id,
      'claim_submitted',
      '{}'::jsonb,
      pg_catalog.jsonb_build_object('claim_status', 'pending'),
      v_now
    );

    return query
      select v_claim_id, 'pending'::text, null::text, 'pending'::text;
  end if;
end
$$;

create function public.brownsync_create_organization(
  p_actor uuid,
  p_name text,
  p_description text,
  p_about_md text,
  p_meeting_info text,
  p_links jsonb
)
returns table (
  organization_id text,
  revision bigint,
  admin_role text,
  disposition text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email  text;
  v_existing     public.organizations%rowtype;
  v_existing_id  text;
  v_hash         text;
  v_id           text;
  v_name         text;
  v_now          timestamptz;
  v_override     public.org_overrides%rowtype;
  v_revision     bigint := 0;
  v_slug         text;
begin
  v_actor_email := public.brownsync_require_org_actor(p_actor);
  v_name := pg_catalog.regexp_replace(
    pg_catalog.btrim(coalesce(p_name, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );

  if pg_catalog.char_length(v_name) not between 1 and 160
     or v_name ~ '[[:cntrl:]]' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_NAME_INVALID';
  end if;

  if p_description is not null
     and pg_catalog.char_length(p_description) > 10000
     or p_about_md is not null
        and pg_catalog.char_length(p_about_md) > 20000
     or p_meeting_info is not null
        and pg_catalog.char_length(p_meeting_info) > 4000 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_PATCH_INVALID';
  end if;

  if not public.brownsync_validate_org_links(p_links) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_LINKS_INVALID';
  end if;

  v_slug := pg_catalog.regexp_replace(
    pg_catalog.lower(v_name),
    '[^a-z0-9]+',
    '-',
    'g'
  );
  v_slug := pg_catalog.btrim(v_slug, '-');
  if v_slug = '' then
    v_slug := 'organization';
  end if;
  v_slug := pg_catalog.left(v_slug, 60);
  v_hash := pg_catalog.left(
    pg_catalog.md5(p_actor::text || ':' || pg_catalog.lower(v_name)),
    8
  );
  v_id := 'user-' || v_slug || '-' || v_hash;

  -- Name serialization covers two different actors whose deterministic ids
  -- differ but whose normalized requested names are the same.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'brownsync-org-create:' || pg_catalog.lower(v_name),
      0
    )
  );

  select o.*
  into v_existing
  from public.organizations as o
  where pg_catalog.lower(pg_catalog.btrim(o.name))
          = pg_catalog.lower(v_name)
  order by o.id
  limit 1
  for update;

  if found then
    v_existing_id := v_existing.id;
    if v_existing_id = v_id
       and v_existing.source = 'user'
       and public.brownsync_is_org_admin(p_actor, v_existing_id, 'owner') then
      select x.*
      into v_override
      from public.org_overrides as x
      where x.organization_id = v_existing_id
      for update;

      if (
        (not found and p_description is null and p_about_md is null
          and p_meeting_info is null and p_links is null)
        or (
          found
          and v_override.description is not distinct from p_description
          and v_override.about_md is not distinct from p_about_md
          and v_override.meeting_info is not distinct from p_meeting_info
          and v_override.links is not distinct from p_links
          and v_override.avatar_url is null
          and v_override.banner_url is null
        )
      ) then
        return query
          select
            v_existing_id,
            coalesce(v_override.revision, 0::bigint),
            'owner'::text,
            'already_exists'::text;
        return;
      end if;

      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_CREATE_CONFLICT';
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_NAME_EXISTS';
  end if;

  if exists (
    select 1 from public.organizations as o where o.id = v_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_CREATE_CONFLICT';
  end if;

  perform public.brownsync_consume_org_write_limit(
    p_actor,
    'mutation_minute'
  );
  v_now := pg_catalog.clock_timestamp();

  insert into public.organizations (
    id,
    name,
    kind,
    category,
    source
  ) values (
    v_id,
    v_name,
    'club',
    'club',
    'user'
  );

  insert into public.org_admins (
    organization_id,
    user_id,
    role,
    grant_source,
    granted_by,
    granted_at
  ) values (
    v_id,
    p_actor,
    'owner',
    'creator',
    null,
    v_now
  );

  insert into public.org_edits (
    organization_id,
    actor_user_id,
    target_user_id,
    action,
    before_state,
    after_state,
    created_at
  ) values (
    v_id,
    p_actor,
    p_actor,
    'org_created',
    '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'name', v_name,
      'source', 'user',
      'admin_role', 'owner'
    ),
    v_now
  );

  if p_description is not null
     or p_about_md is not null
     or p_meeting_info is not null
     or p_links is not null then
    v_revision := 1;
    insert into public.org_overrides (
      organization_id,
      description,
      about_md,
      meeting_info,
      links,
      avatar_url,
      banner_url,
      revision,
      updated_by,
      updated_at
    ) values (
      v_id,
      p_description,
      p_about_md,
      p_meeting_info,
      p_links,
      null,
      null,
      v_revision,
      p_actor,
      v_now
    );

    insert into public.org_edits (
      organization_id,
      actor_user_id,
      target_user_id,
      action,
      revision,
      before_state,
      after_state,
      created_at
    ) values (
      v_id,
      p_actor,
      p_actor,
      'content_edited',
      v_revision,
      public.brownsync_org_override_snapshot(
        null, null, null, null, null, null
      ),
      public.brownsync_org_override_snapshot(
        p_description,
        p_about_md,
        p_meeting_info,
        p_links,
        null,
        null
      ),
      v_now
    );
  end if;

  return query select v_id, v_revision, 'owner'::text, 'created'::text;
end
$$;

create function public.brownsync_list_org_access(p_actor uuid)
returns table (
  organization_id text,
  organization_name text,
  admin_role text,
  membership_granted_at timestamptz,
  claim_id uuid,
  claim_status text,
  claim_review_note text,
  claim_created_at timestamptz,
  claim_reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.brownsync_require_org_actor(p_actor);

  return query
    with actor_orgs as (
      select a.organization_id
      from public.org_admins as a
      where a.user_id = p_actor
      union
      select c.organization_id
      from public.org_claims as c
      where c.user_id = p_actor
    )
    select
      ids.organization_id,
      o.name,
      a.role,
      a.granted_at,
      c.id,
      c.status,
      c.review_note,
      c.created_at,
      c.reviewed_at
    from actor_orgs as ids
    join public.organizations as o
      on o.id = ids.organization_id
    left join public.org_admins as a
      on a.organization_id = ids.organization_id
     and a.user_id = p_actor
    left join public.org_claims as c
      on c.organization_id = ids.organization_id
     and c.user_id = p_actor
    order by pg_catalog.lower(o.name), o.id;
end
$$;

create function public.brownsync_list_reviewable_org_claims(
  p_actor uuid,
  p_after_created_at timestamptz,
  p_after_claim_id uuid,
  p_limit integer
)
returns table (
  claim_id uuid,
  organization_id text,
  organization_name text,
  claimant_display_name text,
  claimant_handle text,
  evidence text,
  created_at timestamptz,
  has_more boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_reviewer boolean;
begin
  perform public.brownsync_require_org_actor(p_actor);
  v_is_reviewer := public.brownsync_is_org_reviewer(p_actor);

  if p_limit is null
     or p_limit not between 1 and 100
     or (p_after_created_at is null) <> (p_after_claim_id is null)
     or (
       p_after_created_at is not null
       and not pg_catalog.isfinite(p_after_created_at)
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_QUEUE_INVALID';
  end if;

  return query
    with eligible as (
      select
        c.id as claim_id,
        c.organization_id,
        o.name as organization_name,
        p.display_name as claimant_display_name,
        p.handle as claimant_handle,
        c.evidence,
        c.created_at
      from public.org_claims as c
      join public.organizations as o
        on o.id = c.organization_id
      join public.profiles as p
        on p.id = c.user_id
      where c.status = 'pending'
        and c.user_id <> p_actor
        and (
          p_after_created_at is null
          or (c.created_at, c.id)
               > (p_after_created_at, p_after_claim_id)
        )
        and (
          v_is_reviewer
          or public.brownsync_is_org_admin(
            p_actor,
            c.organization_id,
            'owner'
          )
        )
      order by c.created_at, c.id
      limit p_limit + 1
    ),
    page as (
      select *
      from eligible
      order by created_at, claim_id
      limit p_limit
    )
    select
      page.claim_id,
      page.organization_id,
      page.organization_name,
      page.claimant_display_name,
      page.claimant_handle,
      page.evidence,
      page.created_at,
      (select pg_catalog.count(*) > p_limit from eligible) as has_more
    from page
    order by page.created_at, page.claim_id;
end
$$;

create function public.brownsync_edit_organization(
  p_actor uuid,
  p_organization_id text,
  p_expected_revision bigint,
  p_patch jsonb
)
returns table (
  revision bigint,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_about         text;
  v_avatar        text;
  v_banner        text;
  v_before        jsonb;
  v_current       public.org_overrides%rowtype;
  v_current_rev   bigint := 0;
  v_description   text;
  v_found         boolean;
  v_links         jsonb;
  v_meeting       text;
  v_new_rev       bigint;
  v_now           timestamptz;
begin
  perform public.brownsync_require_org_actor(p_actor);
  perform public.brownsync_lock_organization(p_organization_id);

  if not public.brownsync_is_org_admin(p_actor, p_organization_id) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_FORBIDDEN';
  end if;

  if p_patch is null
     or pg_catalog.jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb
     or (p_patch - array[
       'description',
       'about_md',
       'meeting_info',
       'links',
       'avatar_url',
       'banner_url'
     ]::text[]) <> '{}'::jsonb then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_PATCH_INVALID';
  end if;

  if (
    p_patch ? 'description'
    and pg_catalog.jsonb_typeof(p_patch -> 'description') not in ('string', 'null')
  ) or (
    p_patch ? 'about_md'
    and pg_catalog.jsonb_typeof(p_patch -> 'about_md') not in ('string', 'null')
  ) or (
    p_patch ? 'meeting_info'
    and pg_catalog.jsonb_typeof(p_patch -> 'meeting_info') not in ('string', 'null')
  ) or (
    p_patch ? 'avatar_url'
    and pg_catalog.jsonb_typeof(p_patch -> 'avatar_url') not in ('string', 'null')
  ) or (
    p_patch ? 'banner_url'
    and pg_catalog.jsonb_typeof(p_patch -> 'banner_url') not in ('string', 'null')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_PATCH_INVALID';
  end if;

  select x.*
  into v_current
  from public.org_overrides as x
  where x.organization_id = p_organization_id
  for update;
  v_found := found;

  if v_found then
    v_current_rev := v_current.revision;
  end if;

  v_description := case
    when p_patch ? 'description' then p_patch ->> 'description'
    when v_found then v_current.description
    else null
  end;
  v_about := case
    when p_patch ? 'about_md' then p_patch ->> 'about_md'
    when v_found then v_current.about_md
    else null
  end;
  v_meeting := case
    when p_patch ? 'meeting_info' then p_patch ->> 'meeting_info'
    when v_found then v_current.meeting_info
    else null
  end;
  v_links := case
    when p_patch ? 'links' then
      case
        when pg_catalog.jsonb_typeof(p_patch -> 'links') = 'null' then null
        else p_patch -> 'links'
      end
    when v_found then v_current.links
    else null
  end;
  v_avatar := case
    when p_patch ? 'avatar_url' then p_patch ->> 'avatar_url'
    when v_found then v_current.avatar_url
    else null
  end;
  v_banner := case
    when p_patch ? 'banner_url' then p_patch ->> 'banner_url'
    when v_found then v_current.banner_url
    else null
  end;

  if pg_catalog.char_length(v_description) > 10000
     or pg_catalog.char_length(v_about) > 20000
     or pg_catalog.char_length(v_meeting) > 4000
     or (
       v_avatar is not null
       and (
         pg_catalog.char_length(v_avatar) > 2048
         or v_avatar !~ '^https://[^[:space:]]+$'
       )
     )
     or (
       v_banner is not null
       and (
         pg_catalog.char_length(v_banner) > 2048
         or v_banner !~ '^https://[^[:space:]]+$'
       )
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_PATCH_INVALID';
  end if;

  if not public.brownsync_validate_org_links(v_links) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_LINKS_INVALID';
  end if;

  if (
    (not v_found and v_description is null and v_about is null
      and v_meeting is null and v_links is null
      and v_avatar is null and v_banner is null)
    or (
      v_found
      and v_current.description is not distinct from v_description
      and v_current.about_md is not distinct from v_about
      and v_current.meeting_info is not distinct from v_meeting
      and v_current.links is not distinct from v_links
      and v_current.avatar_url is not distinct from v_avatar
      and v_current.banner_url is not distinct from v_banner
    )
  ) then
    return query select v_current_rev, false;
    return;
  end if;

  if p_expected_revision is distinct from v_current_rev then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_REVISION_CONFLICT';
  end if;

  perform public.brownsync_consume_org_write_limit(
    p_actor,
    'mutation_minute'
  );
  v_now := pg_catalog.clock_timestamp();
  v_new_rev := v_current_rev + 1;
  v_before := public.brownsync_org_override_snapshot(
    case when v_found then v_current.description else null end,
    case when v_found then v_current.about_md else null end,
    case when v_found then v_current.meeting_info else null end,
    case when v_found then v_current.links else null end,
    case when v_found then v_current.avatar_url else null end,
    case when v_found then v_current.banner_url else null end
  );

  insert into public.org_overrides (
    organization_id,
    description,
    about_md,
    meeting_info,
    links,
    avatar_url,
    banner_url,
    revision,
    updated_by,
    updated_at
  ) values (
    p_organization_id,
    v_description,
    v_about,
    v_meeting,
    v_links,
    v_avatar,
    v_banner,
    v_new_rev,
    p_actor,
    v_now
  )
  on conflict (organization_id) do update
  set description = excluded.description,
      about_md = excluded.about_md,
      meeting_info = excluded.meeting_info,
      links = excluded.links,
      avatar_url = excluded.avatar_url,
      banner_url = excluded.banner_url,
      revision = excluded.revision,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

  insert into public.org_edits (
    organization_id,
    actor_user_id,
    target_user_id,
    action,
    revision,
    before_state,
    after_state,
    created_at
  ) values (
    p_organization_id,
    p_actor,
    p_actor,
    'content_edited',
    v_new_rev,
    v_before,
    public.brownsync_org_override_snapshot(
      v_description,
      v_about,
      v_meeting,
      v_links,
      v_avatar,
      v_banner
    ),
    v_now
  );

  return query select v_new_rev, true;
end
$$;

create function public.brownsync_review_org_claim(
  p_actor uuid,
  p_claim_id uuid,
  p_approve boolean,
  p_note text
)
returns table (
  claim_status text,
  granted_role text,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_is_owner boolean;
  v_actor_is_reviewer boolean;
  v_admin          public.org_admins%rowtype;
  v_claim          public.org_claims%rowtype;
  v_decision_kind  text;
  v_note           text;
  v_now            timestamptz;
  v_claim_user_id  uuid;
  v_org_id         text;
  v_role           text;
begin
  perform public.brownsync_require_org_actor(p_actor);

  if p_approve is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_DECISION_INVALID';
  end if;

  select c.organization_id, c.user_id
  into v_org_id, v_claim_user_id
  from public.org_claims as c
  where c.id = p_claim_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_CLAIM_NOT_FOUND';
  end if;

  if v_claim_user_id = p_actor then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_SELF_REVIEW';
  end if;

  -- Lock the claim subject before the organization and claim child row.
  -- Approval requires a current admitted identity; rejection is
  -- safety-reducing and only needs to serialize with account deletion.
  if p_approve then
    perform public.brownsync_require_org_actor(v_claim_user_id);
  else
    perform public.brownsync_lock_org_subject(v_claim_user_id);
  end if;

  perform public.brownsync_lock_organization(v_org_id);

  select c.*
  into v_claim
  from public.org_claims as c
  where c.id = p_claim_id
    and c.organization_id = v_org_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_CLAIM_NOT_FOUND';
  end if;

  v_actor_is_owner := public.brownsync_is_org_admin(
    p_actor,
    v_org_id,
    'owner'
  );
  v_actor_is_reviewer := public.brownsync_is_org_reviewer(p_actor);

  if v_claim.user_id = p_actor then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_SELF_REVIEW';
  end if;

  if not v_actor_is_owner and not v_actor_is_reviewer then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_FORBIDDEN';
  end if;

  if v_claim.status <> 'pending' then
    if (p_approve and v_claim.status = 'approved')
       or (not p_approve and v_claim.status = 'rejected') then
      return query
        select v_claim.status, v_claim.granted_role, false;
      return;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_CLAIM_ALREADY_DECIDED';
  end if;

  if p_note is null then
    v_note := null;
  else
    v_note := pg_catalog.btrim(p_note);
    if pg_catalog.char_length(v_note) > 2000 then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_DECISION_INVALID';
    end if;
    if v_note = '' then
      v_note := null;
    end if;
  end if;

  v_decision_kind := case
    when v_actor_is_reviewer then 'platform_review'
    else 'owner_review'
  end;
  v_now := pg_catalog.clock_timestamp();

  if not p_approve then
    update public.org_claims
    set status = 'rejected',
        decision_kind = v_decision_kind,
        reviewed_by = p_actor,
        reviewed_at = v_now,
        review_note = v_note,
        granted_role = null
    where id = p_claim_id;

    insert into public.org_edits (
      organization_id,
      actor_user_id,
      target_user_id,
      claim_id,
      action,
      before_state,
      after_state,
      created_at
    ) values (
      v_org_id,
      p_actor,
      v_claim.user_id,
      p_claim_id,
      'claim_rejected',
      pg_catalog.jsonb_build_object('claim_status', 'pending'),
      pg_catalog.jsonb_build_object('claim_status', 'rejected'),
      v_now
    );

    return query select 'rejected'::text, null::text, true;
    return;
  end if;

  if exists (
    select 1
    from public.org_admins as owner_admin
    where owner_admin.organization_id = v_org_id
      and owner_admin.role = 'owner'
  ) then
    v_role := 'editor';
  else
    v_role := 'owner';
  end if;

  select a.*
  into v_admin
  from public.org_admins as a
  where a.organization_id = v_org_id
    and a.user_id = v_claim.user_id
  for update;

  if found then
    if v_admin.role = 'owner' then
      v_role := 'owner';
    elsif v_role = 'owner' then
      perform public.brownsync_consume_org_write_limit(
        p_actor,
        'mutation_minute'
      );
      update public.org_admins
      set role = 'owner',
          grant_source = 'manual_claim',
          granted_by = p_actor,
          granted_at = v_now
      where organization_id = v_org_id
        and user_id = v_claim.user_id;
    end if;
  else
    perform public.brownsync_consume_org_write_limit(
      p_actor,
      'mutation_minute'
    );
    insert into public.org_admins (
      organization_id,
      user_id,
      role,
      grant_source,
      granted_by,
      granted_at
    ) values (
      v_org_id,
      v_claim.user_id,
      v_role,
      'manual_claim',
      p_actor,
      v_now
    );
  end if;

  update public.org_claims
  set status = 'approved',
      decision_kind = v_decision_kind,
      reviewed_by = p_actor,
      reviewed_at = v_now,
      review_note = v_note,
      granted_role = v_role
  where id = p_claim_id;

  insert into public.org_edits (
    organization_id,
    actor_user_id,
    target_user_id,
    claim_id,
    action,
    before_state,
    after_state,
    created_at
  ) values (
    v_org_id,
    p_actor,
    v_claim.user_id,
    p_claim_id,
    'claim_approved',
    pg_catalog.jsonb_build_object('claim_status', 'pending'),
    pg_catalog.jsonb_build_object(
      'claim_status', 'approved',
      'admin_role', v_role
    ),
    v_now
  );

  return query select 'approved'::text, v_role, true;
end
$$;

create function public.brownsync_set_org_admin(
  p_actor uuid,
  p_organization_id text,
  p_target uuid,
  p_role text
)
returns table (
  admin_role text,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.org_admins%rowtype;
  v_found    boolean;
  v_now      timestamptz;
  v_owner_count integer;
begin
  perform public.brownsync_require_org_actor(p_actor);

  if p_target = p_actor then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_SELF_ADMIN_CHANGE';
  end if;

  if p_role not in ('owner', 'editor') then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ROLE_INVALID';
  end if;

  begin
    perform public.brownsync_require_org_actor(p_target);
  exception
    when raise_exception then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_TARGET_NOT_FOUND';
  end;

  perform public.brownsync_lock_organization(p_organization_id);

  if not public.brownsync_is_org_admin(
    p_actor,
    p_organization_id,
    'owner'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_FORBIDDEN';
  end if;

  select a.*
  into v_existing
  from public.org_admins as a
  where a.organization_id = p_organization_id
    and a.user_id = p_target
  for update;
  v_found := found;

  if v_found and v_existing.role = p_role then
    return query select v_existing.role, false;
    return;
  end if;

  if v_found and v_existing.role = 'owner' and p_role = 'editor' then
    select pg_catalog.count(*)::integer
    into v_owner_count
    from public.org_admins as a
    where a.organization_id = p_organization_id
      and a.role = 'owner';
    if v_owner_count <= 1 then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_LAST_OWNER';
    end if;
  else
    perform public.brownsync_consume_org_write_limit(
      p_actor,
      'mutation_minute'
    );
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_found then
    update public.org_admins
    set role = p_role,
        grant_source = 'owner_grant',
        granted_by = p_actor,
        granted_at = v_now
    where organization_id = p_organization_id
      and user_id = p_target;

    insert into public.org_edits (
      organization_id,
      actor_user_id,
      target_user_id,
      action,
      before_state,
      after_state,
      created_at
    ) values (
      p_organization_id,
      p_actor,
      p_target,
      'admin_role_changed',
      pg_catalog.jsonb_build_object('admin_role', v_existing.role),
      pg_catalog.jsonb_build_object('admin_role', p_role),
      v_now
    );
  else
    insert into public.org_admins (
      organization_id,
      user_id,
      role,
      grant_source,
      granted_by,
      granted_at
    ) values (
      p_organization_id,
      p_target,
      p_role,
      'owner_grant',
      p_actor,
      v_now
    );

    insert into public.org_edits (
      organization_id,
      actor_user_id,
      target_user_id,
      action,
      before_state,
      after_state,
      created_at
    ) values (
      p_organization_id,
      p_actor,
      p_target,
      'admin_granted',
      '{}'::jsonb,
      pg_catalog.jsonb_build_object('admin_role', p_role),
      v_now
    );
  end if;

  return query select p_role, true;
end
$$;

create function public.brownsync_remove_org_admin(
  p_actor uuid,
  p_organization_id text,
  p_target uuid
)
returns table (changed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.org_admins%rowtype;
  v_now      timestamptz;
  v_owner_count integer;
begin
  perform public.brownsync_require_org_actor(p_actor);

  if p_target = p_actor then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_SELF_ADMIN_CHANGE';
  end if;

  perform public.brownsync_lock_org_subject(p_target);
  perform public.brownsync_lock_organization(p_organization_id);

  if not public.brownsync_is_org_admin(
    p_actor,
    p_organization_id,
    'owner'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_FORBIDDEN';
  end if;

  select a.*
  into v_existing
  from public.org_admins as a
  where a.organization_id = p_organization_id
    and a.user_id = p_target
  for update;

  if not found then
    return query select false;
    return;
  end if;

  if v_existing.role = 'owner' then
    select pg_catalog.count(*)::integer
    into v_owner_count
    from public.org_admins as a
    where a.organization_id = p_organization_id
      and a.role = 'owner';
    if v_owner_count <= 1 then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_LAST_OWNER';
    end if;
  end if;

  delete from public.org_admins
  where organization_id = p_organization_id
    and user_id = p_target;

  v_now := pg_catalog.clock_timestamp();
  insert into public.org_edits (
    organization_id,
    actor_user_id,
    target_user_id,
    action,
    before_state,
    after_state,
    created_at
  ) values (
    p_organization_id,
    p_actor,
    p_target,
    'admin_removed',
    pg_catalog.jsonb_build_object('admin_role', v_existing.role),
    '{}'::jsonb,
    v_now
  );

  return query select true;
end
$$;

create function public.brownsync_leave_org_admin(
  p_actor uuid,
  p_organization_id text
)
returns table (changed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.org_admins%rowtype;
  v_now      timestamptz;
  v_owner_count integer;
begin
  perform public.brownsync_require_org_actor(p_actor);
  perform public.brownsync_lock_organization(p_organization_id);

  select a.*
  into v_existing
  from public.org_admins as a
  where a.organization_id = p_organization_id
    and a.user_id = p_actor
  for update;

  if not found then
    return query select false;
    return;
  end if;

  if v_existing.role = 'owner' then
    select pg_catalog.count(*)::integer
    into v_owner_count
    from public.org_admins as a
    where a.organization_id = p_organization_id
      and a.role = 'owner';
    if v_owner_count <= 1 then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_LAST_OWNER';
    end if;
  end if;

  delete from public.org_admins
  where organization_id = p_organization_id
    and user_id = p_actor;

  v_now := pg_catalog.clock_timestamp();
  insert into public.org_edits (
    organization_id,
    actor_user_id,
    target_user_id,
    action,
    before_state,
    after_state,
    created_at
  ) values (
    p_organization_id,
    p_actor,
    p_actor,
    'admin_left',
    pg_catalog.jsonb_build_object('admin_role', v_existing.role),
    '{}'::jsonb,
    v_now
  );

  return query select true;
end
$$;

revoke all on function public.brownsync_require_org_actor(uuid)
  from public, anon, authenticated;
revoke all on function public.brownsync_lock_org_subject(uuid)
  from public, anon, authenticated;
revoke all on function public.brownsync_is_org_reviewer(uuid)
  from public, anon, authenticated;
revoke all on function public.brownsync_is_org_admin(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.brownsync_lock_organization(text)
  from public, anon, authenticated;
revoke all on function public.brownsync_validate_org_links(jsonb)
  from public, anon, authenticated;
revoke all on function public.brownsync_org_override_snapshot(
  text, text, text, jsonb, text, text
) from public, anon, authenticated;
revoke all on function public.brownsync_consume_org_write_limit(uuid, text)
  from public, anon, authenticated;
revoke all on function public.brownsync_protect_user_organization()
  from public, anon, authenticated;
revoke all on function public.brownsync_seed_org_links(
  text, text, text, text, text, text, text
) from public, anon, authenticated;

revoke all on function public.brownsync_claim_organization(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.brownsync_create_organization(
  uuid, text, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.brownsync_list_org_access(uuid)
  from public, anon, authenticated;
revoke all on function public.brownsync_list_reviewable_org_claims(
  uuid, timestamptz, uuid, integer
)
  from public, anon, authenticated;
revoke all on function public.brownsync_edit_organization(
  uuid, text, bigint, jsonb
) from public, anon, authenticated;
revoke all on function public.brownsync_review_org_claim(
  uuid, uuid, boolean, text
) from public, anon, authenticated;
revoke all on function public.brownsync_set_org_admin(
  uuid, text, uuid, text
) from public, anon, authenticated;
revoke all on function public.brownsync_remove_org_admin(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.brownsync_leave_org_admin(uuid, text)
  from public, anon, authenticated;

commit;
