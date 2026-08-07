\set ON_ERROR_STOP on

-- 0015_board_checks.sql
-- Rollback-safe semantic checks for the native Brown-only pseudonymous board.

begin;

do $$
declare
  v_name text;
begin
  foreach v_name in array array[
    'board_control',
    'board_moderators',
    'board_posts',
    'board_comments',
    'board_votes',
    'board_reports',
    'board_bans',
    'board_appeals',
    'board_moderation_actions',
    'board_rate_limits',
    'board_account_deletion_fences'
  ] loop
    if pg_catalog.to_regclass('public.' || v_name) is null then
      raise exception
        'BROWNSYNC_BOARD_MIGRATION_MISSING: table %', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'brownsync_get_board_feed(uuid,text,integer,timestamp with time zone,uuid,integer)',
    'brownsync_get_board_thread(uuid,text,integer,uuid,timestamp with time zone,uuid,integer)',
    'brownsync_get_own_board_content(uuid,text,integer,timestamp with time zone,uuid,integer)',
    'brownsync_get_board_status(uuid,text,integer)',
    'brownsync_create_board_post(uuid,text,integer,uuid,text,text)',
    'brownsync_edit_board_post(uuid,text,integer,uuid,bigint,jsonb)',
    'brownsync_delete_board_post(uuid,text,integer,uuid,bigint)',
    'brownsync_create_board_comment(uuid,text,integer,uuid,uuid,uuid,text)',
    'brownsync_edit_board_comment(uuid,text,integer,uuid,bigint,text)',
    'brownsync_delete_board_comment(uuid,text,integer,uuid,bigint)',
    'brownsync_set_board_vote(uuid,text,integer,uuid,uuid,integer)',
    'brownsync_report_board_content(uuid,text,integer,uuid,uuid,text,text)',
    'brownsync_create_board_appeal(uuid,text,integer,uuid,uuid,uuid,uuid,bigint,text)',
    'brownsync_get_board_moderation_queue(uuid,timestamp with time zone,uuid,integer)',
    'brownsync_decide_board_content(uuid,uuid,uuid,uuid,bigint,text,text)',
    'brownsync_create_board_ban(uuid,uuid,uuid,uuid,integer,text,text)',
    'brownsync_revoke_board_ban(uuid,uuid,uuid,text)',
    'brownsync_decide_board_appeal(uuid,uuid,uuid,text,text)',
    'brownsync_get_board_config(uuid)',
    'brownsync_set_board_config(uuid,boolean,integer)',
    'brownsync_list_board_moderators(uuid,timestamp with time zone,uuid,integer)',
    'brownsync_add_board_moderator(uuid,uuid,text)',
    'brownsync_remove_board_moderator(uuid,uuid)',
    'brownsync_delete_board_account(uuid,text)'
  ] loop
    if pg_catalog.to_regprocedure('public.' || v_name) is null then
      raise exception
        'BROWNSYNC_BOARD_MIGRATION_MISSING: routine %', v_name;
    end if;
  end loop;
end
$$;

-- Exact result contracts are the Worker/query seam.
do $$
declare
  v_signature text;
  v_expected text;
  v_actual text;
begin
  for v_signature, v_expected in
    select *
    from (
      values
        (
          'brownsync_get_board_feed(uuid,text,integer,timestamp with time zone,uuid,integer)',
          'TABLE(post_id uuid, title text, body text, visibility text, moderation_epoch bigint, score integer, revision bigint, author_alias text, is_mine boolean, comment_count integer, viewer_vote integer, created_at timestamp with time zone, updated_at timestamp with time zone, has_more boolean)'
        ),
        (
          'brownsync_get_board_thread(uuid,text,integer,uuid,timestamp with time zone,uuid,integer)',
          'TABLE(post_id uuid, post_title text, post_body text, post_visibility text, post_moderation_epoch bigint, post_score integer, post_revision bigint, post_author_alias text, post_is_mine boolean, post_viewer_vote integer, post_created_at timestamp with time zone, post_updated_at timestamp with time zone, comment_id uuid, parent_comment_id uuid, comment_body text, comment_visibility text, comment_moderation_epoch bigint, comment_score integer, comment_revision bigint, comment_author_alias text, comment_is_mine boolean, comment_viewer_vote integer, comment_created_at timestamp with time zone, comment_updated_at timestamp with time zone, has_more boolean)'
        ),
        (
          'brownsync_get_own_board_content(uuid,text,integer,timestamp with time zone,uuid,integer)',
          'TABLE(item_type text, item_id uuid, post_id uuid, parent_comment_id uuid, title text, body text, visibility text, moderation_epoch bigint, score integer, revision bigint, created_at timestamp with time zone, updated_at timestamp with time zone, has_more boolean)'
        ),
        (
          'brownsync_get_board_status(uuid,text,integer)',
          'TABLE(enabled boolean, author_alias text, banned boolean, ban_id uuid, banned_until timestamp with time zone, ban_reason text, pending_appeals integer)'
        ),
        (
          'brownsync_create_board_post(uuid,text,integer,uuid,text,text)',
          'TABLE(post_id uuid, revision bigint, replayed boolean)'
        ),
        (
          'brownsync_edit_board_post(uuid,text,integer,uuid,bigint,jsonb)',
          'TABLE(post_id uuid, revision bigint, changed boolean)'
        ),
        (
          'brownsync_delete_board_post(uuid,text,integer,uuid,bigint)',
          'TABLE(post_id uuid, revision bigint, changed boolean)'
        ),
        (
          'brownsync_create_board_comment(uuid,text,integer,uuid,uuid,uuid,text)',
          'TABLE(comment_id uuid, post_id uuid, revision bigint, replayed boolean)'
        ),
        (
          'brownsync_edit_board_comment(uuid,text,integer,uuid,bigint,text)',
          'TABLE(comment_id uuid, revision bigint, changed boolean)'
        ),
        (
          'brownsync_delete_board_comment(uuid,text,integer,uuid,bigint)',
          'TABLE(comment_id uuid, revision bigint, changed boolean)'
        ),
        (
          'brownsync_set_board_vote(uuid,text,integer,uuid,uuid,integer)',
          'TABLE(post_id uuid, comment_id uuid, value integer, score integer, changed boolean)'
        ),
        (
          'brownsync_report_board_content(uuid,text,integer,uuid,uuid,text,text)',
          'TABLE(report_id uuid, target_epoch bigint, visibility text, revision bigint, auto_hidden boolean, replayed boolean)'
        ),
        (
          'brownsync_create_board_appeal(uuid,text,integer,uuid,uuid,uuid,uuid,bigint,text)',
          'TABLE(appeal_id uuid, state text, replayed boolean)'
        ),
        (
          'brownsync_get_board_moderation_queue(uuid,timestamp with time zone,uuid,integer)',
          'TABLE(queue_kind text, queue_id uuid, target_type text, target_id uuid, post_id uuid, parent_comment_id uuid, title text, body text, visibility text, moderation_epoch bigint, score integer, open_report_count integer, report_reasons text[], appeal_body text, created_at timestamp with time zone, updated_at timestamp with time zone, has_more boolean)'
        ),
        (
          'brownsync_decide_board_content(uuid,uuid,uuid,uuid,bigint,text,text)',
          'TABLE(target_type text, target_id uuid, visibility text, moderation_epoch bigint, revision bigint, replayed boolean)'
        ),
        (
          'brownsync_create_board_ban(uuid,uuid,uuid,uuid,integer,text,text)',
          'TABLE(ban_id uuid, expires_at timestamp with time zone, replayed boolean)'
        ),
        (
          'brownsync_revoke_board_ban(uuid,uuid,uuid,text)',
          'TABLE(ban_id uuid, revoked_at timestamp with time zone, changed boolean, replayed boolean)'
        ),
        (
          'brownsync_decide_board_appeal(uuid,uuid,uuid,text,text)',
          'TABLE(appeal_id uuid, state text, target_type text, target_id uuid, changed boolean, replayed boolean)'
        ),
        (
          'brownsync_get_board_config(uuid)',
          'TABLE(enabled boolean, auto_hide_threshold integer, updated_at timestamp with time zone)'
        ),
        (
          'brownsync_set_board_config(uuid,boolean,integer)',
          'TABLE(enabled boolean, auto_hide_threshold integer, updated_at timestamp with time zone, changed boolean)'
        ),
        (
          'brownsync_list_board_moderators(uuid,timestamp with time zone,uuid,integer)',
          'TABLE(user_id uuid, role text, granted_by uuid, granted_at timestamp with time zone, has_more boolean)'
        ),
        (
          'brownsync_add_board_moderator(uuid,uuid,text)',
          'TABLE(user_id uuid, role text, changed boolean)'
        ),
        (
          'brownsync_remove_board_moderator(uuid,uuid)',
          'TABLE(user_id uuid, changed boolean)'
        ),
        (
          'brownsync_delete_board_account(uuid,text)',
          'TABLE(posts_tombstoned integer, comments_tombstoned integer, replayed boolean)'
        )
    ) as expected(signature, result_type)
  loop
    select pg_catalog.pg_get_function_result(
      pg_catalog.to_regprocedure('public.' || v_signature)
    )
    into v_actual;
    if v_actual <> v_expected then
      raise exception
        'board result drift for %: expected %, got %',
        v_signature,
        v_expected,
        v_actual;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'brownsync_get_board_feed',
        'brownsync_get_board_thread',
        'brownsync_get_own_board_content',
        'brownsync_get_board_moderation_queue',
        'brownsync_list_board_moderators'
      )
      and p.pronargdefaults <> 1
  ) then
    raise exception 'board page limit defaults drifted';
  end if;

  if pg_catalog.pg_get_function_arguments(
       'public.brownsync_create_board_comment(uuid,text,integer,uuid,uuid,uuid,text)'::regprocedure
     ) <> 'p_actor uuid, p_author_token text, p_token_version integer, p_client_request_id uuid, p_post_id uuid, p_parent_comment_id uuid, p_body text' then
    raise exception 'create-comment argument names/order drifted';
  end if;
end
$$;

-- Every operation-specific quota mutex must be acquired before its first
-- content target. Consumption occurs later, after replay/no-op resolution.
do $$
declare
  v_signature text;
  v_bucket text;
  v_target text;
  v_definition text;
begin
  for v_signature, v_bucket, v_target in
    select *
    from (
      values
        ('brownsync_create_board_post(uuid,text,integer,uuid,text,text)', '''post_day''', 'from public.board_posts'),
        ('brownsync_edit_board_post(uuid,text,integer,uuid,bigint,jsonb)', '''edit_hour''', 'from public.board_posts'),
        ('brownsync_delete_board_post(uuid,text,integer,uuid,bigint)', '''edit_hour''', 'from public.board_posts'),
        ('brownsync_create_board_comment(uuid,text,integer,uuid,uuid,uuid,text)', '''comment_hour''', 'from public.board_comments'),
        ('brownsync_edit_board_comment(uuid,text,integer,uuid,bigint,text)', '''edit_hour''', 'from public.board_comments'),
        ('brownsync_delete_board_comment(uuid,text,integer,uuid,bigint)', '''edit_hour''', 'from public.board_comments'),
        ('brownsync_set_board_vote(uuid,text,integer,uuid,uuid,integer)', '''vote_10minute''', 'from public.board_posts'),
        ('brownsync_report_board_content(uuid,text,integer,uuid,uuid,text,text)', '''report_day''', 'from public.board_posts'),
        ('brownsync_create_board_appeal(uuid,text,integer,uuid,uuid,uuid,uuid,bigint,text)', '''appeal_day''', 'from public.board_appeals')
    ) as expected(signature, bucket_literal, first_target)
  loop
    select pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure('public.' || v_signature)
    ) into v_definition;
    if pg_catalog.strpos(v_definition, 'brownsync_lock_board_limit') = 0
       or pg_catalog.strpos(v_definition, v_bucket) = 0
       or pg_catalog.strpos(v_definition, v_target) = 0
       or pg_catalog.strpos(v_definition, v_bucket)
            > pg_catalog.strpos(v_definition, v_target) then
      raise exception 'board lock order drifted for %', v_signature;
    end if;
  end loop;
end
$$;

-- All 11 state tables are born behind RLS. No client role can read raw
-- tokens or mutate state, and every public/internal board routine is hardened.
do $$
declare
  v_name text;
  v_proc regprocedure;
begin
  foreach v_name in array array[
    'board_control',
    'board_moderators',
    'board_posts',
    'board_comments',
    'board_votes',
    'board_reports',
    'board_bans',
    'board_appeals',
    'board_moderation_actions',
    'board_rate_limits',
    'board_account_deletion_fences'
  ] loop
    if not coalesce((
      select c.relrowsecurity
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_name
        and c.relkind = 'r'
    ), false) then
      raise exception 'RLS disabled on %', v_name;
    end if;

    if pg_catalog.has_table_privilege(
      'anon',
      'public.' || v_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'authenticated',
      'public.' || v_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) then
      raise exception 'client table privilege leaked on %', v_name;
    end if;
  end loop;

  for v_proc in
    select p.oid::regprocedure
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'brownsync%board%'
        or p.proname = 'brownsync_delete_board_account'
      )
  loop
    if not (
      select p.prosecdef
        and exists (
          select 1
          from pg_catalog.unnest(
            coalesce(p.proconfig, '{}'::text[])
          ) as setting(value)
          where setting.value ~ '^search_path=(""|)$'
        )
      from pg_catalog.pg_proc as p
      where p.oid = v_proc
    ) then
      raise exception 'board routine is not hardened: %', v_proc;
    end if;

    if pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
       or pg_catalog.has_function_privilege(
         'authenticated',
         v_proc,
         'EXECUTE'
       ) then
      raise exception 'client execute leaked on %', v_proc;
    end if;
  end loop;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname like 'board_%'
  ) <> 11 then
    raise exception 'board table allocation drifted';
  end if;

  if exists (
    select 1
    from information_schema.columns as c
    where c.table_schema = 'public'
      and c.table_name in (
        'board_posts',
        'board_comments',
        'board_votes',
        'board_reports',
        'board_rate_limits',
        'board_account_deletion_fences'
      )
      and c.column_name in (
        'user_id',
        'actor_id',
        'actor_user_id',
        'profile_id',
        'email',
        'ip',
        'ip_address',
        'device_id',
        'jwt',
        'claims',
        'pepper'
      )
  ) then
    raise exception 'identifying column leaked into anonymous board state';
  end if;
end
$$;

do $$
declare
  v_control public.board_control%rowtype;
begin
  select c.* into v_control
  from public.board_control as c
  where c.id = true;
  if v_control.enabled
     or v_control.auto_hide_threshold <> 3
     or (
       select pg_catalog.count(*)
       from public.board_control
     ) <> 1 then
    raise exception 'board control did not default fail-closed: %', v_control;
  end if;
end
$$;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  (
    'a0000000-0000-4000-8000-000000000001',
    'board.owner@brown.edu',
    '{"full_name":"Board Owner"}',
    '{"provider":"google"}'
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'board.moderator@brown.edu',
    '{"full_name":"Board Moderator"}',
    '{"providers":["google"]}'
  ),
  (
    'a0000000-0000-4000-8000-000000000003',
    'board.alice@brown.edu',
    '{"full_name":"Board Alice"}',
    '{"provider":"google"}'
  ),
  (
    'a0000000-0000-4000-8000-000000000004',
    'board.bob@brown.edu',
    '{"full_name":"Board Bob"}',
    '{"provider":"google"}'
  ),
  (
    'a0000000-0000-4000-8000-000000000005',
    'board.carol@brown.edu',
    '{"full_name":"Board Carol"}',
    '{"provider":"google"}'
  ),
  (
    'a0000000-0000-4000-8000-000000000006',
    'board.dave@brown.edu',
    '{"full_name":"Board Dave"}',
    '{"provider":"google"}'
  ),
  (
    'a0000000-0000-4000-8000-000000000007',
    'board.delete@brown.edu',
    '{"full_name":"Board Delete"}',
    '{"provider":"google"}'
  );

insert into public.board_moderators (user_id, role)
values
  ('a0000000-0000-4000-8000-000000000001', 'owner');

-- Disabled-by-default blocks ordinary board operations, while only an owner
-- can enable the operational control.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    perform * from public.brownsync_create_board_post(
      'a0000000-0000-4000-8000-000000000003',
      pg_catalog.repeat('a', 64),
      1,
      'a1000000-0000-4000-8000-000000000001',
      'Disabled',
      'Disabled board write'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_DISABLED';
  end;
  if not v_blocked then
    raise exception 'disabled board accepted an ordinary write';
  end if;

  v_blocked := false;
  begin
    perform * from public.brownsync_set_board_config(
      'a0000000-0000-4000-8000-000000000003',
      true,
      3
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_FORBIDDEN';
  end;
  if not v_blocked then
    raise exception 'non-owner changed board config';
  end if;

  v_blocked := false;
  begin
    perform * from public.brownsync_add_board_moderator(
      'a0000000-0000-4000-8000-000000000003',
      'a0000000-0000-4000-8000-000000000099',
      'owner'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_FORBIDDEN';
  end;
  if not v_blocked then
    raise exception 'non-owner probed invalid moderator target admission';
  end if;

  perform * from public.brownsync_set_board_config(
    'a0000000-0000-4000-8000-000000000001',
    true,
    3
  );
  perform * from public.brownsync_add_board_moderator(
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002',
    'moderator'
  );
end
$$;

-- Executable member/moderator/account semantics. Distinct UUID slots below
-- deliberately make the create-comment request/post seam observable.
do $$
declare
  v_owner constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_mod constant uuid := 'a0000000-0000-4000-8000-000000000002';
  v_alice constant uuid := 'a0000000-0000-4000-8000-000000000003';
  v_bob constant uuid := 'a0000000-0000-4000-8000-000000000004';
  v_carol constant uuid := 'a0000000-0000-4000-8000-000000000005';
  v_dave constant uuid := 'a0000000-0000-4000-8000-000000000006';
  v_delete constant uuid := 'a0000000-0000-4000-8000-000000000007';
  v_at constant text := pg_catalog.repeat('a', 64);
  v_bt constant text := pg_catalog.repeat('b', 64);
  v_ct constant text := pg_catalog.repeat('c', 64);
  v_dt constant text := pg_catalog.repeat('d', 64);
  v_et constant text := pg_catalog.repeat('e', 64);
  v_post uuid;
  v_post2 uuid;
  v_post3 uuid;
  v_delete_post uuid;
  v_comment uuid;
  v_comment2 uuid;
  v_delete_comment uuid;
  v_appeal uuid;
  v_ban uuid;
  v_revision bigint;
  v_epoch bigint;
  v_before integer;
  v_blocked boolean;
  v_row record;
begin
  -- Post normalization, immutable create replay, strict optimistic revisions,
  -- and no quota charge for exact replay/no-op/rejection.
  select x.post_id, x.revision
  into v_post, v_revision
  from public.brownsync_create_board_post(
    v_alice, v_at, 1,
    'a1000000-0000-4000-8000-000000000010',
    '  First post  ', '  First body  '
  ) as x;
  if v_revision <> 1
     or (select p.title <> 'First post' or p.body <> 'First body'
         from public.board_posts as p where p.id = v_post) then
    raise exception 'post normalization/create result drifted';
  end if;

  select * into v_row
  from public.brownsync_create_board_post(
    v_alice, v_at, 1,
    'a1000000-0000-4000-8000-000000000010',
    'First post', 'First body'
  );
  if not v_row.replayed or v_row.post_id <> v_post or v_row.revision <> 1 then
    raise exception 'exact post replay drifted';
  end if;

  select * into v_row
  from public.brownsync_edit_board_post(
    v_alice, v_at, 1, v_post, 1,
    '{"body":"Edited body"}'::jsonb
  );
  if not v_row.changed or v_row.revision <> 2 then
    raise exception 'post edit drifted';
  end if;

  select * into v_row
  from public.brownsync_create_board_post(
    v_alice, v_at, 1,
    'a1000000-0000-4000-8000-000000000010',
    'First post', 'First body'
  );
  if not v_row.replayed or v_row.revision <> 1 then
    raise exception 'create replay did not preserve original revision';
  end if;

  v_blocked := false;
  begin
    perform * from public.brownsync_edit_board_post(
      v_alice, v_at, 1, v_post, 1,
      '{"body":"Edited body"}'::jsonb
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_REVISION_CONFLICT';
  end;
  if not v_blocked then
    raise exception 'stale post no-op bypassed expectedRevision';
  end if;

  if (select l.count from public.board_rate_limits as l
      where l.author_token = v_at and l.bucket = 'post_hour') <> 1
     or (select l.count from public.board_rate_limits as l
         where l.author_token = v_at and l.bucket = 'post_day') <> 1
     or (select l.count from public.board_rate_limits as l
         where l.author_token = v_at and l.bucket = 'edit_hour') <> 1 then
    raise exception 'post replay/no-op consumed durable quota';
  end if;

  -- Distinct request/post UUIDs prove the frozen create-comment argument seam.
  select x.comment_id, x.post_id
  into v_comment, v_post2
  from public.brownsync_create_board_comment(
    v_bob, v_bt, 1,
    'b1000000-0000-4000-8000-000000000011',
    v_post, null, '  First comment  '
  ) as x;
  if v_post2 <> v_post
     or not exists (
       select 1
       from public.board_comments as c
       where c.id = v_comment
         and c.client_request_id =
           'b1000000-0000-4000-8000-000000000011'
         and c.post_id = v_post
         and c.body = 'First comment'
     ) then
    raise exception 'create-comment UUID slots drifted';
  end if;

  select * into v_row
  from public.brownsync_edit_board_comment(
    v_bob, v_bt, 1, v_comment, 1, 'Edited comment'
  );
  if not v_row.changed or v_row.revision <> 2 then
    raise exception 'comment edit drifted';
  end if;
  select * into v_row
  from public.brownsync_create_board_comment(
    v_bob, v_bt, 1,
    'b1000000-0000-4000-8000-000000000011',
    v_post, null, 'First comment'
  );
  if not v_row.replayed or v_row.revision <> 1 then
    raise exception 'comment create replay drifted after edit';
  end if;
  v_blocked := false;
  begin
    perform * from public.brownsync_edit_board_comment(
      v_bob, v_bt, 1, v_comment, 1, 'Edited comment'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_REVISION_CONFLICT';
  end;
  if not v_blocked then
    raise exception 'stale comment no-op bypassed expectedRevision';
  end if;

  select x.comment_id into v_comment2
  from public.brownsync_create_board_comment(
    v_carol, v_ct, 1,
    'c1000000-0000-4000-8000-000000000012',
    v_post, v_comment, 'One-level reply'
  ) as x;
  v_blocked := false;
  begin
    perform * from public.brownsync_create_board_comment(
      v_dave, v_dt, 1,
      'd1000000-0000-4000-8000-000000000013',
      v_post, v_comment2, 'Forbidden grandchild'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_INPUT_INVALID';
  end;
  if not v_blocked then
    raise exception 'grandchild comment accepted';
  end if;

  if not exists (
    select 1
    from public.brownsync_get_board_feed(
      v_alice, v_at, 1, null, null, 25
    ) as f
    where f.post_id = v_post
      and f.author_alias = 'Anonymous Otter AAAA'
      and f.is_mine
  ) then
    raise exception 'feed alias/isMine drifted';
  end if;

  -- Vote transitions are exact and no-op changes are quota-free.
  select * into v_row
  from public.brownsync_set_board_vote(
    v_bob, v_bt, 1, v_post, null, 1
  );
  if not v_row.changed or v_row.score <> 1 then
    raise exception 'initial vote drifted';
  end if;
  select l.count into v_before
  from public.board_rate_limits as l
  where l.author_token = v_bt and l.bucket = 'vote_10minute';
  select * into v_row
  from public.brownsync_set_board_vote(
    v_bob, v_bt, 1, v_post, null, 1
  );
  if v_row.changed
     or (select l.count from public.board_rate_limits as l
         where l.author_token = v_bt
           and l.bucket = 'vote_10minute') <> v_before then
    raise exception 'vote no-op consumed quota';
  end if;
  perform * from public.brownsync_set_board_vote(
    v_bob, v_bt, 1, v_post, null, -1
  );
  select * into v_row
  from public.brownsync_set_board_vote(
    v_bob, v_bt, 1, v_post, null, 0
  );
  if v_row.score <> 0
     or exists (select 1 from public.board_votes where post_id = v_post) then
    raise exception 'vote convergence drifted';
  end if;

  -- Three distinct reporters cross the threshold once. Exact retries return
  -- their immutable result snapshots even after the target is hidden.
  perform * from public.brownsync_report_board_content(
    v_bob, v_bt, 1, v_post, null, 'spam', null
  );
  perform * from public.brownsync_report_board_content(
    v_carol, v_ct, 1, v_post, null, 'hate', 'detail'
  );
  select * into v_row
  from public.brownsync_report_board_content(
    v_dave, v_dt, 1, v_post, null, 'threat', null
  );
  if not v_row.auto_hidden or v_row.visibility <> 'auto_hidden'
     or (select p.visibility from public.board_posts p
         where p.id = v_post) <> 'auto_hidden'
     or (select pg_catalog.count(*) from public.board_moderation_actions a
         where a.target_id = v_post and a.action = 'auto_hide') <> 1 then
    raise exception 'report threshold transition drifted';
  end if;
  select * into v_row
  from public.brownsync_report_board_content(
    v_dave, v_dt, 1, v_post, null, 'threat', null
  );
  if not v_row.replayed or not v_row.auto_hidden then
    raise exception 'threshold report snapshot replay drifted';
  end if;

  -- Content appeal belongs only to the target token; approval restores and
  -- increments the moderation epoch.
  select x.appeal_id into v_appeal
  from public.brownsync_create_board_appeal(
    v_alice, v_at, 1,
    'a2000000-0000-4000-8000-000000000020',
    v_post, null, null, 0, 'Please restore'
  ) as x;
  if not exists (
    select 1
    from public.brownsync_get_board_moderation_queue(
      v_mod, null, null, 25
    ) q
    where q.queue_id = v_appeal and q.appeal_body = 'Please restore'
  ) then
    raise exception 'content appeal missing from moderation queue';
  end if;
  perform * from public.brownsync_decide_board_appeal(
    v_mod,
    'f1000000-0000-4000-8000-000000000020',
    v_appeal, 'approved', 'Accepted'
  );
  if (select p.visibility <> 'visible' or p.moderation_epoch <> 1
      from public.board_posts p where p.id = v_post) then
    raise exception 'appeal approval did not restore/increment epoch';
  end if;
  select * into v_row
  from public.brownsync_create_board_appeal(
    v_alice, v_at, 1,
    'a2000000-0000-4000-8000-000000000020',
    v_post, null, null, 0, 'Please restore'
  );
  if not v_row.replayed or v_row.state <> 'pending' then
    raise exception 'decided appeal create replay did not preserve pending';
  end if;
  perform * from public.brownsync_report_board_content(
    v_bob, v_bt, 1, v_post, null, 'spam', 'new epoch'
  );
  if (select pg_catalog.count(*) from public.board_reports r
      where r.post_id = v_post and r.target_epoch = 1 and r.state = 'open') <> 1
     or (select p.visibility from public.board_posts p
         where p.id = v_post) <> 'visible' then
    raise exception 'restored epoch inherited stale reports';
  end if;

  -- Ban/status/appeal/revoke path, including banned-write denial.
  select x.ban_id into v_ban
  from public.brownsync_create_board_ban(
    v_mod,
    'f2000000-0000-4000-8000-000000000021',
    v_post, null, 300, 'Cooling off', null
  ) as x;
  if not (select s.banned from public.brownsync_get_board_status(
    v_alice, v_at, 1
  ) s) then
    raise exception 'active ban missing from member status';
  end if;
  v_blocked := false;
  begin
    perform * from public.brownsync_create_board_post(
      v_alice, v_at, 1,
      'a1000000-0000-4000-8000-000000000022',
      null, 'Banned write'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_BANNED';
  end;
  if not v_blocked then
    raise exception 'banned member created content';
  end if;
  select x.appeal_id into v_appeal
  from public.brownsync_create_board_appeal(
    v_alice, v_at, 1,
    'a2000000-0000-4000-8000-000000000023',
    null, null, v_ban, null, 'Ban appeal'
  ) as x;
  if not exists (
    select 1
    from public.brownsync_get_board_moderation_queue(
      v_mod, null, null, 25
    ) q
    where q.queue_id = v_appeal
      and q.target_type = 'ban'
      and q.post_id is null
      and q.title is null
      and q.body is null
      and q.report_reasons = array[]::text[]
      and q.appeal_body = 'Ban appeal'
  ) then
    raise exception 'ban appeal queue projection drifted';
  end if;
  perform * from public.brownsync_decide_board_appeal(
    v_mod,
    'f1000000-0000-4000-8000-000000000024',
    v_appeal, 'approved', 'Lifted'
  );
  if (select s.banned from public.brownsync_get_board_status(
    v_alice, v_at, 1
  ) s) then
    raise exception 'approved ban appeal did not revoke ban';
  end if;
  delete from public.board_bans where id = v_ban;
  v_blocked := false;
  begin
    perform * from public.brownsync_decide_board_appeal(
      v_mod,
      'f1000000-0000-4000-8000-000000000024',
      v_appeal, 'approved', 'Lifted'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_NOT_FOUND';
  end;
  if not v_blocked then
    raise exception 'deleted appeal replay returned a malformed result';
  end if;

  -- Parent terminality closes child reports and makes comments disappear from
  -- both member reads and the moderation queue.
  select x.post_id into v_post2
  from public.brownsync_create_board_post(
    v_alice, v_at, 1,
    'a1000000-0000-4000-8000-000000000025',
    null, 'Parent terminality'
  ) as x;
  select x.comment_id into v_comment2
  from public.brownsync_create_board_comment(
    v_bob, v_bt, 1,
    'b1000000-0000-4000-8000-000000000026',
    v_post2, null, 'Child report target'
  ) as x;
  perform * from public.brownsync_report_board_content(
    v_carol, v_ct, 1, null, v_comment2, 'spam', null
  );
  perform * from public.brownsync_delete_board_post(
    v_alice, v_at, 1, v_post2, 1
  );
  if exists (
       select 1 from public.board_reports r
       where r.comment_id = v_comment2 and r.state = 'open'
     )
     or exists (
       select 1 from public.brownsync_get_board_moderation_queue(
         v_mod, null, null, 25
       ) q where q.target_id = v_comment2
     ) then
    raise exception 'terminal parent exposed child state';
  end if;
  v_blocked := false;
  begin
    perform * from public.brownsync_get_board_thread(
      v_bob, v_bt, 1, v_post2, null, null, 25
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_NOT_FOUND';
  end;
  if not v_blocked then
    raise exception 'terminal parent remained readable as a thread';
  end if;

  -- Moderator removal has the same fail-closed child handling, and a comment
  -- appeal cannot become stranded behind a terminal parent.
  select x.post_id into v_post2
  from public.brownsync_create_board_post(
    v_alice, v_at, 1,
    'a1000000-0000-4000-8000-000000000035',
    null, 'Moderator parent removal'
  ) as x;
  select x.comment_id into v_comment2
  from public.brownsync_create_board_comment(
    v_bob, v_bt, 1,
    'b1000000-0000-4000-8000-000000000035',
    v_post2, null, 'Moderator child target'
  ) as x;
  perform * from public.brownsync_report_board_content(
    v_carol, v_ct, 1, null, v_comment2, 'spam', 'remove parent'
  );
  perform * from public.brownsync_decide_board_content(
    v_mod,
    'f3000000-0000-4000-8000-000000000035',
    v_post2, null, 0, 'remove', 'Terminal parent'
  );
  if not exists (
       select 1 from public.board_reports r
       where r.comment_id = v_comment2 and r.state = 'upheld'
     )
     or exists (
       select 1 from public.brownsync_get_board_moderation_queue(
         v_mod, null, null, 25
       ) q where q.target_id = v_comment2
     ) then
    raise exception 'moderator parent removal stranded a child report';
  end if;
  select pg_catalog.count(*)::integer into v_before
  from public.board_appeals;
  v_blocked := false;
  begin
    perform * from public.brownsync_create_board_appeal(
      v_bob, v_bt, 1,
      'b2000000-0000-4000-8000-000000000035',
      null, v_comment2, null, 0, 'Invisible appeal'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_NOT_FOUND';
  end;
  if not v_blocked
     or (select pg_catalog.count(*) from public.board_appeals) <> v_before then
    raise exception 'terminal-parent comment appeal was stranded';
  end if;

  -- Every transition that makes an appeal non-actionable removes the pending
  -- body under the same target lock.
  perform * from public.brownsync_decide_board_content(
    v_mod,
    'f3000000-0000-4000-8000-000000000040',
    null, v_comment, 0, 'hide', 'Hide before author delete'
  );
  select x.appeal_id into v_appeal
  from public.brownsync_create_board_appeal(
    v_bob, v_bt, 1,
    'b2000000-0000-4000-8000-000000000040',
    null, v_comment, null, 0, 'Delete this appeal'
  ) x;
  perform * from public.brownsync_delete_board_comment(
    v_bob, v_bt, 1, v_comment, 3
  );
  if exists (
    select 1
    from public.board_reports as r
    where r.comment_id = v_comment
      and r.state = 'open'
  ) then
    raise exception 'author-deleted comment retained open report';
  end if;
  if exists (select 1 from public.board_appeals where id = v_appeal) then
    raise exception 'author-deleted comment retained pending appeal';
  end if;

  select x.comment_id into v_comment2
  from public.brownsync_create_board_comment(
    v_carol, v_ct, 1,
    'c1000000-0000-4000-8000-000000000041',
    v_post, null, 'Moderator remove appeal target'
  ) x;
  perform * from public.brownsync_decide_board_content(
    v_mod,
    'f3000000-0000-4000-8000-000000000041',
    null, v_comment2, 0, 'hide', 'Hide before remove'
  );
  select x.appeal_id into v_appeal
  from public.brownsync_create_board_appeal(
    v_carol, v_ct, 1,
    'c2000000-0000-4000-8000-000000000041',
    null, v_comment2, null, 0, 'Remove this appeal'
  ) x;
  perform * from public.brownsync_decide_board_content(
    v_mod,
    'f3000000-0000-4000-8000-000000000042',
    null, v_comment2, 0, 'remove', 'Terminal comment'
  );
  if exists (select 1 from public.board_appeals where id = v_appeal) then
    raise exception 'moderator-removed comment retained pending appeal';
  end if;

  select x.post_id into v_post2
  from public.brownsync_create_board_post(
    v_alice, v_at, 1,
    'a1000000-0000-4000-8000-000000000043',
    null, 'Restore cleanup target'
  ) x;
  perform * from public.brownsync_decide_board_content(
    v_mod,
    'f3000000-0000-4000-8000-000000000043',
    v_post2, null, 0, 'hide', 'Hide for direct restore'
  );
  select x.appeal_id into v_appeal
  from public.brownsync_create_board_appeal(
    v_alice, v_at, 1,
    'a2000000-0000-4000-8000-000000000043',
    v_post2, null, null, 0, 'Stale after restore'
  ) x;
  perform * from public.brownsync_decide_board_content(
    v_mod,
    'f3000000-0000-4000-8000-000000000044',
    v_post2, null, 0, 'restore', 'Direct restore'
  );
  if exists (select 1 from public.board_appeals where id = v_appeal) then
    raise exception 'restored content retained stale pending appeal';
  end if;

  select x.comment_id into v_comment2
  from public.brownsync_create_board_comment(
    v_bob, v_bt, 1,
    'b1000000-0000-4000-8000-000000000045',
    v_post, null, 'Ban revoke appeal target'
  ) x;
  select x.ban_id into v_ban
  from public.brownsync_create_board_ban(
    v_mod,
    'f2000000-0000-4000-8000-000000000045',
    null, v_comment2, 300, 'Revoke appeal cleanup', null
  ) x;
  select x.appeal_id into v_appeal
  from public.brownsync_create_board_appeal(
    v_bob, v_bt, 1,
    'b2000000-0000-4000-8000-000000000045',
    null, null, v_ban, null, 'Stale after revoke'
  ) x;
  perform * from public.brownsync_revoke_board_ban(
    v_mod,
    'f2000000-0000-4000-8000-000000000046',
    v_ban, 'Manual revoke'
  );
  if exists (select 1 from public.board_appeals where id = v_appeal) then
    raise exception 'revoked ban retained pending appeal';
  end if;

  -- Sole-owner demotion must fail closed.
  v_blocked := false;
  begin
    perform * from public.brownsync_add_board_moderator(
      v_owner, v_owner, 'moderator'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
  end;
  if not v_blocked then
    raise exception 'sole owner demotion was accepted';
  end if;

  -- Durable vote boundary: the 120th real mutation succeeds, the 121st rolls
  -- back without incrementing. Replays/no-ops above remained free.
  select x.post_id into v_post3
  from public.brownsync_create_board_post(
    v_alice, v_at, 1,
    'a1000000-0000-4000-8000-000000000027',
    null, 'Quota target'
  ) as x;
  insert into public.board_rate_limits (
    author_token, token_version, bucket, count
  ) values (v_dt, 1, 'vote_10minute', 119)
  on conflict (author_token, bucket) do update
  set window_started_at =
        pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),
      count = 119,
      updated_at =
        pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  perform * from public.brownsync_set_board_vote(
    v_dave, v_dt, 1, v_post3, null, 1
  );
  v_blocked := false;
  begin
    perform * from public.brownsync_set_board_vote(
      v_dave, v_dt, 1, v_post, null, 1
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_RATE_LIMITED';
  end;
  if not v_blocked
     or (select l.count from public.board_rate_limits l
         where l.author_token = v_dt
           and l.bucket = 'vote_10minute') <> 120 then
    raise exception 'durable vote boundary drifted';
  end if;

  -- Account cleanup creates one durable old-token fence, tombstones with
  -- pairwise-unlinkable valid tokens, deletes old-token dependencies, and can
  -- replay after Auth/Profile deletion.
  select x.post_id into v_delete_post
  from public.brownsync_create_board_post(
    v_delete, v_et, 1,
    'e1000000-0000-4000-8000-000000000030',
    'Delete me', 'Delete account post'
  ) as x;
  select x.comment_id into v_delete_comment
  from public.brownsync_create_board_comment(
    v_delete, v_et, 1,
    'e1000000-0000-4000-8000-000000000031',
    v_post, null, 'Delete account comment'
  ) as x;
  perform * from public.brownsync_set_board_vote(
    v_delete, v_et, 1, v_post3, null, 1
  );
  perform * from public.brownsync_report_board_content(
    v_delete, v_et, 1, v_post3, null, 'other', 'cleanup'
  );
  select * into v_row
  from public.brownsync_delete_board_account(v_delete, v_et);
  if v_row.posts_tombstoned <> 1
     or v_row.comments_tombstoned <> 1
     or v_row.replayed
     or (select pg_catalog.count(*) from public.board_account_deletion_fences f
         where f.author_token = v_et and f.token_version = 1) <> 1
     or exists (select 1 from public.board_posts p
                where p.author_token = v_et)
     or exists (select 1 from public.board_comments c
                where c.author_token = v_et)
     or exists (select 1 from public.board_votes v
                where v.author_token = v_et)
     or exists (select 1 from public.board_reports r
                where r.reporter_token = v_et)
     or exists (select 1 from public.board_rate_limits l
                where l.author_token = v_et)
     or (select p.visibility <> 'account_deleted'
                or p.title is not null or p.body is not null
                or p.create_fingerprint is not null
                or p.author_token !~ '^[0-9a-f]{64}$'
         from public.board_posts p where p.id = v_delete_post)
     or (select c.visibility <> 'account_deleted'
                or c.body is not null
                or c.create_fingerprint is not null
                or c.author_token !~ '^[0-9a-f]{64}$'
                or c.author_token = (
                  select p.author_token from public.board_posts p
                  where p.id = v_delete_post
                )
         from public.board_comments c where c.id = v_delete_comment) then
    raise exception 'account cleanup invariant drifted';
  end if;
  v_blocked := false;
  begin
    perform * from public.brownsync_create_board_post(
      v_delete, v_et, 1,
      'e1000000-0000-4000-8000-000000000032',
      null, 'Late fenced write'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_ACCOUNT_DELETED';
  end;
  if not v_blocked then
    raise exception 'deletion fence accepted a late write';
  end if;
  delete from auth.users where id = v_delete;
  select * into v_row
  from public.brownsync_delete_board_account(v_delete, v_et);
  if not v_row.replayed
     or v_row.posts_tombstoned <> 0
     or v_row.comments_tombstoned <> 0 then
    raise exception 'cleanup retry failed after Auth deletion';
  end if;

  -- All persisted cursor components must round-trip exactly through JS Date.
  if exists (
    select 1
    from (
      select created_at as ts from public.board_posts
      union all select updated_at from public.board_posts
      union all select created_at from public.board_comments
      union all select updated_at from public.board_comments
      union all select updated_at from public.board_reports
      union all select updated_at from public.board_appeals
      union all select granted_at from public.board_moderators
    ) as cursor_values
    where extract(microseconds from ts)::bigint % 1000 <> 0
  ) then
    raise exception 'board cursor timestamp exceeded millisecond precision';
  end if;

  -- Identifiable moderator attribution survives profile deletion without
  -- retaining an invalid FK or deleting audit history.
  perform * from public.brownsync_add_board_moderator(
    v_owner, v_dave, 'moderator'
  );
  perform * from public.brownsync_decide_board_content(
    v_dave,
    'f3000000-0000-4000-8000-000000000033',
    v_post3, null, 0, 'hide', 'Review proof'
  );
  delete from auth.users where id = v_dave;
  if not exists (
    select 1 from public.board_moderation_actions a
    where a.client_request_id =
      'f3000000-0000-4000-8000-000000000033'
      and a.moderator_user_id is null
  ) then
    raise exception 'moderation audit did not survive profile deletion';
  end if;

  -- Kill switch blocks ordinary reads/writes but status, deletions and cleanup
  -- remain available.
  perform * from public.brownsync_set_board_config(v_owner, false, 3);
  v_blocked := false;
  begin
    perform * from public.brownsync_get_board_feed(
      v_bob, v_bt, 1, null, null, 25
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_DISABLED';
  end;
  if not v_blocked then
    raise exception 'kill switch allowed board feed';
  end if;
  perform * from public.brownsync_get_board_status(v_bob, v_bt, 1);
end
$$;

-- Same-millisecond keyset pagination must advance by the UUID tie-breaker on
-- every SQL cursor exposed to the Worker.
do $$
declare
  v_owner constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_mod constant uuid := 'a0000000-0000-4000-8000-000000000002';
  v_alice constant uuid := 'a0000000-0000-4000-8000-000000000003';
  v_bob constant uuid := 'a0000000-0000-4000-8000-000000000004';
  v_at constant text := pg_catalog.repeat('a', 64);
  v_bt constant text := pg_catalog.repeat('b', 64);
  v_ct constant text := pg_catalog.repeat('c', 64);
  v_dt constant text := pg_catalog.repeat('d', 64);
  v_ts constant timestamptz := '2099-01-02 03:04:05.123+00';
  v_now_ms timestamptz :=
    pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_first record;
  v_second record;
begin
  perform * from public.brownsync_set_board_config(v_owner, true, 3);

  insert into public.board_bans (
    id, author_token, token_version, starts_at, expires_at, reason,
    created_by, client_request_id
  ) values (
    'dd000000-0000-4000-8000-000000000100',
    v_bt, 1,
    '2020-01-01 00:00:00+00',
    '2020-01-01 00:05:00+00',
    'Expired fixture', v_owner,
    'dd100000-0000-4000-8000-000000000100'
  );
  insert into public.board_appeals (
    id, author_token, token_version, client_request_id, ban_id, body
  ) values (
    'dd200000-0000-4000-8000-000000000100',
    v_bt, 1,
    'dd300000-0000-4000-8000-000000000100',
    'dd000000-0000-4000-8000-000000000100',
    'Expired ban appeal'
  );
  if (select s.pending_appeals <> 0
      from public.brownsync_get_board_status(v_bob, v_bt, 1) s)
     or exists (
       select 1
       from public.brownsync_get_board_moderation_queue(
         v_mod, null, null, 25
       ) q
       where q.queue_id =
         'dd200000-0000-4000-8000-000000000100'
     ) then
    raise exception 'expired ban appeal remained actionable';
  end if;

  insert into public.board_posts (
    id, author_token, token_version, client_request_id, create_fingerprint,
    title, body, created_at, updated_at
  ) values
    (
      'aa000000-0000-4000-8000-000000000101',
      v_at, 1, 'aa100000-0000-4000-8000-000000000101',
      pg_catalog.repeat('1', 64), 'Cursor one', 'Cursor one', v_ts, v_ts
    ),
    (
      'aa000000-0000-4000-8000-000000000102',
      v_at, 1, 'aa100000-0000-4000-8000-000000000102',
      pg_catalog.repeat('2', 64), 'Cursor two', 'Cursor two', v_ts, v_ts
    );

  insert into public.board_comments (
    id, post_id, author_token, token_version, client_request_id,
    create_fingerprint, body, created_at, updated_at
  ) values
    (
      'bb000000-0000-4000-8000-000000000101',
      'aa000000-0000-4000-8000-000000000101',
      v_bt, 1, 'bb100000-0000-4000-8000-000000000101',
      pg_catalog.repeat('3', 64), 'Cursor comment one', v_ts, v_now_ms
    ),
    (
      'bb000000-0000-4000-8000-000000000102',
      'aa000000-0000-4000-8000-000000000101',
      v_ct, 1, 'bb100000-0000-4000-8000-000000000102',
      pg_catalog.repeat('4', 64), 'Cursor comment two', v_ts, v_now_ms
    );

  insert into public.board_reports (
    id, reporter_token, token_version, post_id, target_epoch, reason,
    result_visibility, result_revision, created_at, updated_at
  ) values
    (
      'cc000000-0000-4000-8000-000000000101',
      v_ct, 1, 'aa000000-0000-4000-8000-000000000101', 0, 'spam',
      'visible', 1, v_ts, v_ts
    ),
    (
      'cc000000-0000-4000-8000-000000000102',
      v_dt, 1, 'aa000000-0000-4000-8000-000000000102', 0, 'spam',
      'visible', 1, v_ts, v_ts
    );

  select * into v_first
  from public.brownsync_get_board_feed(
    v_bob, v_bt, 1, null, null, 1
  );
  select * into v_second
  from public.brownsync_get_board_feed(
    v_bob, v_bt, 1, v_first.created_at, v_first.post_id, 1
  );
  if v_first.post_id <>
       'aa000000-0000-4000-8000-000000000102'::uuid
     or v_second.post_id <>
       'aa000000-0000-4000-8000-000000000101'::uuid then
    raise exception 'same-millisecond feed cursor skipped/replayed a row';
  end if;

  select * into v_first
  from public.brownsync_get_board_thread(
    v_bob, v_bt, 1,
    'aa000000-0000-4000-8000-000000000101',
    null, null, 1
  );
  select * into v_second
  from public.brownsync_get_board_thread(
    v_bob, v_bt, 1,
    'aa000000-0000-4000-8000-000000000101',
    v_first.comment_created_at, v_first.comment_id, 1
  );
  if v_first.comment_id <>
       'bb000000-0000-4000-8000-000000000101'::uuid
     or v_second.comment_id <>
       'bb000000-0000-4000-8000-000000000102'::uuid then
    raise exception 'same-millisecond thread cursor skipped/replayed a row';
  end if;

  select * into v_first
  from public.brownsync_get_own_board_content(
    v_alice, v_at, 1, null, null, 1
  );
  select * into v_second
  from public.brownsync_get_own_board_content(
    v_alice, v_at, 1, v_first.updated_at, v_first.item_id, 1
  );
  if v_first.item_id <>
       'aa000000-0000-4000-8000-000000000102'::uuid
     or v_second.item_id <>
       'aa000000-0000-4000-8000-000000000101'::uuid then
    raise exception 'same-millisecond mine cursor skipped/replayed a row';
  end if;

  select * into v_first
  from public.brownsync_get_board_moderation_queue(
    v_mod, null, null, 1
  );
  select * into v_second
  from public.brownsync_get_board_moderation_queue(
    v_mod, v_first.updated_at, v_first.queue_id, 1
  );
  if v_first.queue_id <>
       'cc000000-0000-4000-8000-000000000102'::uuid
     or v_second.queue_id <>
       'cc000000-0000-4000-8000-000000000101'::uuid then
    raise exception 'same-millisecond moderation cursor skipped/replayed a row';
  end if;

  update public.board_moderators
  set granted_at = v_ts
  where user_id in (v_owner, v_mod);
  select * into v_first
  from public.brownsync_list_board_moderators(
    v_owner, null, null, 1
  );
  select * into v_second
  from public.brownsync_list_board_moderators(
    v_owner, v_first.granted_at, v_first.user_id, 1
  );
  if v_first.user_id <> v_mod or v_second.user_id <> v_owner then
    raise exception 'same-millisecond moderator cursor skipped/replayed a row';
  end if;
end
$$;

rollback;

\echo '0015_board_checks: all semantic checks passed'
