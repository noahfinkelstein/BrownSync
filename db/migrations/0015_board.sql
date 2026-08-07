-- 0015_board.sql — native Brown-only pseudonymous board.
--
-- The verified Worker derives anonymous author tokens and calls these
-- owner-only routines. The database never receives the board pepper and never
-- persists a profile/user identifier beside anonymous authorship. Identifiable
-- moderator UUIDs are confined to authority and moderation records.

begin;

revoke create on schema public from public, anon, authenticated;

create table public.board_control (
  id                  boolean primary key default true,
  enabled             boolean not null default false,
  auto_hide_threshold integer not null default 3,
  updated_by          uuid references public.profiles(id) on delete set null,
  updated_at          timestamptz not null
                        default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  constraint board_control_singleton_ck check (id),
  constraint board_control_threshold_ck
    check (auto_hide_threshold between 2 and 10),
  constraint board_control_time_ck
    check (pg_catalog.isfinite(updated_at))
);

insert into public.board_control default values;

create table public.board_moderators (
  user_id     uuid primary key
                references public.profiles(id) on delete cascade,
  role        text not null,
  granted_by  uuid references public.profiles(id) on delete set null,
  granted_at  timestamptz not null default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  constraint board_moderators_role_ck
    check (role in ('moderator', 'owner')),
  constraint board_moderators_no_self_grant_ck
    check (granted_by is null or granted_by <> user_id),
  constraint board_moderators_time_ck
    check (pg_catalog.isfinite(granted_at))
);

create index board_moderators_page_idx
  on public.board_moderators (granted_at desc, user_id desc);

create table public.board_posts (
  id                 uuid primary key default pg_catalog.gen_random_uuid(),
  author_token       text not null,
  token_version      integer not null default 1,
  client_request_id  uuid not null,
  create_fingerprint text,
  title              text,
  body               text,
  visibility         text not null default 'visible',
  moderation_epoch   bigint not null default 0,
  score              integer not null default 0,
  revision           bigint not null default 1,
  created_at         timestamptz not null
                       default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  updated_at         timestamptz not null
                       default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  unique (author_token, client_request_id),
  constraint board_posts_token_ck check (
    author_token ~ '^[0-9a-f]{64}$'
    and token_version = 1
  ),
  constraint board_posts_fingerprint_ck check (
    (
      visibility in ('visible', 'auto_hidden', 'moderator_hidden')
      and create_fingerprint ~ '^[0-9a-f]{64}$'
    )
    or (
      visibility in ('removed', 'author_deleted', 'account_deleted')
      and create_fingerprint is null
    )
  ),
  constraint board_posts_visibility_ck check (
    visibility in (
      'visible',
      'auto_hidden',
      'moderator_hidden',
      'removed',
      'author_deleted',
      'account_deleted'
    )
  ),
  constraint board_posts_content_ck check (
    (
      visibility in ('visible', 'auto_hidden', 'moderator_hidden')
      and body is not null
      and pg_catalog.char_length(body) between 1 and 5000
      and body = pg_catalog.btrim(body)
      and (
        title is null
        or (
          pg_catalog.char_length(title) between 1 and 160
          and title = pg_catalog.btrim(title)
        )
      )
    )
    or (
      visibility in ('removed', 'author_deleted', 'account_deleted')
      and title is null
      and body is null
    )
  ),
  constraint board_posts_epoch_ck check (moderation_epoch >= 0),
  constraint board_posts_revision_ck check (revision > 0),
  constraint board_posts_time_ck check (
    pg_catalog.isfinite(created_at)
    and pg_catalog.isfinite(updated_at)
  )
);

create index board_posts_feed_idx
  on public.board_posts (created_at desc, id desc)
  where visibility = 'visible';
create index board_posts_mine_idx
  on public.board_posts (author_token, updated_at desc, id desc);
create index board_posts_moderation_idx
  on public.board_posts (updated_at desc, id desc)
  where visibility in ('auto_hidden', 'moderator_hidden');

create table public.board_comments (
  id                 uuid primary key default pg_catalog.gen_random_uuid(),
  post_id            uuid not null
                       references public.board_posts(id) on delete cascade,
  parent_comment_id  uuid,
  author_token       text not null,
  token_version      integer not null default 1,
  client_request_id  uuid not null,
  create_fingerprint text,
  body               text,
  visibility         text not null default 'visible',
  moderation_epoch   bigint not null default 0,
  score              integer not null default 0,
  revision           bigint not null default 1,
  created_at         timestamptz not null
                       default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  updated_at         timestamptz not null
                       default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  unique (author_token, client_request_id),
  unique (id, post_id),
  constraint board_comments_parent_fk
    foreign key (parent_comment_id, post_id)
    references public.board_comments(id, post_id)
    on delete no action,
  constraint board_comments_token_ck check (
    author_token ~ '^[0-9a-f]{64}$'
    and token_version = 1
  ),
  constraint board_comments_fingerprint_ck check (
    (
      visibility in ('visible', 'auto_hidden', 'moderator_hidden')
      and create_fingerprint ~ '^[0-9a-f]{64}$'
    )
    or (
      visibility in ('removed', 'author_deleted', 'account_deleted')
      and create_fingerprint is null
    )
  ),
  constraint board_comments_visibility_ck check (
    visibility in (
      'visible',
      'auto_hidden',
      'moderator_hidden',
      'removed',
      'author_deleted',
      'account_deleted'
    )
  ),
  constraint board_comments_content_ck check (
    (
      visibility in ('visible', 'auto_hidden', 'moderator_hidden')
      and body is not null
      and pg_catalog.char_length(body) between 1 and 2000
      and body = pg_catalog.btrim(body)
    )
    or (
      visibility in ('removed', 'author_deleted', 'account_deleted')
      and body is null
    )
  ),
  constraint board_comments_epoch_ck check (moderation_epoch >= 0),
  constraint board_comments_revision_ck check (revision > 0),
  constraint board_comments_time_ck check (
    pg_catalog.isfinite(created_at)
    and pg_catalog.isfinite(updated_at)
  )
);

create index board_comments_thread_idx
  on public.board_comments (post_id, created_at, id)
  where visibility = 'visible';
create index board_comments_parent_idx
  on public.board_comments (parent_comment_id)
  where parent_comment_id is not null;
create index board_comments_mine_idx
  on public.board_comments (author_token, updated_at desc, id desc);
create index board_comments_moderation_idx
  on public.board_comments (updated_at desc, id desc)
  where visibility in ('auto_hidden', 'moderator_hidden');

create table public.board_votes (
  id             uuid primary key default pg_catalog.gen_random_uuid(),
  author_token   text not null,
  token_version  integer not null default 1,
  post_id        uuid references public.board_posts(id) on delete cascade,
  comment_id     uuid references public.board_comments(id) on delete cascade,
  value          integer not null,
  created_at     timestamptz not null default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  updated_at     timestamptz not null default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  constraint board_votes_token_ck check (
    author_token ~ '^[0-9a-f]{64}$'
    and token_version = 1
  ),
  constraint board_votes_target_ck check (
    (post_id is not null)::integer + (comment_id is not null)::integer = 1
  ),
  constraint board_votes_value_ck check (value in (-1, 1)),
  constraint board_votes_time_ck check (
    pg_catalog.isfinite(created_at)
    and pg_catalog.isfinite(updated_at)
  )
);

create unique index board_votes_post_uidx
  on public.board_votes (author_token, post_id)
  where post_id is not null;
create unique index board_votes_comment_uidx
  on public.board_votes (author_token, comment_id)
  where comment_id is not null;

create table public.board_reports (
  id                uuid primary key default pg_catalog.gen_random_uuid(),
  reporter_token    text not null,
  token_version     integer not null default 1,
  post_id           uuid references public.board_posts(id) on delete cascade,
  comment_id        uuid
                      references public.board_comments(id) on delete cascade,
  target_epoch      bigint not null,
  reason            text not null,
  detail            text,
  result_visibility text not null,
  result_revision   bigint not null,
  result_auto_hidden boolean not null default false,
  state             text not null default 'open',
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz not null
                      default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  updated_at        timestamptz not null
                      default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  constraint board_reports_token_ck check (
    reporter_token ~ '^[0-9a-f]{64}$'
    and token_version = 1
  ),
  constraint board_reports_target_ck check (
    (post_id is not null)::integer + (comment_id is not null)::integer = 1
  ),
  constraint board_reports_epoch_ck check (target_epoch >= 0),
  constraint board_reports_reason_ck check (
    reason in (
      'harassment',
      'hate',
      'threat',
      'sexual',
      'personal_info',
      'spam',
      'other'
    )
  ),
  constraint board_reports_detail_ck check (
    detail is null
    or (
      pg_catalog.char_length(detail) between 1 and 1000
      and detail = pg_catalog.btrim(detail)
    )
  ),
  constraint board_reports_state_ck
    check (state in ('open', 'upheld', 'dismissed')),
  constraint board_reports_result_ck check (
    result_visibility in (
      'visible',
      'auto_hidden',
      'moderator_hidden',
      'removed',
      'author_deleted',
      'account_deleted'
    )
    and result_revision > 0
  ),
  constraint board_reports_review_ck check (
    (
      state = 'open'
      and reviewed_by is null
      and reviewed_at is null
    )
    or (
      state <> 'open'
      and reviewed_at is not null
    )
  ),
  constraint board_reports_time_ck check (
    pg_catalog.isfinite(created_at)
    and pg_catalog.isfinite(updated_at)
    and (
      reviewed_at is null
      or pg_catalog.isfinite(reviewed_at)
    )
  )
);

create unique index board_reports_post_epoch_uidx
  on public.board_reports (reporter_token, post_id, target_epoch)
  where post_id is not null;
create unique index board_reports_comment_epoch_uidx
  on public.board_reports (reporter_token, comment_id, target_epoch)
  where comment_id is not null;
create index board_reports_open_post_idx
  on public.board_reports (post_id, target_epoch, reporter_token)
  where state = 'open' and post_id is not null;
create index board_reports_open_comment_idx
  on public.board_reports (comment_id, target_epoch, reporter_token)
  where state = 'open' and comment_id is not null;

create table public.board_bans (
  id                     uuid primary key default pg_catalog.gen_random_uuid(),
  author_token           text not null,
  token_version          integer not null default 1,
  starts_at              timestamptz not null
                           default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  expires_at             timestamptz not null,
  reason                 text not null,
  note                   text,
  created_by             uuid
                           references public.profiles(id) on delete set null,
  client_request_id      uuid not null,
  revoked_at             timestamptz,
  revoked_by             uuid
                           references public.profiles(id) on delete set null,
  revocation_reason      text,
  revocation_request_id  uuid,
  created_at             timestamptz not null
                           default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  constraint board_bans_token_ck check (
    author_token ~ '^[0-9a-f]{64}$'
    and token_version = 1
  ),
  constraint board_bans_reason_ck check (
    pg_catalog.char_length(reason) between 1 and 240
    and reason = pg_catalog.btrim(reason)
  ),
  constraint board_bans_note_ck check (
    note is null
    or (
      pg_catalog.char_length(note) between 1 and 1000
      and note = pg_catalog.btrim(note)
    )
  ),
  constraint board_bans_duration_ck check (
    pg_catalog.isfinite(starts_at)
    and pg_catalog.isfinite(expires_at)
    and expires_at >= starts_at + interval '300 seconds'
    and expires_at <= starts_at + interval '31536000 seconds'
  ),
  constraint board_bans_revoke_ck check (
    (
      revoked_at is null
      and revoked_by is null
      and revocation_reason is null
      and revocation_request_id is null
    )
    or (
      revoked_at is not null
      and revocation_reason is not null
      and pg_catalog.char_length(revocation_reason) between 1 and 240
      and revocation_reason = pg_catalog.btrim(revocation_reason)
    )
  ),
  constraint board_bans_time_ck check (
    pg_catalog.isfinite(created_at)
    and (
      revoked_at is null
      or pg_catalog.isfinite(revoked_at)
    )
  )
);

create unique index board_bans_create_request_uidx
  on public.board_bans (created_by, client_request_id)
  where created_by is not null;
create unique index board_bans_revoke_request_uidx
  on public.board_bans (revoked_by, revocation_request_id)
  where revoked_by is not null and revocation_request_id is not null;
create unique index board_bans_one_active_uidx
  on public.board_bans (author_token)
  where revoked_at is null;
create index board_bans_status_idx
  on public.board_bans (author_token, expires_at desc, id desc);

create table public.board_appeals (
  id                   uuid primary key default pg_catalog.gen_random_uuid(),
  author_token         text not null,
  token_version        integer not null default 1,
  client_request_id    uuid not null,
  post_id              uuid
                         references public.board_posts(id) on delete cascade,
  comment_id           uuid
                         references public.board_comments(id)
                         on delete cascade,
  ban_id               uuid references public.board_bans(id) on delete cascade,
  target_epoch         bigint,
  body                 text,
  state                text not null default 'pending',
  decided_by           uuid
                         references public.profiles(id) on delete set null,
  decided_at           timestamptz,
  decision_reason      text,
  decision_request_id  uuid,
  created_at           timestamptz not null
                         default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  updated_at           timestamptz not null
                         default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  unique (author_token, client_request_id),
  constraint board_appeals_token_ck check (
    author_token ~ '^[0-9a-f]{64}$'
    and token_version = 1
  ),
  constraint board_appeals_target_ck check (
    (post_id is not null)::integer
    + (comment_id is not null)::integer
    + (ban_id is not null)::integer = 1
  ),
  constraint board_appeals_epoch_ck check (
    (
      ban_id is null
      and target_epoch is not null
      and target_epoch >= 0
    )
    or (
      ban_id is not null
      and target_epoch is null
    )
  ),
  constraint board_appeals_body_ck check (
    (
      body is not null
      and pg_catalog.char_length(body) between 1 and 2000
      and body = pg_catalog.btrim(body)
    )
    or (
      body is null
      and state <> 'pending'
    )
  ),
  constraint board_appeals_state_ck
    check (state in ('pending', 'approved', 'denied')),
  constraint board_appeals_decision_ck check (
    (
      state = 'pending'
      and decided_by is null
      and decided_at is null
      and decision_reason is null
      and decision_request_id is null
    )
    or (
      state <> 'pending'
      and decided_at is not null
      and decision_reason is not null
      and pg_catalog.char_length(decision_reason) between 1 and 240
      and decision_reason = pg_catalog.btrim(decision_reason)
      and decision_request_id is not null
    )
  ),
  constraint board_appeals_time_ck check (
    pg_catalog.isfinite(created_at)
    and pg_catalog.isfinite(updated_at)
    and (
      decided_at is null
      or pg_catalog.isfinite(decided_at)
    )
  )
);

create unique index board_appeals_pending_post_uidx
  on public.board_appeals (post_id, target_epoch)
  where state = 'pending' and post_id is not null;
create unique index board_appeals_pending_comment_uidx
  on public.board_appeals (comment_id, target_epoch)
  where state = 'pending' and comment_id is not null;
create unique index board_appeals_pending_ban_uidx
  on public.board_appeals (ban_id)
  where state = 'pending' and ban_id is not null;
create unique index board_appeals_decision_request_uidx
  on public.board_appeals (decided_by, decision_request_id)
  where decided_by is not null and decision_request_id is not null;
create index board_appeals_queue_idx
  on public.board_appeals (updated_at desc, id desc)
  where state = 'pending';

create table public.board_moderation_actions (
  id                    uuid primary key default pg_catalog.gen_random_uuid(),
  actor_kind            text not null,
  moderator_user_id     uuid
                          references public.profiles(id) on delete set null,
  target_type           text not null,
  target_id             uuid not null,
  client_request_id     uuid,
  action                text not null,
  reason                text not null,
  old_visibility        text,
  new_visibility        text,
  old_moderation_epoch  bigint,
  new_moderation_epoch  bigint,
  result_revision       bigint,
  created_at            timestamptz not null
                          default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  constraint board_actions_actor_ck check (
    (
      actor_kind = 'system'
      and moderator_user_id is null
      and client_request_id is null
    )
    or (
      actor_kind = 'moderator'
      and client_request_id is not null
    )
  ),
  constraint board_actions_target_ck check (
    target_type in ('post', 'comment', 'ban', 'appeal')
  ),
  constraint board_actions_action_ck check (
    action in (
      'auto_hide',
      'hide',
      'remove',
      'restore',
      'dismiss',
      'ban_created',
      'ban_revoked',
      'appeal_approved',
      'appeal_denied'
    )
  ),
  constraint board_actions_reason_ck check (
    pg_catalog.char_length(reason) between 1 and 240
    and reason = pg_catalog.btrim(reason)
  ),
  constraint board_actions_visibility_ck check (
    (
      target_type in ('post', 'comment')
      and old_visibility is not null
      and new_visibility is not null
      and old_moderation_epoch is not null
      and new_moderation_epoch is not null
    )
    or (
      target_type in ('ban', 'appeal')
      and old_visibility is null
      and new_visibility is null
      and old_moderation_epoch is null
      and new_moderation_epoch is null
    )
  ),
  constraint board_actions_epoch_ck check (
    (old_moderation_epoch is null or old_moderation_epoch >= 0)
    and (new_moderation_epoch is null or new_moderation_epoch >= 0)
  ),
  constraint board_actions_result_revision_ck check (
    (
      action in ('auto_hide', 'hide', 'remove', 'restore', 'dismiss')
      and result_revision is not null
      and result_revision > 0
    )
    or (
      action not in ('auto_hide', 'hide', 'remove', 'restore', 'dismiss')
      and result_revision is null
    )
  ),
  constraint board_actions_time_ck check (
    pg_catalog.isfinite(created_at)
  )
);

create unique index board_actions_moderator_request_uidx
  on public.board_moderation_actions (
    moderator_user_id,
    client_request_id
  )
  where moderator_user_id is not null and client_request_id is not null;
create index board_actions_target_idx
  on public.board_moderation_actions (
    target_type,
    target_id,
    created_at,
    id
  );

create table public.board_rate_limits (
  author_token      text not null,
  token_version     integer not null default 1,
  bucket            text not null,
  window_started_at timestamptz not null
                      default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  count              integer not null default 0,
  updated_at         timestamptz not null
                      default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  primary key (author_token, bucket),
  constraint board_rate_limits_token_ck check (
    author_token ~ '^[0-9a-f]{64}$'
    and token_version = 1
  ),
  constraint board_rate_limits_bucket_ck check (
    bucket in (
      'post_hour',
      'post_day',
      'comment_hour',
      'vote_10minute',
      'report_day',
      'appeal_day',
      'edit_hour'
    )
  ),
  constraint board_rate_limits_count_ck check (count between 0 and 120),
  constraint board_rate_limits_time_ck check (
    pg_catalog.isfinite(window_started_at)
    and pg_catalog.isfinite(updated_at)
  )
);

create table public.board_account_deletion_fences (
  author_token   text primary key,
  token_version  integer not null default 1,
  created_at     timestamptz not null default pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
  constraint board_deletion_fences_token_ck check (
    author_token ~ '^[0-9a-f]{64}$'
    and token_version = 1
  ),
  constraint board_deletion_fences_time_ck
    check (pg_catalog.isfinite(created_at))
);

alter table public.board_control enable row level security;
alter table public.board_moderators enable row level security;
alter table public.board_posts enable row level security;
alter table public.board_comments enable row level security;
alter table public.board_votes enable row level security;
alter table public.board_reports enable row level security;
alter table public.board_bans enable row level security;
alter table public.board_appeals enable row level security;
alter table public.board_moderation_actions enable row level security;
alter table public.board_rate_limits enable row level security;
alter table public.board_account_deletion_fences enable row level security;

create function public.brownsync_validate_board_token(
  p_author_token text,
  p_token_version integer
)
returns void
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_author_token is null
     or p_author_token !~ '^[0-9a-f]{64}$'
     or p_token_version is distinct from 1 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_IDENTITY_UNAVAILABLE';
  end if;
end
$$;

create function public.brownsync_board_alias(p_author_token text)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  perform public.brownsync_validate_board_token(p_author_token, 1);
  return 'Anonymous Otter ' || pg_catalog.upper(
    pg_catalog.substr(p_author_token, 1, 4)
  );
end
$$;

-- Board admission is intentionally local rather than delegated to an
-- organization helper. Every actor-taking public routine reaches this helper,
-- which locks auth.users before profiles and independently rechecks Brown
-- email plus Google-provider admission.
create function public.brownsync_require_board_actor(p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_UNAUTHORIZED';
  end if;

  perform 1
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
      message = 'BROWNSYNC_BOARD_UNAUTHORIZED';
  end if;

  perform 1
  from public.profiles as p
  where p.id = p_actor
  for key share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_UNAUTHORIZED';
  end if;
end
$$;

create function public.brownsync_lock_board_control(
  p_require_enabled boolean
)
returns public.board_control
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control public.board_control%rowtype;
begin
  select c.*
  into v_control
  from public.board_control as c
  where c.id = true
  for share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_IDENTITY_UNAVAILABLE';
  end if;

  if p_require_enabled and not v_control.enabled then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_DISABLED';
  end if;

  return v_control;
end
$$;

create function public.brownsync_assert_board_fence_clear(
  p_author_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.board_account_deletion_fences as f
    where f.author_token = p_author_token
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_ACCOUNT_DELETED';
  end if;
end
$$;

-- The zero-count post-hour row is also the canonical per-token transaction
-- mutex. It lets bans and account cleanup serialize with every member write
-- without creating a user/token mapping table.
create function public.brownsync_lock_board_author(
  p_author_token text,
  p_token_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.brownsync_validate_board_token(
    p_author_token,
    p_token_version
  );

  insert into public.board_rate_limits (
    author_token,
    token_version,
    bucket,
    count
  ) values (
    p_author_token,
    p_token_version,
    'post_hour',
    0
  )
  on conflict (author_token, bucket) do nothing;

  perform 1
  from public.board_rate_limits as l
  where l.author_token = p_author_token
    and l.bucket = 'post_hour'
  for update;
end
$$;

create function public.brownsync_board_is_banned(p_author_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.board_bans as b
    where b.author_token = p_author_token
      and b.revoked_at is null
      and b.expires_at > pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
  )
$$;

create function public.brownsync_prepare_board_write(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_require_enabled boolean,
  p_allow_banned boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.brownsync_require_board_actor(p_actor);
  perform public.brownsync_validate_board_token(
    p_author_token,
    p_token_version
  );
  perform public.brownsync_lock_board_control(p_require_enabled);
  perform public.brownsync_assert_board_fence_clear(p_author_token);
  perform public.brownsync_lock_board_author(
    p_author_token,
    p_token_version
  );
  -- Recheck after taking the per-token mutex. A cleanup that inserted its
  -- fence before this writer obtained the mutex must win.
  perform public.brownsync_assert_board_fence_clear(p_author_token);

  if not p_allow_banned
     and public.brownsync_board_is_banned(p_author_token) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_BANNED';
  end if;
end
$$;

create function public.brownsync_prepare_board_read(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_require_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.brownsync_require_board_actor(p_actor);
  perform public.brownsync_validate_board_token(
    p_author_token,
    p_token_version
  );
  perform public.brownsync_lock_board_control(p_require_enabled);
  perform public.brownsync_assert_board_fence_clear(p_author_token);
end
$$;

-- Lock an operation-specific durable-limit row before any content target.
-- Callers increment only after resolving replay/no-op/rejection semantics.
create function public.brownsync_lock_board_limit(
  p_author_token text,
  p_token_version integer,
  p_bucket text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  perform public.brownsync_validate_board_token(
    p_author_token,
    p_token_version
  );

  if p_bucket not in (
    'post_hour',
    'post_day',
    'comment_hour',
    'vote_10minute',
    'report_day',
    'appeal_day',
    'edit_hour'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  insert into public.board_rate_limits (
    author_token,
    token_version,
    bucket,
    window_started_at,
    count,
    updated_at
  ) values (
    p_author_token,
    p_token_version,
    p_bucket,
    v_now,
    0,
    v_now
  )
  on conflict (author_token, bucket) do nothing;

  perform 1
  from public.board_rate_limits as l
  where l.author_token = p_author_token
    and l.bucket = p_bucket
  for update;
end
$$;

create function public.brownsync_consume_board_limit(
  p_author_token text,
  p_token_version integer,
  p_bucket text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval;
  v_limit integer;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_row public.board_rate_limits%rowtype;
begin
  perform public.brownsync_lock_board_limit(
    p_author_token,
    p_token_version,
    p_bucket
  );

  select x.window_size, x.max_count
  into v_window, v_limit
  from (
    values
      ('post_hour'::text, interval '1 hour', 5),
      ('post_day'::text, interval '1 day', 20),
      ('comment_hour'::text, interval '1 hour', 30),
      ('vote_10minute'::text, interval '10 minutes', 120),
      ('report_day'::text, interval '1 day', 20),
      ('appeal_day'::text, interval '1 day', 3),
      ('edit_hour'::text, interval '1 hour', 60)
  ) as x(bucket, window_size, max_count)
  where x.bucket = p_bucket;

  select l.*
  into v_row
  from public.board_rate_limits as l
  where l.author_token = p_author_token
    and l.bucket = p_bucket;

  if v_now >= v_row.window_started_at + v_window then
    update public.board_rate_limits
    set window_started_at = v_now,
        count = 1,
        updated_at = v_now
    where author_token = p_author_token
      and bucket = p_bucket;
  elsif v_row.count >= v_limit then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_RATE_LIMITED';
  else
    update public.board_rate_limits
    set count = count + 1,
        updated_at = v_now
    where author_token = p_author_token
      and bucket = p_bucket;
  end if;
end
$$;

create function public.brownsync_require_board_moderator(
  p_actor uuid,
  p_require_owner boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  perform public.brownsync_require_board_actor(p_actor);

  select m.role
  into v_role
  from public.board_moderators as m
  where m.user_id = p_actor
  for key share;

  if not found
     or (p_require_owner and v_role <> 'owner') then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_FORBIDDEN';
  end if;

  return v_role;
end
$$;

-- Serialize all moderator idempotency keys on the identifiable authority row.
-- This is deliberately separate from anonymous author locks, so moderator
-- identity and anonymous authorship never share a routine boundary.
create function public.brownsync_lock_board_moderator_requests(
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.board_moderators as m
  where m.user_id = p_actor
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_FORBIDDEN';
  end if;
end
$$;

create function public.brownsync_get_board_feed(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_before_created_at timestamptz,
  p_before_post_id uuid,
  p_limit integer default 25
)
returns table (
  post_id uuid,
  title text,
  body text,
  visibility text,
  moderation_epoch bigint,
  score integer,
  revision bigint,
  author_alias text,
  is_mine boolean,
  comment_count integer,
  viewer_vote integer,
  created_at timestamptz,
  updated_at timestamptz,
  has_more boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.brownsync_prepare_board_read(
    p_actor,
    p_author_token,
    p_token_version,
    true
  );

  if p_limit is null or p_limit < 1 or p_limit > 50
     or ((p_before_created_at is null) <> (p_before_post_id is null))
     or (
       p_before_created_at is not null
       and not pg_catalog.isfinite(p_before_created_at)
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  return query
  with page as (
    select p.*
    from public.board_posts as p
    where p.visibility = 'visible'
      and (
        p_before_created_at is null
        or (p.created_at, p.id) < (
          p_before_created_at,
          p_before_post_id
        )
      )
    order by p.created_at desc, p.id desc
    limit p_limit + 1
  ),
  bounded as (
    select p.*, pg_catalog.row_number() over (
      order by p.created_at desc, p.id desc
    ) as rn
    from page as p
  ),
  meta as (
    select pg_catalog.count(*) > p_limit as more
    from page
  )
  select
    p.id,
    p.title,
    p.body,
    p.visibility,
    p.moderation_epoch,
    p.score,
    p.revision,
    public.brownsync_board_alias(p.author_token),
    p.author_token = p_author_token,
    (
      select pg_catalog.count(*)::integer
      from public.board_comments as c
      where c.post_id = p.id
        and c.visibility = 'visible'
    ),
    coalesce((
      select v.value
      from public.board_votes as v
      where v.author_token = p_author_token
        and v.post_id = p.id
    ), 0),
    p.created_at,
    p.updated_at,
    m.more
  from bounded as p
  cross join meta as m
  where p.rn <= p_limit
  order by p.created_at desc, p.id desc;
end
$$;

create function public.brownsync_get_board_thread(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_post_id uuid,
  p_after_created_at timestamptz,
  p_after_comment_id uuid,
  p_limit integer default 25
)
returns table (
  post_id uuid,
  post_title text,
  post_body text,
  post_visibility text,
  post_moderation_epoch bigint,
  post_score integer,
  post_revision bigint,
  post_author_alias text,
  post_is_mine boolean,
  post_viewer_vote integer,
  post_created_at timestamptz,
  post_updated_at timestamptz,
  comment_id uuid,
  parent_comment_id uuid,
  comment_body text,
  comment_visibility text,
  comment_moderation_epoch bigint,
  comment_score integer,
  comment_revision bigint,
  comment_author_alias text,
  comment_is_mine boolean,
  comment_viewer_vote integer,
  comment_created_at timestamptz,
  comment_updated_at timestamptz,
  has_more boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.board_posts%rowtype;
begin
  perform public.brownsync_prepare_board_read(
    p_actor,
    p_author_token,
    p_token_version,
    true
  );

  if p_post_id is null
     or p_limit is null or p_limit < 1 or p_limit > 50
     or ((p_after_created_at is null) <> (p_after_comment_id is null))
     or (
       p_after_created_at is not null
       and not pg_catalog.isfinite(p_after_created_at)
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  select p.*
  into v_post
  from public.board_posts as p
  where p.id = p_post_id
    and p.visibility = 'visible';

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;

  return query
  with page as (
    select c.*
    from public.board_comments as c
    where c.post_id = p_post_id
      and c.visibility = 'visible'
      and (
        p_after_created_at is null
        or (c.created_at, c.id) > (
          p_after_created_at,
          p_after_comment_id
        )
      )
    order by c.created_at, c.id
    limit p_limit + 1
  ),
  bounded as (
    select c.*, pg_catalog.row_number() over (
      order by c.created_at, c.id
    ) as rn
    from page as c
  ),
  meta as (
    select pg_catalog.count(*) > p_limit as more
    from page
  )
  select
    v_post.id,
    v_post.title,
    v_post.body,
    v_post.visibility,
    v_post.moderation_epoch,
    v_post.score,
    v_post.revision,
    public.brownsync_board_alias(v_post.author_token),
    v_post.author_token = p_author_token,
    coalesce((
      select v.value
      from public.board_votes as v
      where v.author_token = p_author_token
        and v.post_id = v_post.id
    ), 0),
    v_post.created_at,
    v_post.updated_at,
    c.id,
    c.parent_comment_id,
    c.body,
    c.visibility,
    c.moderation_epoch,
    c.score,
    c.revision,
    case
      when c.id is null then null
      else public.brownsync_board_alias(c.author_token)
    end,
    case when c.id is null then null else c.author_token = p_author_token end,
    case
      when c.id is null then null
      else coalesce((
        select v.value
        from public.board_votes as v
        where v.author_token = p_author_token
          and v.comment_id = c.id
      ), 0)
    end,
    c.created_at,
    c.updated_at,
    m.more
  from meta as m
  left join bounded as c on c.rn <= p_limit
  order by c.created_at nulls first, c.id nulls first;
end
$$;

create function public.brownsync_get_own_board_content(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_before_updated_at timestamptz,
  p_before_item_id uuid,
  p_limit integer default 25
)
returns table (
  item_type text,
  item_id uuid,
  post_id uuid,
  parent_comment_id uuid,
  title text,
  body text,
  visibility text,
  moderation_epoch bigint,
  score integer,
  revision bigint,
  created_at timestamptz,
  updated_at timestamptz,
  has_more boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.brownsync_prepare_board_read(
    p_actor,
    p_author_token,
    p_token_version,
    true
  );

  if p_limit is null or p_limit < 1 or p_limit > 50
     or ((p_before_updated_at is null) <> (p_before_item_id is null))
     or (
       p_before_updated_at is not null
       and not pg_catalog.isfinite(p_before_updated_at)
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  return query
  with candidates as (
    select
      'post'::text as item_type,
      p.id as item_id,
      p.id as post_id,
      null::uuid as parent_comment_id,
      p.title,
      p.body,
      p.visibility,
      p.moderation_epoch,
      p.score,
      p.revision,
      p.created_at,
      p.updated_at
    from public.board_posts as p
    where p.author_token = p_author_token
    union all
    select
      'comment'::text,
      c.id,
      c.post_id,
      c.parent_comment_id,
      null::text,
      c.body,
      c.visibility,
      c.moderation_epoch,
      c.score,
      c.revision,
      c.created_at,
      c.updated_at
    from public.board_comments as c
    join public.board_posts as parent_post
      on parent_post.id = c.post_id
     and parent_post.visibility = 'visible'
    where c.author_token = p_author_token
  ),
  page as (
    select c.*
    from candidates as c
    where p_before_updated_at is null
       or (c.updated_at, c.item_id) < (
         p_before_updated_at,
         p_before_item_id
       )
    order by c.updated_at desc, c.item_id desc
    limit p_limit + 1
  ),
  bounded as (
    select p.*, pg_catalog.row_number() over (
      order by p.updated_at desc, p.item_id desc
    ) as rn
    from page as p
  ),
  meta as (
    select pg_catalog.count(*) > p_limit as more
    from page
  )
  select
    p.item_type,
    p.item_id,
    p.post_id,
    p.parent_comment_id,
    p.title,
    p.body,
    p.visibility,
    p.moderation_epoch,
    p.score,
    p.revision,
    p.created_at,
    p.updated_at,
    m.more
  from bounded as p
  cross join meta as m
  where p.rn <= p_limit
  order by p.updated_at desc, p.item_id desc;
end
$$;

create function public.brownsync_get_board_status(
  p_actor uuid,
  p_author_token text,
  p_token_version integer
)
returns table (
  enabled boolean,
  author_alias text,
  banned boolean,
  ban_id uuid,
  banned_until timestamptz,
  ban_reason text,
  pending_appeals integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control public.board_control%rowtype;
  v_ban public.board_bans%rowtype;
begin
  perform public.brownsync_prepare_board_read(
    p_actor,
    p_author_token,
    p_token_version,
    false
  );

  select c.*
  into v_control
  from public.board_control as c
  where c.id = true;

  select b.*
  into v_ban
  from public.board_bans as b
  where b.author_token = p_author_token
    and b.revoked_at is null
    and b.expires_at > pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
  order by b.expires_at desc, b.id desc
  limit 1;

  return query
  select
    v_control.enabled,
    public.brownsync_board_alias(p_author_token),
    v_ban.id is not null,
    v_ban.id,
    v_ban.expires_at,
    v_ban.reason,
    (
      select pg_catalog.count(*)::integer
      from public.board_appeals as a
      where a.author_token = p_author_token
        and a.state = 'pending'
        and (
          a.ban_id is null
          or exists (
            select 1
            from public.board_bans as b
            where b.id = a.ban_id
              and b.revoked_at is null
              and b.expires_at >
                pg_catalog.date_trunc(
                  'milliseconds',
                  pg_catalog.clock_timestamp()
                )
          )
        )
    );
end
$$;

create function public.brownsync_create_board_post(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_client_request_id uuid,
  p_title text,
  p_body text
)
returns table (
  post_id uuid,
  revision bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_body text;
  v_fingerprint text;
  v_existing public.board_posts%rowtype;
  v_id uuid;
begin
  if p_client_request_id is null or p_body is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  v_title := case when p_title is null then null
                  else pg_catalog.btrim(p_title) end;
  v_body := pg_catalog.btrim(p_body);
  if pg_catalog.char_length(v_body) not between 1 and 5000
     or (
       v_title is not null
       and pg_catalog.char_length(v_title) not between 1 and 160
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;
  v_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'body',
          v_body,
          'title',
          v_title
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  perform public.brownsync_prepare_board_write(
    p_actor,
    p_author_token,
    p_token_version,
    true,
    false
  );
  perform public.brownsync_lock_board_limit(
    p_author_token,
    p_token_version,
    'post_day'
  );

  select p.*
  into v_existing
  from public.board_posts as p
  where p.author_token = p_author_token
    and p.client_request_id = p_client_request_id
  for update;

  if found then
    if v_existing.create_fingerprint = v_fingerprint then
      return query
      select v_existing.id, 1::bigint, true;
      return;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REQUEST_CONFLICT';
  end if;

  perform public.brownsync_consume_board_limit(
    p_author_token,
    p_token_version,
    'post_hour'
  );
  perform public.brownsync_consume_board_limit(
    p_author_token,
    p_token_version,
    'post_day'
  );

  v_id := pg_catalog.gen_random_uuid();
  insert into public.board_posts (
    id,
    author_token,
    token_version,
    client_request_id,
    create_fingerprint,
    title,
    body
  ) values (
    v_id,
    p_author_token,
    p_token_version,
    p_client_request_id,
    v_fingerprint,
    v_title,
    v_body
  );

  return query select v_id, 1::bigint, false;
end
$$;

create function public.brownsync_edit_board_post(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_post_id uuid,
  p_expected_revision bigint,
  p_patch jsonb
)
returns table (
  post_id uuid,
  revision bigint,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.board_posts%rowtype;
  v_title text;
  v_body text;
  v_key text;
begin
  if p_post_id is null
     or p_expected_revision is null
     or p_expected_revision < 1
     or p_patch is null
     or pg_catalog.jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  for v_key in
    select k.key
    from pg_catalog.jsonb_object_keys(p_patch) as k(key)
  loop
    if v_key not in ('title', 'body') then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_INPUT_INVALID';
    end if;
  end loop;

  if p_patch ? 'title'
     and pg_catalog.jsonb_typeof(p_patch -> 'title') not in (
       'string',
       'null'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;
  if p_patch ? 'body'
     and pg_catalog.jsonb_typeof(p_patch -> 'body') <> 'string' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  perform public.brownsync_prepare_board_write(
    p_actor,
    p_author_token,
    p_token_version,
    true,
    false
  );
  perform public.brownsync_lock_board_limit(
    p_author_token,
    p_token_version,
    'edit_hour'
  );

  select p.*
  into v_post
  from public.board_posts as p
  where p.id = p_post_id
    and p.author_token = p_author_token
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;
  if v_post.visibility in ('removed', 'author_deleted', 'account_deleted') then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
  end if;

  v_title := case
    when not (p_patch ? 'title') then v_post.title
    when pg_catalog.jsonb_typeof(p_patch -> 'title') = 'null' then null
    else pg_catalog.btrim(p_patch ->> 'title')
  end;
  v_body := case
    when not (p_patch ? 'body') then v_post.body
    else pg_catalog.btrim(p_patch ->> 'body')
  end;

  if pg_catalog.char_length(v_body) not between 1 and 5000
     or (
       v_title is not null
       and pg_catalog.char_length(v_title) not between 1 and 160
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  if v_post.revision <> p_expected_revision then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REVISION_CONFLICT';
  end if;

  if v_post.title is not distinct from v_title
     and v_post.body = v_body then
    return query select v_post.id, v_post.revision, false;
    return;
  end if;

  perform public.brownsync_consume_board_limit(
    p_author_token,
    p_token_version,
    'edit_hour'
  );

  update public.board_posts
  set title = v_title,
      body = v_body,
      revision = board_posts.revision + 1,
      updated_at = pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
  where id = v_post.id
  returning board_posts.revision into v_post.revision;

  return query select v_post.id, v_post.revision, true;
end
$$;

create function public.brownsync_delete_board_post(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_post_id uuid,
  p_expected_revision bigint
)
returns table (
  post_id uuid,
  revision bigint,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.board_posts%rowtype;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  if p_post_id is null
     or p_expected_revision is null
     or p_expected_revision < 1 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  perform public.brownsync_prepare_board_write(
    p_actor,
    p_author_token,
    p_token_version,
    false,
    true
  );
  perform public.brownsync_lock_board_limit(
    p_author_token,
    p_token_version,
    'edit_hour'
  );

  select p.*
  into v_post
  from public.board_posts as p
  where p.id = p_post_id
    and p.author_token = p_author_token
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;

  if v_post.visibility in ('removed', 'author_deleted', 'account_deleted') then
    return query select v_post.id, v_post.revision, false;
    return;
  end if;

  if v_post.revision <> p_expected_revision then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REVISION_CONFLICT';
  end if;

  perform public.brownsync_consume_board_limit(
    p_author_token,
    p_token_version,
    'edit_hour'
  );

  update public.board_posts
  set create_fingerprint = null,
      title = null,
      body = null,
      visibility = 'author_deleted',
      revision = board_posts.revision + 1,
      updated_at = v_now
  where id = v_post.id
  returning board_posts.revision into v_post.revision;

  update public.board_reports
  set state = 'dismissed',
      reviewed_at = v_now,
      updated_at = v_now
  where (
      board_reports.post_id = v_post.id
      or board_reports.comment_id in (
        select c.id
        from public.board_comments as c
        where c.post_id = v_post.id
      )
    )
    and board_reports.state = 'open';

  delete from public.board_appeals
  where board_appeals.state = 'pending'
    and (
      board_appeals.post_id = v_post.id
      or board_appeals.comment_id in (
        select c.id
        from public.board_comments as c
        where c.post_id = v_post.id
      )
    );

  return query select v_post.id, v_post.revision, true;
end
$$;

create function public.brownsync_create_board_comment(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_client_request_id uuid,
  p_post_id uuid,
  p_parent_comment_id uuid,
  p_body text
)
returns table (
  comment_id uuid,
  post_id uuid,
  revision bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text;
  v_fingerprint text;
  v_existing public.board_comments%rowtype;
  v_post public.board_posts%rowtype;
  v_parent public.board_comments%rowtype;
  v_id uuid;
begin
  if p_post_id is null or p_client_request_id is null or p_body is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;
  v_body := pg_catalog.btrim(p_body);
  if pg_catalog.char_length(v_body) not between 1 and 2000 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;
  v_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'body',
          v_body,
          'parentCommentId',
          p_parent_comment_id,
          'postId',
          p_post_id
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  perform public.brownsync_prepare_board_write(
    p_actor,
    p_author_token,
    p_token_version,
    true,
    false
  );
  perform public.brownsync_lock_board_limit(
    p_author_token,
    p_token_version,
    'comment_hour'
  );

  select c.*
  into v_existing
  from public.board_comments as c
  where c.author_token = p_author_token
    and c.client_request_id = p_client_request_id
  for update;

  if found then
    if v_existing.create_fingerprint = v_fingerprint then
      return query
      select
        v_existing.id,
        v_existing.post_id,
        1::bigint,
        true;
      return;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REQUEST_CONFLICT';
  end if;

  select p.*
  into v_post
  from public.board_posts as p
  where p.id = p_post_id
  for update;

  if not found or v_post.visibility <> 'visible' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;

  if p_parent_comment_id is not null then
    select c.*
    into v_parent
    from public.board_comments as c
    where c.id = p_parent_comment_id
      and c.post_id = p_post_id
    for key share;

    if not found
       or v_parent.parent_comment_id is not null
       or v_parent.visibility <> 'visible' then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_INPUT_INVALID';
    end if;
  end if;

  perform public.brownsync_consume_board_limit(
    p_author_token,
    p_token_version,
    'comment_hour'
  );

  v_id := pg_catalog.gen_random_uuid();
  insert into public.board_comments (
    id,
    post_id,
    parent_comment_id,
    author_token,
    token_version,
    client_request_id,
    create_fingerprint,
    body
  ) values (
    v_id,
    p_post_id,
    p_parent_comment_id,
    p_author_token,
    p_token_version,
    p_client_request_id,
    v_fingerprint,
    v_body
  );

  return query select v_id, p_post_id, 1::bigint, false;
end
$$;

create function public.brownsync_edit_board_comment(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_comment_id uuid,
  p_expected_revision bigint,
  p_body text
)
returns table (
  comment_id uuid,
  revision bigint,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment public.board_comments%rowtype;
  v_post_id uuid;
  v_body text;
begin
  if p_comment_id is null
     or p_expected_revision is null
     or p_expected_revision < 1
     or p_body is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;
  v_body := pg_catalog.btrim(p_body);
  if pg_catalog.char_length(v_body) not between 1 and 2000 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  perform public.brownsync_prepare_board_write(
    p_actor,
    p_author_token,
    p_token_version,
    true,
    false
  );
  perform public.brownsync_lock_board_limit(
    p_author_token,
    p_token_version,
    'edit_hour'
  );

  select c.post_id
  into v_post_id
  from public.board_comments as c
  where c.id = p_comment_id
    and c.author_token = p_author_token;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;

  perform 1
  from public.board_posts as p
  where p.id = v_post_id
  for update;

  select c.*
  into v_comment
  from public.board_comments as c
  where c.id = p_comment_id
    and c.author_token = p_author_token
  for update;

  if v_comment.visibility in (
       'removed',
       'author_deleted',
       'account_deleted'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
  end if;
  if v_comment.revision <> p_expected_revision then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REVISION_CONFLICT';
  end if;
  if v_comment.body = v_body then
    return query select v_comment.id, v_comment.revision, false;
    return;
  end if;

  perform public.brownsync_consume_board_limit(
    p_author_token,
    p_token_version,
    'edit_hour'
  );

  update public.board_comments
  set body = v_body,
      revision = board_comments.revision + 1,
      updated_at = pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
  where id = v_comment.id
  returning board_comments.revision into v_comment.revision;

  return query select v_comment.id, v_comment.revision, true;
end
$$;

create function public.brownsync_delete_board_comment(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_comment_id uuid,
  p_expected_revision bigint
)
returns table (
  comment_id uuid,
  revision bigint,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment public.board_comments%rowtype;
  v_post_id uuid;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  if p_comment_id is null
     or p_expected_revision is null
     or p_expected_revision < 1 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  perform public.brownsync_prepare_board_write(
    p_actor,
    p_author_token,
    p_token_version,
    false,
    true
  );
  perform public.brownsync_lock_board_limit(
    p_author_token,
    p_token_version,
    'edit_hour'
  );

  select c.post_id
  into v_post_id
  from public.board_comments as c
  where c.id = p_comment_id
    and c.author_token = p_author_token;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;

  perform 1
  from public.board_posts as p
  where p.id = v_post_id
  for update;

  select c.*
  into v_comment
  from public.board_comments as c
  where c.id = p_comment_id
    and c.author_token = p_author_token
  for update;

  if v_comment.visibility in (
       'removed',
       'author_deleted',
       'account_deleted'
     ) then
    return query select v_comment.id, v_comment.revision, false;
    return;
  end if;
  if v_comment.revision <> p_expected_revision then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REVISION_CONFLICT';
  end if;

  perform public.brownsync_consume_board_limit(
    p_author_token,
    p_token_version,
    'edit_hour'
  );

  update public.board_comments
  set create_fingerprint = null,
      body = null,
      visibility = 'author_deleted',
      revision = board_comments.revision + 1,
      updated_at = v_now
  where id = v_comment.id
  returning board_comments.revision into v_comment.revision;

  update public.board_reports
  set state = 'dismissed',
      reviewed_at = v_now,
      updated_at = v_now
  where board_reports.comment_id = v_comment.id
    and state = 'open';

  delete from public.board_appeals
  where board_appeals.comment_id = v_comment.id
    and board_appeals.state = 'pending';

  return query select v_comment.id, v_comment.revision, true;
end
$$;

create function public.brownsync_set_board_vote(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_post_id uuid,
  p_comment_id uuid,
  p_value integer
)
returns table (
  post_id uuid,
  comment_id uuid,
  value integer,
  score integer,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vote public.board_votes%rowtype;
  v_post public.board_posts%rowtype;
  v_comment public.board_comments%rowtype;
  v_old integer := 0;
  v_score integer;
begin
  if (p_post_id is not null)::integer
       + (p_comment_id is not null)::integer <> 1
     or p_value not in (-1, 0, 1) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  perform public.brownsync_prepare_board_write(
    p_actor,
    p_author_token,
    p_token_version,
    true,
    false
  );
  perform public.brownsync_lock_board_limit(
    p_author_token,
    p_token_version,
    'vote_10minute'
  );

  if p_post_id is not null then
    select p.*
    into v_post
    from public.board_posts as p
    where p.id = p_post_id
    for update;
    if not found or v_post.visibility <> 'visible' then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;

    select v.*
    into v_vote
    from public.board_votes as v
    where v.author_token = p_author_token
      and v.post_id = p_post_id
    for update;
    if found then
      v_old := v_vote.value;
    end if;
    v_score := v_post.score;
  else
    select c.post_id
    into v_comment.post_id
    from public.board_comments as c
    where c.id = p_comment_id;
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;

    select p.*
    into v_post
    from public.board_posts as p
    where p.id = v_comment.post_id
    for update;
    if not found or v_post.visibility <> 'visible' then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;

    select c.*
    into v_comment
    from public.board_comments as c
    where c.id = p_comment_id
    for update;
    if not found or v_comment.visibility <> 'visible' then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;

    select v.*
    into v_vote
    from public.board_votes as v
    where v.author_token = p_author_token
      and v.comment_id = p_comment_id
    for update;
    if found then
      v_old := v_vote.value;
    end if;
    v_score := v_comment.score;
  end if;

  if v_old = p_value then
    return query
    select p_post_id, p_comment_id, p_value, v_score, false;
    return;
  end if;

  perform public.brownsync_consume_board_limit(
    p_author_token,
    p_token_version,
    'vote_10minute'
  );

  if p_value = 0 then
    delete from public.board_votes
    where id = v_vote.id;
  elsif v_vote.id is null then
    insert into public.board_votes (
      author_token,
      token_version,
      post_id,
      comment_id,
      value
    ) values (
      p_author_token,
      p_token_version,
      p_post_id,
      p_comment_id,
      p_value
    );
  else
    update public.board_votes
    set value = p_value,
        updated_at = pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
    where id = v_vote.id;
  end if;

  if p_post_id is not null then
    update public.board_posts
    set score = board_posts.score + (p_value - v_old),
        updated_at = board_posts.updated_at
    where id = p_post_id
    returning board_posts.score into v_score;
  else
    update public.board_comments
    set score = board_comments.score + (p_value - v_old),
        updated_at = board_comments.updated_at
    where id = p_comment_id
    returning board_comments.score into v_score;
  end if;

  return query
  select p_post_id, p_comment_id, p_value, v_score, true;
end
$$;

create function public.brownsync_report_board_content(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_post_id uuid,
  p_comment_id uuid,
  p_reason text,
  p_detail text
)
returns table (
  report_id uuid,
  target_epoch bigint,
  visibility text,
  revision bigint,
  auto_hidden boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_detail text;
  v_post public.board_posts%rowtype;
  v_comment public.board_comments%rowtype;
  v_existing public.board_reports%rowtype;
  v_epoch bigint;
  v_visibility text;
  v_revision bigint;
  v_target_token text;
  v_report_id uuid;
  v_threshold integer;
  v_count integer;
  v_hidden boolean := false;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  v_reason := pg_catalog.btrim(coalesce(p_reason, ''));
  v_detail := case when p_detail is null then null
                   else pg_catalog.btrim(p_detail) end;
  if (p_post_id is not null)::integer
       + (p_comment_id is not null)::integer <> 1
     or v_reason not in (
       'harassment',
       'hate',
       'threat',
       'sexual',
       'personal_info',
       'spam',
       'other'
     )
     or (
       v_detail is not null
       and pg_catalog.char_length(v_detail) not between 1 and 1000
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  perform public.brownsync_prepare_board_write(
    p_actor,
    p_author_token,
    p_token_version,
    true,
    false
  );
  perform public.brownsync_lock_board_limit(
    p_author_token,
    p_token_version,
    'report_day'
  );

  if p_post_id is not null then
    select p.*
    into v_post
    from public.board_posts as p
    where p.id = p_post_id
    for update;
    if not found
       or v_post.visibility in (
         'removed',
         'author_deleted',
         'account_deleted'
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;
    v_epoch := v_post.moderation_epoch;
    v_visibility := v_post.visibility;
    v_revision := v_post.revision;
    v_target_token := v_post.author_token;
  else
    select c.post_id
    into v_comment.post_id
    from public.board_comments as c
    where c.id = p_comment_id;
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;

    select p.*
    into v_post
    from public.board_posts as p
    where p.id = v_comment.post_id
    for update;
    if not found
       or v_post.visibility in (
         'removed',
         'author_deleted',
         'account_deleted'
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;

    select c.*
    into v_comment
    from public.board_comments as c
    where c.id = p_comment_id
    for update;
    if not found
       or v_comment.visibility in (
         'removed',
         'author_deleted',
         'account_deleted'
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;
    v_epoch := v_comment.moderation_epoch;
    v_visibility := v_comment.visibility;
    v_revision := v_comment.revision;
    v_target_token := v_comment.author_token;
  end if;

  if v_target_token = p_author_token then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_FORBIDDEN';
  end if;

  select r.*
  into v_existing
  from public.board_reports as r
  where r.reporter_token = p_author_token
    and r.target_epoch = v_epoch
    and (
      (p_post_id is not null and r.post_id = p_post_id)
      or (p_comment_id is not null and r.comment_id = p_comment_id)
    )
  for update;

  if found then
    if v_existing.reason = v_reason
       and v_existing.detail is not distinct from v_detail then
      return query
      select
        v_existing.id,
        v_epoch,
        v_existing.result_visibility,
        v_existing.result_revision,
        v_existing.result_auto_hidden,
        true;
      return;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REQUEST_CONFLICT';
  end if;

  if v_visibility <> 'visible'
     or (p_comment_id is not null and v_post.visibility <> 'visible') then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;

  perform public.brownsync_consume_board_limit(
    p_author_token,
    p_token_version,
    'report_day'
  );

  v_report_id := pg_catalog.gen_random_uuid();
  insert into public.board_reports (
    id,
    reporter_token,
    token_version,
    post_id,
    comment_id,
    target_epoch,
    reason,
    detail,
    result_visibility,
    result_revision,
    result_auto_hidden
  ) values (
    v_report_id,
    p_author_token,
    p_token_version,
    p_post_id,
    p_comment_id,
    v_epoch,
    v_reason,
    v_detail,
    v_visibility,
    v_revision,
    false
  );

  select c.auto_hide_threshold
  into v_threshold
  from public.board_control as c
  where c.id = true;

  if p_post_id is not null then
    select pg_catalog.count(distinct r.reporter_token)::integer
    into v_count
    from public.board_reports as r
    where r.post_id = p_post_id
      and r.target_epoch = v_epoch
      and r.state = 'open';
  else
    select pg_catalog.count(distinct r.reporter_token)::integer
    into v_count
    from public.board_reports as r
    where r.comment_id = p_comment_id
      and r.target_epoch = v_epoch
      and r.state = 'open';
  end if;

  if v_count >= v_threshold then
    if p_post_id is not null then
      update public.board_posts
      set visibility = 'auto_hidden',
          revision = board_posts.revision + 1,
          updated_at = v_now
      where id = p_post_id
        and board_posts.visibility = 'visible'
      returning board_posts.visibility, board_posts.revision
      into v_visibility, v_revision;
    else
      update public.board_comments
      set visibility = 'auto_hidden',
          revision = board_comments.revision + 1,
          updated_at = v_now
      where id = p_comment_id
        and board_comments.visibility = 'visible'
      returning board_comments.visibility, board_comments.revision
      into v_visibility, v_revision;
    end if;

    if found then
      v_hidden := true;
      insert into public.board_moderation_actions (
        actor_kind,
        target_type,
        target_id,
        action,
        reason,
        old_visibility,
        new_visibility,
        old_moderation_epoch,
        new_moderation_epoch,
        result_revision
      ) values (
        'system',
        case when p_post_id is not null then 'post' else 'comment' end,
        coalesce(p_post_id, p_comment_id),
        'auto_hide',
        'report_threshold',
        'visible',
        'auto_hidden',
        v_epoch,
        v_epoch,
        v_revision
      );
    end if;
  end if;

  update public.board_reports
  set result_visibility = v_visibility,
      result_revision = v_revision,
      result_auto_hidden = v_hidden
  where id = v_report_id;

  return query
  select
    v_report_id,
    v_epoch,
    v_visibility,
    v_revision,
    v_hidden,
    false;
end
$$;

create function public.brownsync_create_board_appeal(
  p_actor uuid,
  p_author_token text,
  p_token_version integer,
  p_client_request_id uuid,
  p_post_id uuid,
  p_comment_id uuid,
  p_ban_id uuid,
  p_target_epoch bigint,
  p_body text
)
returns table (
  appeal_id uuid,
  state text,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text;
  v_existing public.board_appeals%rowtype;
  v_post public.board_posts%rowtype;
  v_comment public.board_comments%rowtype;
  v_ban public.board_bans%rowtype;
  v_id uuid;
begin
  v_body := pg_catalog.btrim(coalesce(p_body, ''));
  if p_client_request_id is null
     or (p_post_id is not null)::integer
          + (p_comment_id is not null)::integer
          + (p_ban_id is not null)::integer <> 1
     or pg_catalog.char_length(v_body) not between 1 and 2000
     or (
       p_ban_id is null
       and (p_target_epoch is null or p_target_epoch < 0)
     )
     or (p_ban_id is not null and p_target_epoch is not null) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  perform public.brownsync_prepare_board_write(
    p_actor,
    p_author_token,
    p_token_version,
    false,
    true
  );
  perform public.brownsync_lock_board_limit(
    p_author_token,
    p_token_version,
    'appeal_day'
  );

  select a.*
  into v_existing
  from public.board_appeals as a
  where a.author_token = p_author_token
    and a.client_request_id = p_client_request_id
  for update;

  if found then
    if v_existing.post_id is not distinct from p_post_id
       and v_existing.comment_id is not distinct from p_comment_id
       and v_existing.ban_id is not distinct from p_ban_id
       and v_existing.target_epoch is not distinct from p_target_epoch
       and v_existing.body = v_body then
      return query
      select v_existing.id, 'pending'::text, true;
      return;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REQUEST_CONFLICT';
  end if;

  if p_post_id is not null then
    select p.*
    into v_post
    from public.board_posts as p
    where p.id = p_post_id
    for update;
    if not found
       or v_post.author_token <> p_author_token
       or v_post.moderation_epoch <> p_target_epoch
       or v_post.visibility not in (
         'auto_hidden',
         'moderator_hidden'
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;
  elsif p_comment_id is not null then
    select c.post_id
    into v_comment.post_id
    from public.board_comments as c
    where c.id = p_comment_id;
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;
    select p.*
    into v_post
    from public.board_posts as p
    where p.id = v_comment.post_id
    for update;
    if not found or v_post.visibility <> 'visible' then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;
    select c.*
    into v_comment
    from public.board_comments as c
    where c.id = p_comment_id
    for update;
    if not found
       or v_comment.author_token <> p_author_token
       or v_comment.moderation_epoch <> p_target_epoch
       or v_comment.visibility not in (
         'auto_hidden',
         'moderator_hidden'
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;
  else
    select b.*
    into v_ban
    from public.board_bans as b
    where b.id = p_ban_id
    for update;
    if not found
       or v_ban.author_token <> p_author_token
       or v_ban.revoked_at is not null
       or v_ban.expires_at <= pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;
  end if;

  if exists (
    select 1
    from public.board_appeals as a
    where a.state = 'pending'
      and (
        (p_post_id is not null
         and a.post_id = p_post_id
         and a.target_epoch = p_target_epoch)
        or (p_comment_id is not null
            and a.comment_id = p_comment_id
            and a.target_epoch = p_target_epoch)
        or (p_ban_id is not null and a.ban_id = p_ban_id)
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
  end if;

  perform public.brownsync_consume_board_limit(
    p_author_token,
    p_token_version,
    'appeal_day'
  );

  v_id := pg_catalog.gen_random_uuid();
  insert into public.board_appeals (
    id,
    author_token,
    token_version,
    client_request_id,
    post_id,
    comment_id,
    ban_id,
    target_epoch,
    body
  ) values (
    v_id,
    p_author_token,
    p_token_version,
    p_client_request_id,
    p_post_id,
    p_comment_id,
    p_ban_id,
    p_target_epoch,
    v_body
  );

  return query select v_id, 'pending'::text, false;
end
$$;

create function public.brownsync_get_board_moderation_queue(
  p_actor uuid,
  p_before_updated_at timestamptz,
  p_before_queue_id uuid,
  p_limit integer default 25
)
returns table (
  queue_kind text,
  queue_id uuid,
  target_type text,
  target_id uuid,
  post_id uuid,
  parent_comment_id uuid,
  title text,
  body text,
  visibility text,
  moderation_epoch bigint,
  score integer,
  open_report_count integer,
  report_reasons text[],
  appeal_body text,
  created_at timestamptz,
  updated_at timestamptz,
  has_more boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.brownsync_require_board_moderator(p_actor, false);

  if p_limit is null or p_limit < 1 or p_limit > 50
     or ((p_before_updated_at is null) <> (p_before_queue_id is null))
     or (
       p_before_updated_at is not null
       and not pg_catalog.isfinite(p_before_updated_at)
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  return query
  with candidates as (
    select
      'report'::text as queue_kind,
      (pg_catalog.array_agg(
        r.id order by r.updated_at desc, r.id desc
      ))[1] as queue_id,
      'post'::text as target_type,
      p.id as target_id,
      p.id as post_id,
      null::uuid as parent_comment_id,
      p.title,
      p.body,
      p.visibility,
      p.moderation_epoch,
      p.score,
      pg_catalog.count(distinct r.reporter_token)::integer
        as open_report_count,
      pg_catalog.array_agg(distinct r.reason order by r.reason)
        as report_reasons,
      null::text as appeal_body,
      pg_catalog.min(r.created_at) as created_at,
      greatest(p.updated_at, pg_catalog.max(r.updated_at))
        as updated_at
    from public.board_posts as p
    join public.board_reports as r
      on r.post_id = p.id
     and r.target_epoch = p.moderation_epoch
     and r.state = 'open'
    where p.visibility in (
      'visible',
      'auto_hidden',
      'moderator_hidden'
    )
    group by p.id

    union all

    select
      'report'::text,
      (pg_catalog.array_agg(
        r.id order by r.updated_at desc, r.id desc
      ))[1],
      'comment'::text,
      c.id,
      c.post_id,
      c.parent_comment_id,
      null::text,
      c.body,
      c.visibility,
      c.moderation_epoch,
      c.score,
      pg_catalog.count(distinct r.reporter_token)::integer,
      pg_catalog.array_agg(distinct r.reason order by r.reason),
      null::text,
      pg_catalog.min(r.created_at),
      greatest(c.updated_at, pg_catalog.max(r.updated_at))
    from public.board_comments as c
    join public.board_posts as p on p.id = c.post_id
    join public.board_reports as r
      on r.comment_id = c.id
     and r.target_epoch = c.moderation_epoch
     and r.state = 'open'
    where p.visibility = 'visible'
      and c.visibility in (
        'visible',
        'auto_hidden',
        'moderator_hidden'
      )
    group by c.id

    union all

    select
      'appeal'::text,
      a.id,
      case
        when a.post_id is not null then 'post'
        when a.comment_id is not null then 'comment'
        else 'ban'
      end,
      coalesce(a.post_id, a.comment_id, a.ban_id),
      case
        when a.post_id is not null then a.post_id
        when a.comment_id is not null then c.post_id
        else null
      end,
      c.parent_comment_id,
      p.title,
      coalesce(p.body, c.body),
      coalesce(p.visibility, c.visibility),
      coalesce(p.moderation_epoch, c.moderation_epoch),
      coalesce(p.score, c.score),
      0,
      array[]::text[],
      a.body,
      a.created_at,
      a.updated_at
    from public.board_appeals as a
    left join public.board_posts as p on p.id = a.post_id
    left join public.board_comments as c on c.id = a.comment_id
    left join public.board_posts as cp on cp.id = c.post_id
    left join public.board_bans as b on b.id = a.ban_id
    where a.state = 'pending'
      and (
        a.comment_id is null
        or cp.visibility = 'visible'
      )
      and (
        a.ban_id is null
        or (
          b.revoked_at is null
          and b.expires_at >
            pg_catalog.date_trunc(
              'milliseconds',
              pg_catalog.clock_timestamp()
            )
        )
      )
  ),
  page as (
    select c.*
    from candidates as c
    where p_before_updated_at is null
       or (c.updated_at, c.queue_id) < (
         p_before_updated_at,
         p_before_queue_id
       )
    order by c.updated_at desc, c.queue_id desc
    limit p_limit + 1
  ),
  bounded as (
    select p.*, pg_catalog.row_number() over (
      order by p.updated_at desc, p.queue_id desc
    ) as rn
    from page as p
  ),
  meta as (
    select pg_catalog.count(*) > p_limit as more
    from page
  )
  select
    p.queue_kind,
    p.queue_id,
    p.target_type,
    p.target_id,
    p.post_id,
    p.parent_comment_id,
    p.title,
    p.body,
    p.visibility,
    p.moderation_epoch,
    p.score,
    p.open_report_count,
    p.report_reasons,
    p.appeal_body,
    p.created_at,
    p.updated_at,
    m.more
  from bounded as p
  cross join meta as m
  where p.rn <= p_limit
  order by p.updated_at desc, p.queue_id desc;
end
$$;

create function public.brownsync_decide_board_content(
  p_actor uuid,
  p_client_request_id uuid,
  p_post_id uuid,
  p_comment_id uuid,
  p_expected_epoch bigint,
  p_action text,
  p_reason text
)
returns table (
  target_type text,
  target_id uuid,
  visibility text,
  moderation_epoch bigint,
  revision bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := pg_catalog.btrim(coalesce(p_action, ''));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_existing public.board_moderation_actions%rowtype;
  v_post public.board_posts%rowtype;
  v_comment public.board_comments%rowtype;
  v_target_token text;
  v_post_for_comment uuid;
  v_old_visibility text;
  v_new_visibility text;
  v_old_epoch bigint;
  v_new_epoch bigint;
  v_revision bigint;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  if p_client_request_id is null
     or (p_post_id is not null)::integer
          + (p_comment_id is not null)::integer <> 1
     or p_expected_epoch is null or p_expected_epoch < 0
     or v_action not in ('hide', 'remove', 'restore', 'dismiss')
     or pg_catalog.char_length(v_reason) not between 1 and 240 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  perform public.brownsync_require_board_moderator(p_actor, false);
  perform public.brownsync_lock_board_moderator_requests(p_actor);

  select a.*
  into v_existing
  from public.board_moderation_actions as a
  where a.moderator_user_id = p_actor
    and a.client_request_id = p_client_request_id;

  if found then
    if v_existing.target_type = (
         case when p_post_id is not null then 'post' else 'comment' end
       )
       and v_existing.target_id = coalesce(p_post_id, p_comment_id)
       and v_existing.action = v_action
       and v_existing.reason = v_reason
       and v_existing.old_moderation_epoch = p_expected_epoch then
      return query
      select
        v_existing.target_type,
        v_existing.target_id,
        v_existing.new_visibility,
        v_existing.new_moderation_epoch,
        v_existing.result_revision,
        true;
      return;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REQUEST_CONFLICT';
  end if;

  if p_post_id is not null then
    select p.author_token
    into v_target_token
    from public.board_posts as p
    where p.id = p_post_id;
  else
    select c.author_token, c.post_id
    into v_target_token, v_post_for_comment
    from public.board_comments as c
    where c.id = p_comment_id;
  end if;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;

  perform public.brownsync_lock_board_author(v_target_token, 1);

  if p_post_id is not null then
    select p.*
    into v_post
    from public.board_posts as p
    where p.id = p_post_id
    for update;
    if not found or v_post.author_token <> v_target_token then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;
    v_old_visibility := v_post.visibility;
    v_old_epoch := v_post.moderation_epoch;
    v_revision := v_post.revision;
  else
    perform 1
    from public.board_posts as p
    where p.id = v_post_for_comment
    for update;
    select c.*
    into v_comment
    from public.board_comments as c
    where c.id = p_comment_id
    for update;
    if not found or v_comment.author_token <> v_target_token then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_NOT_FOUND';
    end if;
    v_old_visibility := v_comment.visibility;
    v_old_epoch := v_comment.moderation_epoch;
    v_revision := v_comment.revision;
  end if;

  if v_old_epoch <> p_expected_epoch then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REVISION_CONFLICT';
  end if;

  if v_old_visibility in ('removed', 'author_deleted', 'account_deleted') then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
  end if;

  if v_action = 'hide' then
    if v_old_visibility not in ('visible', 'auto_hidden') then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
    end if;
    v_new_visibility := 'moderator_hidden';
    v_new_epoch := v_old_epoch;
  elsif v_action = 'remove' then
    v_new_visibility := 'removed';
    v_new_epoch := v_old_epoch;
  else
    if v_action = 'restore'
       and v_old_visibility not in ('auto_hidden', 'moderator_hidden') then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
    end if;
    if v_action = 'dismiss'
       and v_old_visibility not in (
         'visible',
         'auto_hidden',
         'moderator_hidden'
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
    end if;
    v_new_visibility := 'visible';
    v_new_epoch := v_old_epoch + 1;
  end if;

  if p_post_id is not null then
    update public.board_posts
    set create_fingerprint =
          case when v_new_visibility = 'removed' then null
               else board_posts.create_fingerprint end,
        title = case when v_new_visibility = 'removed' then null
                     else board_posts.title end,
        body = case when v_new_visibility = 'removed' then null
                    else board_posts.body end,
        visibility = v_new_visibility,
        moderation_epoch = v_new_epoch,
        revision = board_posts.revision + 1,
        updated_at = v_now
    where id = p_post_id
    returning board_posts.revision into v_revision;
  else
    update public.board_comments
    set create_fingerprint =
          case when v_new_visibility = 'removed' then null
               else board_comments.create_fingerprint end,
        body = case when v_new_visibility = 'removed' then null
                    else board_comments.body end,
        visibility = v_new_visibility,
        moderation_epoch = v_new_epoch,
        revision = board_comments.revision + 1,
        updated_at = v_now
    where id = p_comment_id
    returning board_comments.revision into v_revision;
  end if;

  if v_action in ('restore', 'dismiss') then
    update public.board_reports
    set state = 'dismissed',
        reviewed_by = p_actor,
        reviewed_at = v_now,
        updated_at = v_now
    where state = 'open'
      and target_epoch = v_old_epoch
      and (
        (p_post_id is not null and post_id = p_post_id)
        or (p_comment_id is not null and comment_id = p_comment_id)
      );
  elsif v_action in ('hide', 'remove') then
    update public.board_reports
    set state = 'upheld',
        reviewed_by = p_actor,
        reviewed_at = v_now,
        updated_at = v_now
    where state = 'open'
      and target_epoch = v_old_epoch
      and (
        (p_post_id is not null and post_id = p_post_id)
        or (p_comment_id is not null and comment_id = p_comment_id)
      );
  end if;

  if v_action = 'remove' and p_post_id is not null then
    update public.board_reports
    set state = 'upheld',
        reviewed_by = p_actor,
        reviewed_at = v_now,
        updated_at = v_now
    where board_reports.state = 'open'
      and board_reports.comment_id in (
        select c.id
        from public.board_comments as c
        where c.post_id = p_post_id
      );

    delete from public.board_appeals
    where board_appeals.state = 'pending'
      and (
        board_appeals.post_id = p_post_id
        or board_appeals.comment_id in (
          select c.id
          from public.board_comments as c
          where c.post_id = p_post_id
        )
      );
  end if;

  if v_action in ('restore', 'dismiss', 'remove') then
    delete from public.board_appeals
    where board_appeals.state = 'pending'
      and (
        (
          p_post_id is not null
          and board_appeals.post_id = p_post_id
          and board_appeals.target_epoch = v_old_epoch
        )
        or (
          p_comment_id is not null
          and board_appeals.comment_id = p_comment_id
          and board_appeals.target_epoch = v_old_epoch
        )
      );
  end if;

  insert into public.board_moderation_actions (
    actor_kind,
    moderator_user_id,
    target_type,
    target_id,
    client_request_id,
    action,
    reason,
    old_visibility,
    new_visibility,
    old_moderation_epoch,
    new_moderation_epoch,
    result_revision
  ) values (
    'moderator',
    p_actor,
    case when p_post_id is not null then 'post' else 'comment' end,
    coalesce(p_post_id, p_comment_id),
    p_client_request_id,
    v_action,
    v_reason,
    v_old_visibility,
    v_new_visibility,
    v_old_epoch,
    v_new_epoch,
    v_revision
  );

  return query
  select
    case when p_post_id is not null then 'post'::text else 'comment'::text end,
    coalesce(p_post_id, p_comment_id),
    v_new_visibility,
    v_new_epoch,
    v_revision,
    false;
end
$$;

create function public.brownsync_create_board_ban(
  p_actor uuid,
  p_client_request_id uuid,
  p_post_id uuid,
  p_comment_id uuid,
  p_duration_seconds integer,
  p_reason text,
  p_note text
)
returns table (
  ban_id uuid,
  expires_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_note text := case when p_note is null then null
                      else pg_catalog.btrim(p_note) end;
  v_existing public.board_bans%rowtype;
  v_existing_action public.board_moderation_actions%rowtype;
  v_target_token text;
  v_post_id uuid;
  v_visibility text;
  v_epoch bigint;
  v_id uuid;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_expires timestamptz;
begin
  if p_client_request_id is null
     or (p_post_id is not null)::integer
          + (p_comment_id is not null)::integer <> 1
     or p_duration_seconds is null
     or p_duration_seconds < 300
     or p_duration_seconds > 31536000
     or pg_catalog.char_length(v_reason) not between 1 and 240
     or (
       v_note is not null
       and pg_catalog.char_length(v_note) not between 1 and 1000
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  perform public.brownsync_require_board_moderator(p_actor, false);
  perform public.brownsync_lock_board_moderator_requests(p_actor);

  select a.*
  into v_existing_action
  from public.board_moderation_actions as a
  where a.moderator_user_id = p_actor
    and a.client_request_id = p_client_request_id;

  if found then
    select b.*
    into v_existing
    from public.board_bans as b
    where b.created_by = p_actor
      and b.client_request_id = p_client_request_id;

    if found
       and v_existing_action.action = 'ban_created'
       and v_existing_action.target_type = (
         case when p_post_id is not null then 'post' else 'comment' end
       )
       and v_existing_action.target_id = coalesce(p_post_id, p_comment_id)
       and v_existing_action.reason = v_reason
       and extract(
         epoch from (v_existing.expires_at - v_existing.starts_at)
       )::integer = p_duration_seconds
       and v_existing.note is not distinct from v_note then
      return query
      select v_existing.id, v_existing.expires_at, true;
      return;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REQUEST_CONFLICT';
  end if;

  if p_post_id is not null then
    select p.author_token
    into v_target_token
    from public.board_posts as p
    where p.id = p_post_id;
    v_post_id := p_post_id;
  else
    select c.author_token, c.post_id
    into v_target_token, v_post_id
    from public.board_comments as c
    where c.id = p_comment_id;
  end if;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;

  perform public.brownsync_lock_board_author(v_target_token, 1);

  perform 1
  from public.board_posts as p
  where p.id = v_post_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;

  if p_post_id is not null then
    select p.author_token, p.visibility, p.moderation_epoch
    into v_target_token, v_visibility, v_epoch
    from public.board_posts as p
    where p.id = p_post_id
    for update;
  else
    select c.author_token, c.visibility, c.moderation_epoch
    into v_target_token, v_visibility, v_epoch
    from public.board_comments as c
    where c.id = p_comment_id
    for update;
  end if;
  if not found
     or v_target_token is null
     or v_target_token !~ '^[0-9a-f]{64}$'
     or v_visibility in ('removed', 'author_deleted', 'account_deleted') then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;

  select b.*
  into v_existing
  from public.board_bans as b
  where b.created_by = p_actor
    and b.client_request_id = p_client_request_id
  for update;

  if found then
    if v_existing.author_token = v_target_token
       and extract(
         epoch from (v_existing.expires_at - v_existing.starts_at)
       )::integer = p_duration_seconds
       and v_existing.reason = v_reason
       and v_existing.note is not distinct from v_note then
      return query
      select v_existing.id, v_existing.expires_at, true;
      return;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REQUEST_CONFLICT';
  end if;

  -- Expired history remains, but it is explicitly closed under the same
  -- per-token mutex so the partial active-ban index cannot strand the token.
  update public.board_bans
  set revoked_at = board_bans.expires_at,
      revocation_reason = 'expired',
      revocation_request_id = pg_catalog.gen_random_uuid()
  where board_bans.author_token = v_target_token
    and board_bans.revoked_at is null
    and board_bans.expires_at <= v_now;

  delete from public.board_appeals as a
  using public.board_bans as b
  where a.ban_id = b.id
    and a.state = 'pending'
    and b.author_token = v_target_token
    and b.revoked_at is not null;

  if exists (
    select 1
    from public.board_bans as b
    where b.author_token = v_target_token
      and b.revoked_at is null
      and b.expires_at > v_now
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
  end if;

  v_id := pg_catalog.gen_random_uuid();
  v_expires := v_now
    + pg_catalog.make_interval(secs => p_duration_seconds);

  insert into public.board_bans (
    id,
    author_token,
    token_version,
    starts_at,
    expires_at,
    reason,
    note,
    created_by,
    client_request_id
  ) values (
    v_id,
    v_target_token,
    1,
    v_now,
    v_expires,
    v_reason,
    v_note,
    p_actor,
    p_client_request_id
  );

  insert into public.board_moderation_actions (
    actor_kind,
    moderator_user_id,
    target_type,
    target_id,
    client_request_id,
    action,
    reason,
    old_visibility,
    new_visibility,
    old_moderation_epoch,
    new_moderation_epoch
  ) values (
    'moderator',
    p_actor,
    case when p_post_id is not null then 'post' else 'comment' end,
    coalesce(p_post_id, p_comment_id),
    p_client_request_id,
    'ban_created',
    v_reason,
    v_visibility,
    v_visibility,
    v_epoch,
    v_epoch
  );

  return query select v_id, v_expires, false;
end
$$;

create function public.brownsync_revoke_board_ban(
  p_actor uuid,
  p_client_request_id uuid,
  p_ban_id uuid,
  p_reason text
)
returns table (
  ban_id uuid,
  revoked_at timestamptz,
  changed boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_ban public.board_bans%rowtype;
  v_existing public.board_moderation_actions%rowtype;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  if p_client_request_id is null
     or p_ban_id is null
     or pg_catalog.char_length(v_reason) not between 1 and 240 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  perform public.brownsync_require_board_moderator(p_actor, false);
  perform public.brownsync_lock_board_moderator_requests(p_actor);

  select a.*
  into v_existing
  from public.board_moderation_actions as a
  where a.moderator_user_id = p_actor
    and a.client_request_id = p_client_request_id;
  if found then
    if v_existing.target_type = 'ban'
       and v_existing.target_id = p_ban_id
       and v_existing.action = 'ban_revoked'
       and v_existing.reason = v_reason then
      select b.*
      into v_ban
      from public.board_bans as b
      where b.id = p_ban_id;
      if not found then
        raise exception using
          errcode = 'P0001',
          message = 'BROWNSYNC_BOARD_NOT_FOUND';
      end if;
      return query
      select
        p_ban_id,
        v_ban.revoked_at,
        false,
        true;
      return;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REQUEST_CONFLICT';
  end if;

  select b.*
  into v_ban
  from public.board_bans as b
  where b.id = p_ban_id;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;

  perform public.brownsync_lock_board_author(v_ban.author_token, 1);

  select b.*
  into v_ban
  from public.board_bans as b
  where b.id = p_ban_id
  for update;

  if v_ban.revoked_at is not null then
    return query select v_ban.id, v_ban.revoked_at, false, false;
    return;
  end if;

  update public.board_bans
  set revoked_at = v_now,
      revoked_by = p_actor,
      revocation_reason = v_reason,
      revocation_request_id = p_client_request_id
  where id = v_ban.id;

  delete from public.board_appeals
  where board_appeals.ban_id = v_ban.id
    and board_appeals.state = 'pending';

  insert into public.board_moderation_actions (
    actor_kind,
    moderator_user_id,
    target_type,
    target_id,
    client_request_id,
    action,
    reason
  ) values (
    'moderator',
    p_actor,
    'ban',
    v_ban.id,
    p_client_request_id,
    'ban_revoked',
    v_reason
  );

  return query select v_ban.id, v_now, true, false;
end
$$;

create function public.brownsync_decide_board_appeal(
  p_actor uuid,
  p_client_request_id uuid,
  p_appeal_id uuid,
  p_decision text,
  p_reason text
)
returns table (
  appeal_id uuid,
  state text,
  target_type text,
  target_id uuid,
  changed boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decision text := pg_catalog.btrim(coalesce(p_decision, ''));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_appeal public.board_appeals%rowtype;
  v_existing public.board_moderation_actions%rowtype;
  v_target_type text;
  v_target_id uuid;
  v_post_id uuid;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  if p_client_request_id is null
     or p_appeal_id is null
     or v_decision not in ('approved', 'denied')
     or pg_catalog.char_length(v_reason) not between 1 and 240 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  perform public.brownsync_require_board_moderator(p_actor, false);
  perform public.brownsync_lock_board_moderator_requests(p_actor);

  select a.*
  into v_existing
  from public.board_moderation_actions as a
  where a.moderator_user_id = p_actor
    and a.client_request_id = p_client_request_id;
  if found then
    if v_existing.target_type = 'appeal'
       and v_existing.target_id = p_appeal_id
       and v_existing.action = (
         case when v_decision = 'approved'
              then 'appeal_approved' else 'appeal_denied' end
       )
       and v_existing.reason = v_reason then
      select a.*
      into v_appeal
      from public.board_appeals as a
      where a.id = p_appeal_id;
      if not found then
        raise exception using
          errcode = 'P0001',
          message = 'BROWNSYNC_BOARD_NOT_FOUND';
      end if;
      v_target_type := case
        when v_appeal.post_id is not null then 'post'
        when v_appeal.comment_id is not null then 'comment'
        else 'ban'
      end;
      v_target_id := coalesce(
        v_appeal.post_id,
        v_appeal.comment_id,
        v_appeal.ban_id
      );
      return query
      select
        v_appeal.id,
        v_appeal.state,
        v_target_type,
        v_target_id,
        false,
        true;
      return;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_REQUEST_CONFLICT';
  end if;

  select a.*
  into v_appeal
  from public.board_appeals as a
  where a.id = p_appeal_id;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;

  perform public.brownsync_lock_board_author(v_appeal.author_token, 1);

  if v_appeal.post_id is not null then
    v_target_type := 'post';
    v_target_id := v_appeal.post_id;
    perform 1
    from public.board_posts as p
    where p.id = v_appeal.post_id
    for update;
  elsif v_appeal.comment_id is not null then
    v_target_type := 'comment';
    v_target_id := v_appeal.comment_id;
    select c.post_id
    into v_post_id
    from public.board_comments as c
    where c.id = v_appeal.comment_id;
    perform 1
    from public.board_posts as p
    where p.id = v_post_id
    for update;
    perform 1
    from public.board_comments as c
    where c.id = v_appeal.comment_id
    for update;
  else
    v_target_type := 'ban';
    v_target_id := v_appeal.ban_id;
    perform 1
    from public.board_bans as b
    where b.id = v_appeal.ban_id
    for update;
  end if;

  select a.*
  into v_appeal
  from public.board_appeals as a
  where a.id = p_appeal_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_NOT_FOUND';
  end if;

  if v_appeal.state <> 'pending' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
  end if;

  if v_decision = 'approved' and v_target_type = 'post' then
    update public.board_posts
    set visibility = 'visible',
        moderation_epoch = board_posts.moderation_epoch + 1,
        revision = board_posts.revision + 1,
        updated_at = v_now
    where id = v_target_id
      and author_token = v_appeal.author_token
      and moderation_epoch = v_appeal.target_epoch
      and visibility in ('auto_hidden', 'moderator_hidden');
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_REVISION_CONFLICT';
    end if;
    update public.board_reports
    set state = 'dismissed',
        reviewed_by = p_actor,
        reviewed_at = v_now,
        updated_at = v_now
    where post_id = v_target_id
      and target_epoch = v_appeal.target_epoch
      and board_reports.state = 'open';
  elsif v_decision = 'approved' and v_target_type = 'comment' then
    update public.board_comments
    set visibility = 'visible',
        moderation_epoch = board_comments.moderation_epoch + 1,
        revision = board_comments.revision + 1,
        updated_at = v_now
    where id = v_target_id
      and author_token = v_appeal.author_token
      and moderation_epoch = v_appeal.target_epoch
      and visibility in ('auto_hidden', 'moderator_hidden');
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_REVISION_CONFLICT';
    end if;
    update public.board_reports
    set state = 'dismissed',
        reviewed_by = p_actor,
        reviewed_at = v_now,
        updated_at = v_now
    where comment_id = v_target_id
      and target_epoch = v_appeal.target_epoch
      and board_reports.state = 'open';
  elsif v_decision = 'approved' and v_target_type = 'ban' then
    update public.board_bans
    set revoked_at = v_now,
        revoked_by = p_actor,
        revocation_reason = v_reason,
        revocation_request_id = p_client_request_id
    where id = v_target_id
      and author_token = v_appeal.author_token
      and revoked_at is null;
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_REVISION_CONFLICT';
    end if;
  end if;

  update public.board_appeals
  set state = v_decision,
      decided_by = p_actor,
      decided_at = v_now,
      decision_reason = v_reason,
      decision_request_id = p_client_request_id,
      updated_at = v_now
  where id = v_appeal.id;

  insert into public.board_moderation_actions (
    actor_kind,
    moderator_user_id,
    target_type,
    target_id,
    client_request_id,
    action,
    reason
  ) values (
    'moderator',
    p_actor,
    'appeal',
    v_appeal.id,
    p_client_request_id,
    case when v_decision = 'approved'
         then 'appeal_approved' else 'appeal_denied' end,
    v_reason
  );

  return query
  select
    v_appeal.id,
    v_decision,
    v_target_type,
    v_target_id,
    true,
    false;
end
$$;

create function public.brownsync_get_board_config(p_actor uuid)
returns table (
  enabled boolean,
  auto_hide_threshold integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.brownsync_require_board_moderator(p_actor, true);

  return query
  select c.enabled, c.auto_hide_threshold, c.updated_at
  from public.board_control as c
  where c.id = true;
end
$$;

create function public.brownsync_set_board_config(
  p_actor uuid,
  p_enabled boolean,
  p_auto_hide_threshold integer
)
returns table (
  enabled boolean,
  auto_hide_threshold integer,
  updated_at timestamptz,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control public.board_control%rowtype;
  v_actor_role text;
begin
  if p_enabled is null
     or p_auto_hide_threshold is null
     or p_auto_hide_threshold < 2
     or p_auto_hide_threshold > 10 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  perform public.brownsync_require_board_actor(p_actor);

  select c.*
  into v_control
  from public.board_control as c
  where c.id = true
  for update;

  select m.role
  into v_actor_role
  from public.board_moderators as m
  where m.user_id = p_actor;
  if not found or v_actor_role <> 'owner' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_FORBIDDEN';
  end if;

  if v_control.enabled = p_enabled
     and v_control.auto_hide_threshold = p_auto_hide_threshold then
    return query
    select
      v_control.enabled,
      v_control.auto_hide_threshold,
      v_control.updated_at,
      false;
    return;
  end if;

  update public.board_control
  set enabled = p_enabled,
      auto_hide_threshold = p_auto_hide_threshold,
      updated_by = p_actor,
      updated_at = pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
  where id = true
  returning board_control.* into v_control;

  return query
  select
    v_control.enabled,
    v_control.auto_hide_threshold,
    v_control.updated_at,
    true;
end
$$;

create function public.brownsync_list_board_moderators(
  p_actor uuid,
  p_before_granted_at timestamptz,
  p_before_user_id uuid,
  p_limit integer default 25
)
returns table (
  user_id uuid,
  role text,
  granted_by uuid,
  granted_at timestamptz,
  has_more boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.brownsync_require_board_moderator(p_actor, true);

  if p_limit is null or p_limit < 1 or p_limit > 50
     or ((p_before_granted_at is null) <> (p_before_user_id is null))
     or (
       p_before_granted_at is not null
       and not pg_catalog.isfinite(p_before_granted_at)
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  return query
  with page as (
    select m.*
    from public.board_moderators as m
    where p_before_granted_at is null
       or (m.granted_at, m.user_id) < (
         p_before_granted_at,
         p_before_user_id
       )
    order by m.granted_at desc, m.user_id desc
    limit p_limit + 1
  ),
  bounded as (
    select p.*, pg_catalog.row_number() over (
      order by p.granted_at desc, p.user_id desc
    ) as rn
    from page as p
  ),
  meta as (
    select pg_catalog.count(*) > p_limit as more
    from page
  )
  select p.user_id, p.role, p.granted_by, p.granted_at, m.more
  from bounded as p
  cross join meta as m
  where p.rn <= p_limit
  order by p.granted_at desc, p.user_id desc;
end
$$;

create function public.brownsync_add_board_moderator(
  p_actor uuid,
  p_user_id uuid,
  p_role text
)
returns table (
  user_id uuid,
  role text,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := pg_catalog.btrim(coalesce(p_role, ''));
  v_existing public.board_moderators%rowtype;
  v_owner_count integer;
  v_actor_role text;
begin
  if p_user_id is null or v_role not in ('moderator', 'owner') then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  -- Reject non-owners before touching the requested target admission row so
  -- this authority endpoint cannot be used as an admission oracle.
  select m.role
  into v_actor_role
  from public.board_moderators as m
  where m.user_id = p_actor;
  if not found or v_actor_role <> 'owner' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_FORBIDDEN';
  end if;

  -- Lock both identifiable admission rows in UUID order before the shared
  -- authority mutex. This prevents cross-add and config/add inversions.
  if p_actor = p_user_id then
    perform public.brownsync_require_board_actor(p_actor);
  elsif p_actor < p_user_id then
    perform public.brownsync_require_board_actor(p_actor);
    perform public.brownsync_require_board_actor(p_user_id);
  else
    perform public.brownsync_require_board_actor(p_user_id);
    perform public.brownsync_require_board_actor(p_actor);
  end if;
  perform 1
  from public.board_control as c
  where c.id = true
  for update;
  select m.role
  into v_actor_role
  from public.board_moderators as m
  where m.user_id = p_actor;
  if not found or v_actor_role <> 'owner' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_FORBIDDEN';
  end if;
  -- Role changes and removals share one deterministic authority-set lock so
  -- concurrent owner demotions cannot strand the board without an owner.
  perform 1
  from public.board_moderators as m
  order by m.user_id
  for update;

  select m.*
  into v_existing
  from public.board_moderators as m
  where m.user_id = p_user_id;

  if found and v_existing.role = v_role then
    return query select v_existing.user_id, v_existing.role, false;
    return;
  end if;

  if found and v_existing.role = 'owner' and v_role <> 'owner' then
    select pg_catalog.count(*)::integer
    into v_owner_count
    from public.board_moderators as m
    where m.role = 'owner';

    if v_owner_count <= 1 then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
    end if;
  end if;

  insert into public.board_moderators (
    user_id,
    role,
    granted_by
  ) values (
    p_user_id,
    v_role,
    case when p_user_id = p_actor then null else p_actor end
  )
  on conflict on constraint board_moderators_pkey do update
  set role = excluded.role,
      granted_by = case
        when excluded.user_id = p_actor
          then public.board_moderators.granted_by
        else p_actor
      end,
      granted_at = pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  return query select p_user_id, v_role, true;
end
$$;

create function public.brownsync_remove_board_moderator(
  p_actor uuid,
  p_user_id uuid
)
returns table (
  user_id uuid,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.board_moderators%rowtype;
  v_owner_count integer;
  v_actor_role text;
begin
  if p_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end if;

  perform public.brownsync_require_board_actor(p_actor);
  perform 1
  from public.board_control as c
  where c.id = true
  for update;
  select m.role
  into v_actor_role
  from public.board_moderators as m
  where m.user_id = p_actor;
  if not found or v_actor_role <> 'owner' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_BOARD_FORBIDDEN';
  end if;

  perform 1
  from public.board_moderators as m
  order by m.user_id
  for update;

  select m.*
  into v_target
  from public.board_moderators as m
  where m.user_id = p_user_id;

  if not found then
    return query select p_user_id, false;
    return;
  end if;

  if v_target.role = 'owner' then
    select pg_catalog.count(*)::integer
    into v_owner_count
    from public.board_moderators as m
    where m.role = 'owner';
    if v_owner_count <= 1 then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
    end if;
  end if;

  delete from public.board_moderators
  where board_moderators.user_id = p_user_id;

  return query select p_user_id, true;
end
$$;

create function public.brownsync_delete_board_account(
  p_actor uuid,
  p_author_token text
)
returns table (
  posts_tombstoned integer,
  comments_tombstoned integer,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_posts integer;
  v_comments integer;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  perform public.brownsync_validate_board_token(p_author_token, 1);

  -- The exact durable fence is the retry record. It must be resolved before
  -- admission because the outer Auth deletion may have committed while its
  -- HTTP response was lost.
  if exists (
    select 1
    from public.board_account_deletion_fences as f
    where f.author_token = p_author_token
      and f.token_version = 1
  ) then
    delete from public.board_rate_limits
    where board_rate_limits.author_token = p_author_token;
    return query select 0, 0, true;
    return;
  end if;

  perform public.brownsync_require_board_actor(p_actor);
  perform public.brownsync_lock_board_control(false);
  perform public.brownsync_lock_board_author(p_author_token, 1);

  if exists (
    select 1
    from public.board_account_deletion_fences as f
    where f.author_token = p_author_token
      and f.token_version = 1
  ) then
    delete from public.board_rate_limits
    where board_rate_limits.author_token = p_author_token;
    return query select 0, 0, true;
    return;
  end if;

  insert into public.board_account_deletion_fences (
    author_token,
    token_version
  ) values (
    p_author_token,
    1
  );

  perform 1
  from public.board_posts as p
  where p.author_token = p_author_token
  order by p.id
  for update;

  perform 1
  from public.board_comments as c
  where c.author_token = p_author_token
  order by c.post_id, c.id
  for update;

  select pg_catalog.count(*)::integer
  into v_posts
  from public.board_posts as p
  where p.author_token = p_author_token;

  select pg_catalog.count(*)::integer
  into v_comments
  from public.board_comments as c
  where c.author_token = p_author_token;

  update public.board_reports
  set state = 'dismissed',
      reviewed_at = v_now,
      updated_at = v_now
  where state = 'open'
    and (
      post_id in (
        select p.id
        from public.board_posts as p
        where p.author_token = p_author_token
      )
      or comment_id in (
        select c.id
        from public.board_comments as c
        where c.author_token = p_author_token
           or c.post_id in (
             select p.id
             from public.board_posts as p
             where p.author_token = p_author_token
           )
      )
    );

  delete from public.board_appeals
  where board_appeals.state = 'pending'
    and (
      board_appeals.post_id in (
        select p.id
        from public.board_posts as p
        where p.author_token = p_author_token
      )
      or board_appeals.comment_id in (
        select c.id
        from public.board_comments as c
        where c.author_token = p_author_token
           or c.post_id in (
             select p.id
             from public.board_posts as p
             where p.author_token = p_author_token
           )
      )
    );

  delete from public.board_votes
  where author_token = p_author_token;

  delete from public.board_reports
  where reporter_token = p_author_token;

  delete from public.board_appeals
  where author_token = p_author_token
    and state = 'pending';

  -- Decided content appeals may remain as body-free moderation history, but
  -- each receives its own unlinkable token. Ban appeals disappear with bans.
  update public.board_appeals
  set author_token = pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(
            pg_catalog.gen_random_uuid()::text,
            'UTF8'
          )
        ),
        'hex'
      ),
      body = null,
      updated_at = v_now
  where author_token = p_author_token
    and state <> 'pending'
    and ban_id is null;

  delete from public.board_bans
  where author_token = p_author_token;

  update public.board_posts
  set author_token = pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(
            pg_catalog.gen_random_uuid()::text,
            'UTF8'
          )
        ),
        'hex'
      ),
      create_fingerprint = null,
      title = null,
      body = null,
      visibility = 'account_deleted',
      revision = board_posts.revision + 1,
      updated_at = v_now
  where author_token = p_author_token;

  update public.board_comments
  set author_token = pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(
            pg_catalog.gen_random_uuid()::text,
            'UTF8'
          )
        ),
        'hex'
      ),
      create_fingerprint = null,
      body = null,
      visibility = 'account_deleted',
      revision = board_comments.revision + 1,
      updated_at = v_now
  where author_token = p_author_token;

  delete from public.board_rate_limits
  where author_token = p_author_token;

  return query
  select coalesce(v_posts, 0), coalesce(v_comments, 0), false;
end
$$;

revoke all on table
  public.board_control,
  public.board_moderators,
  public.board_posts,
  public.board_comments,
  public.board_votes,
  public.board_reports,
  public.board_bans,
  public.board_appeals,
  public.board_moderation_actions,
  public.board_rate_limits,
  public.board_account_deletion_fences
from public, anon, authenticated;

do $$
declare
  v_proc record;
begin
  for v_proc in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'brownsync%board%'
        or p.proname = 'brownsync_delete_board_account'
      )
  loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated',
      v_proc.signature
    );
  end loop;
end
$$;

commit;
