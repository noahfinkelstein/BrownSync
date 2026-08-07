\set ON_ERROR_STOP on

-- 0017_org_assets_checks.sql
-- Rollback-safe semantic checks for organization media and opt-in Instagram
-- cards. Every assertion exercises database behavior rather than source text.

begin;

do $$
declare
  v_name text;
begin
  foreach v_name in array array[
    'org_media_uploads',
    'org_media_assets',
    'org_media_collections',
    'org_media_cleanup_queue',
    'org_social_posts',
    'org_asset_mutation_limits',
    'org_oembed_control',
    'org_asset_edits'
  ] loop
    if pg_catalog.to_regclass('public.' || v_name) is null then
      raise exception
        'BROWNSYNC_ORG_ASSETS_MIGRATION_MISSING: table %', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'brownsync_get_org_media(text)',
    'brownsync_reserve_org_media_upload(uuid,text,uuid,uuid,text,text,bigint,bigint,text)',
    'brownsync_begin_org_media_upload(uuid,uuid)',
    'brownsync_finalize_org_media_upload(uuid,uuid,uuid,text,integer,integer,integer)',
    'brownsync_fail_org_media_upload(uuid,uuid,text,boolean)',
    'brownsync_delete_org_media(uuid,text,uuid,bigint)',
    'brownsync_reorder_org_gallery(uuid,text,bigint,uuid[])',
    'brownsync_claim_media_cleanup(uuid,integer)',
    'brownsync_complete_media_cleanup(uuid,uuid,uuid,boolean,text)',
    'brownsync_list_org_social_posts(text)',
    'brownsync_add_org_social_post(uuid,text,uuid,uuid,text)',
    'brownsync_begin_org_social_post_refresh(uuid,text,uuid)',
    'brownsync_finalize_org_social_post(uuid,uuid,uuid,text,text,text,text)',
    'brownsync_delete_org_social_post(uuid,text,uuid,bigint)',
    'brownsync_claim_due_instagram_posts(uuid,integer)',
    'brownsync_consume_oembed_capacity(uuid,uuid)',
    'brownsync_get_org_social_embed(uuid)'
  ] loop
    if pg_catalog.to_regprocedure('public.' || v_name) is null then
      raise exception
        'BROWNSYNC_ORG_ASSETS_MIGRATION_MISSING: routine %', v_name;
    end if;
  end loop;
end
$$;

-- Exact result contracts are the seam shared with the Worker adapter.
do $$
declare
  v_actual text;
begin
  select pg_catalog.pg_get_function_result(
    'public.brownsync_get_org_media(text)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(organization_id text, organization_revision bigint, gallery_revision bigint, media_id uuid, kind text, public_url text, width integer, height integer, byte_size integer, alt_text text, "position" integer, asset_revision bigint)' then
    raise exception 'media projection result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_reserve_org_media_upload(uuid,text,uuid,uuid,text,text,bigint,bigint,text)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(upload_id uuid, kind text, expires_at timestamp with time zone, replayed boolean)' then
    raise exception 'reserve result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_begin_org_media_upload(uuid,uuid)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(upload_id uuid, organization_id text, kind text, object_path text, alt_text text, expires_at timestamp with time zone)' then
    raise exception 'begin result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_finalize_org_media_upload(uuid,uuid,uuid,text,integer,integer,integer)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(media_id uuid, kind text, public_url text, width integer, height integer, byte_size integer, alt_text text, "position" integer, asset_revision bigint, organization_revision bigint, gallery_revision bigint, replayed boolean)' then
    raise exception 'media finalize result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_fail_org_media_upload(uuid,uuid,text,boolean)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(upload_id uuid, status text, changed boolean, cleanup_enqueued boolean)' then
    raise exception 'media fail result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_delete_org_media(uuid,text,uuid,bigint)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(media_id uuid, kind text, organization_revision bigint, gallery_revision bigint, changed boolean)' then
    raise exception 'media delete result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_reorder_org_gallery(uuid,text,bigint,uuid[])'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(gallery_revision bigint, changed boolean)' then
    raise exception 'gallery reorder result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_claim_media_cleanup(uuid,integer)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(cleanup_id uuid, object_path text, attempt_count integer, lease_token uuid, lease_expires_at timestamp with time zone)' then
    raise exception 'cleanup claim result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_complete_media_cleanup(uuid,uuid,uuid,boolean,text)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(cleanup_id uuid, disposition text, attempt_count integer, next_attempt_at timestamp with time zone, replayed boolean)' then
    raise exception 'cleanup complete result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_list_org_social_posts(text)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(organization_id text, post_id uuid, permalink text, status text, revision bigint, cache_expires_at timestamp with time zone, attribution text, embed_available boolean)' then
    raise exception 'social projection result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_add_org_social_post(uuid,text,uuid,uuid,text)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(post_id uuid, organization_id text, permalink text, status text, revision bigint, lease_token uuid, cache_expires_at timestamp with time zone, attribution text, replayed boolean, refresh_required boolean)' then
    raise exception 'social add result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_begin_org_social_post_refresh(uuid,text,uuid)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(post_id uuid, organization_id text, permalink text, status text, revision bigint, lease_token uuid, claimed boolean)' then
    raise exception 'social refresh result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_finalize_org_social_post(uuid,uuid,uuid,text,text,text,text)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(post_id uuid, organization_id text, permalink text, status text, revision bigint, cache_expires_at timestamp with time zone, attribution text, changed boolean, replayed boolean)' then
    raise exception 'social finalize result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_delete_org_social_post(uuid,text,uuid,bigint)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(post_id uuid, revision bigint, changed boolean)' then
    raise exception 'social delete result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_claim_due_instagram_posts(uuid,integer)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(post_id uuid, organization_id text, permalink text, revision bigint, lease_token uuid, lease_expires_at timestamp with time zone)' then
    raise exception 'scheduled claim result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_consume_oembed_capacity(uuid,uuid)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(allowed boolean, remaining integer, retry_after_seconds integer)' then
    raise exception 'capacity result drifted: %', v_actual;
  end if;

  select pg_catalog.pg_get_function_result(
    'public.brownsync_get_org_social_embed(uuid)'::regprocedure
  ) into v_actual;
  if v_actual <> 'TABLE(post_id uuid, permalink text, render_html text, revision bigint)' then
    raise exception 'embed result drifted: %', v_actual;
  end if;
end
$$;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('90000000-0000-4000-8000-000000000001', 'asset.owner@brown.edu', '{"full_name":"Asset Owner"}', '{"provider":"google"}'),
  ('90000000-0000-4000-8000-000000000002', 'asset.editor@brown.edu', '{"full_name":"Asset Editor"}', '{"providers":["google"]}'),
  ('90000000-0000-4000-8000-000000000003', 'asset.outsider@brown.edu', '{"full_name":"Asset Outsider"}', '{"provider":"google"}'),
  ('90000000-0000-4000-8000-000000000004', 'asset.delete@brown.edu', '{"full_name":"Asset Delete"}', '{"provider":"google"}');

insert into public.organizations (
  id, name, kind, description, source, contact_emails
) values
  ('chk-asset-alpha', 'Check Asset Alpha', 'club', 'Asset checks', 'check', '{}'),
  ('chk-asset-beta', 'Check Asset Beta', 'club', 'Continuation checks', 'check', '{}'),
  ('chk-asset-cap', 'Check Asset Cap', 'club', 'Gallery cap checks', 'check', '{}'),
  ('chk-asset-delete', 'Check Asset Delete', 'club', 'Deletion checks', 'check', '{}');

insert into public.org_admins (
  organization_id, user_id, role, grant_source
) values
  ('chk-asset-alpha', '90000000-0000-4000-8000-000000000001', 'owner', 'creator'),
  ('chk-asset-alpha', '90000000-0000-4000-8000-000000000002', 'editor', 'owner_grant'),
  ('chk-asset-beta', '90000000-0000-4000-8000-000000000001', 'owner', 'creator'),
  ('chk-asset-beta', '90000000-0000-4000-8000-000000000002', 'editor', 'owner_grant'),
  ('chk-asset-cap', '90000000-0000-4000-8000-000000000001', 'owner', 'creator'),
  ('chk-asset-delete', '90000000-0000-4000-8000-000000000004', 'owner', 'creator');

-- Every new table starts with RLS, and no client role can reach internal
-- state or any owner-side routine directly.
do $$
declare
  v_name text;
  v_proc regprocedure;
begin
  foreach v_name in array array[
    'org_media_uploads',
    'org_media_assets',
    'org_media_collections',
    'org_media_cleanup_queue',
    'org_social_posts',
    'org_asset_mutation_limits',
    'org_oembed_control',
    'org_asset_edits'
  ] loop
    if not coalesce((
      select c.relrowsecurity
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_name
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
      raise exception 'client privilege leaked on %', v_name;
    end if;
  end loop;

  for v_proc in
    select u.signature
    from pg_catalog.unnest(array[
      'public.brownsync_get_org_media(text)'::regprocedure,
      'public.brownsync_reserve_org_media_upload(uuid,text,uuid,uuid,text,text,bigint,bigint,text)'::regprocedure,
      'public.brownsync_begin_org_media_upload(uuid,uuid)'::regprocedure,
      'public.brownsync_finalize_org_media_upload(uuid,uuid,uuid,text,integer,integer,integer)'::regprocedure,
      'public.brownsync_fail_org_media_upload(uuid,uuid,text,boolean)'::regprocedure,
      'public.brownsync_delete_org_media(uuid,text,uuid,bigint)'::regprocedure,
      'public.brownsync_reorder_org_gallery(uuid,text,bigint,uuid[])'::regprocedure,
      'public.brownsync_claim_media_cleanup(uuid,integer)'::regprocedure,
      'public.brownsync_complete_media_cleanup(uuid,uuid,uuid,boolean,text)'::regprocedure,
      'public.brownsync_list_org_social_posts(text)'::regprocedure,
      'public.brownsync_add_org_social_post(uuid,text,uuid,uuid,text)'::regprocedure,
      'public.brownsync_begin_org_social_post_refresh(uuid,text,uuid)'::regprocedure,
      'public.brownsync_finalize_org_social_post(uuid,uuid,uuid,text,text,text,text)'::regprocedure,
      'public.brownsync_delete_org_social_post(uuid,text,uuid,bigint)'::regprocedure,
      'public.brownsync_claim_due_instagram_posts(uuid,integer)'::regprocedure,
      'public.brownsync_consume_oembed_capacity(uuid,uuid)'::regprocedure,
      'public.brownsync_get_org_social_embed(uuid)'::regprocedure
    ]) as u(signature)
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
      raise exception 'routine is not hardened: %', v_proc;
    end if;
    if pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
       or pg_catalog.has_function_privilege(
         'authenticated', v_proc, 'EXECUTE'
       ) then
      raise exception 'client execute leaked on %', v_proc;
    end if;
  end loop;
end
$$;

-- Empty media is represented by one sentinel row so an existing organization
-- is distinguishable from a missing one without exposing internal tables.
do $$
declare
  v_row record;
  v_blocked boolean;
begin
  select * into v_row
  from public.brownsync_get_org_media('chk-asset-alpha');
  if v_row.organization_id <> 'chk-asset-alpha'
     or v_row.organization_revision <> 0
     or v_row.gallery_revision <> 0
     or v_row.media_id is not null then
    raise exception 'empty media sentinel is wrong: %', v_row;
  end if;

  v_blocked := false;
  begin
    perform * from public.brownsync_get_org_media('missing-asset-org');
  exception when raise_exception then
    v_blocked := sqlerrm =
      'BROWNSYNC_ORG_ASSET_ORGANIZATION_NOT_FOUND';
  end;
  if not v_blocked then
    raise exception 'missing media organization was not concealed';
  end if;
end
$$;

-- Reservation validates authority, payload shape, exact immutable path,
-- revision domain, one-live-upload exclusion, and idempotency before quota.
do $$
declare
  v_blocked boolean;
  v_first record;
  v_retry record;
begin
  v_blocked := false;
  begin
    perform * from public.brownsync_reserve_org_media_upload(
      '90000000-0000-4000-8000-000000000003',
      'chk-asset-alpha',
      '90100000-0000-4000-8000-000000000099',
      '90200000-0000-4000-8000-000000000099',
      'avatar',
      'Outsider',
      0,
      null,
      'org/chk-asset-alpha/avatar/90200000-0000-4000-8000-000000000099.webp'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end;
  if not v_blocked then
    raise exception 'non-admin reserved an upload';
  end if;

  v_blocked := false;
  begin
    perform * from public.brownsync_reserve_org_media_upload(
      '90000000-0000-4000-8000-000000000001',
      'chk-asset-alpha',
      '90100000-0000-4000-8000-000000000098',
      '90200000-0000-4000-8000-000000000098',
      'avatar',
      'Bad path',
      0,
      null,
      '../escape.webp'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_ASSET_PATH_INVALID';
  end;
  if not v_blocked then
    raise exception 'path traversal was accepted';
  end if;

  select * into v_first
  from public.brownsync_reserve_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    '90100000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001',
    'avatar',
    '  Primary avatar  ',
    0,
    null,
    'org/chk-asset-alpha/avatar/90200000-0000-4000-8000-000000000001.webp'
  );
  select * into v_retry
  from public.brownsync_reserve_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    '90100000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001',
    'avatar',
    'Primary avatar',
    0,
    null,
    'org/chk-asset-alpha/avatar/90200000-0000-4000-8000-000000000001.webp'
  );
  if v_first.upload_id <> v_retry.upload_id
     or v_first.replayed
     or not v_retry.replayed
     or v_first.expires_at <= pg_catalog.clock_timestamp()
     or v_first.expires_at >
          pg_catalog.clock_timestamp() + interval '10 minutes 1 second'
     or (
       select count
       from public.org_asset_mutation_limits
       where user_id = '90000000-0000-4000-8000-000000000001'
         and bucket = 'media_hour'
     ) <> 1 then
    raise exception 'reservation replay/quota contract failed';
  end if;

  v_blocked := false;
  begin
    perform * from public.brownsync_reserve_org_media_upload(
      '90000000-0000-4000-8000-000000000001',
      'chk-asset-alpha',
      '90100000-0000-4000-8000-000000000001',
      '90200000-0000-4000-8000-000000000001',
      'avatar',
      'Changed avatar',
      0,
      null,
      'org/chk-asset-alpha/avatar/90200000-0000-4000-8000-000000000001.webp'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_ASSET_REQUEST_CONFLICT';
  end;
  if not v_blocked then
    raise exception 'changed reservation replay did not conflict';
  end if;

  v_blocked := false;
  begin
    perform * from public.brownsync_reserve_org_media_upload(
      '90000000-0000-4000-8000-000000000002',
      'chk-asset-alpha',
      '90100000-0000-4000-8000-000000000002',
      '90200000-0000-4000-8000-000000000002',
      'gallery',
      'Busy gallery',
      null,
      0,
      'org/chk-asset-alpha/gallery/90200000-0000-4000-8000-000000000002.webp'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_ASSET_UPLOAD_BUSY';
  end;
  if not v_blocked then
    raise exception 'one-live-upload exclusion failed';
  end if;
end
$$;

-- Begin and finalize are charge-once continuations. Finalization validates the
-- authoritative transformed output, updates the normal org revision/audit,
-- and replays only an identical result.
do $$
declare
  v_begin record;
  v_blocked boolean;
  v_final record;
  v_retry record;
begin
  v_blocked := false;
  begin
    perform * from public.brownsync_begin_org_media_upload(
      '90000000-0000-4000-8000-000000000002',
      '90200000-0000-4000-8000-000000000001'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end;
  if not v_blocked then
    raise exception 'different admin stole an upload claim';
  end if;

  select * into v_begin
  from public.brownsync_begin_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001'
  );
  if v_begin.alt_text <> 'Primary avatar'
     or v_begin.kind <> 'avatar' then
    raise exception 'begin returned an unsafe claim: %', v_begin;
  end if;

  v_blocked := false;
  begin
    perform * from public.brownsync_finalize_org_media_upload(
      '90000000-0000-4000-8000-000000000001',
      '90200000-0000-4000-8000-000000000001',
      '90300000-0000-4000-8000-000000000001',
      'http://cdn.example/avatar.webp',
      512,
      512,
      20000
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_ASSET_OUTPUT_INVALID';
  end;
  if not v_blocked or (
    select status from public.org_media_uploads
    where id = '90200000-0000-4000-8000-000000000001'
  ) <> 'processing' then
    raise exception 'invalid output did not roll back cleanly';
  end if;

  select * into v_final
  from public.brownsync_finalize_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001',
    '90300000-0000-4000-8000-000000000001',
    'https://cdn.example/avatar.webp',
    512,
    512,
    20000
  );
  select * into v_retry
  from public.brownsync_finalize_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001',
    '90300000-0000-4000-8000-000000000001',
    'https://cdn.example/avatar.webp',
    512,
    512,
    20000
  );
  if v_final.replayed
     or not v_retry.replayed
     or v_final.organization_revision <> 1
     or v_final.gallery_revision is not null
     or v_final.asset_revision <> 1
     or v_final.alt_text <> 'Primary avatar'
     or (select avatar_url from public.org_overrides
         where organization_id = 'chk-asset-alpha')
          <> 'https://cdn.example/avatar.webp'
     or (select count(*) from public.org_edits
         where organization_id = 'chk-asset-alpha'
           and action = 'content_edited'
           and revision = 1) <> 1
     or (select count from public.org_asset_mutation_limits
         where user_id = '90000000-0000-4000-8000-000000000001'
           and bucket = 'media_hour') <> 1 then
    raise exception 'avatar finalization/replay contract failed';
  end if;

  v_blocked := false;
  begin
    perform * from public.brownsync_finalize_org_media_upload(
      '90000000-0000-4000-8000-000000000001',
      '90200000-0000-4000-8000-000000000001',
      '90300000-0000-4000-8000-000000000001',
      'https://cdn.example/changed.webp',
      512,
      512,
      20000
    );
  exception when raise_exception then
    v_blocked := sqlerrm =
      'BROWNSYNC_ORG_ASSET_FINALIZATION_CONFLICT';
  end;
  if not v_blocked then
    raise exception 'changed finalized output replay did not conflict';
  end if;
end
$$;

-- Gallery finalization uses its own revision, delete/reorder use optimistic
-- semantics, and object visibility is removed before cleanup is attempted.
do $$
declare
  v_delete record;
  v_final record;
  v_projection record;
  v_reorder record;
  v_retry record;
begin
  perform * from public.brownsync_reserve_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    '90100000-0000-4000-8000-000000000003',
    '90200000-0000-4000-8000-000000000003',
    'gallery',
    'Gallery one',
    null,
    0,
    'org/chk-asset-alpha/gallery/90200000-0000-4000-8000-000000000003.webp'
  );
  perform * from public.brownsync_begin_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000003'
  );
  select * into v_final
  from public.brownsync_finalize_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000003',
    '90300000-0000-4000-8000-000000000003',
    'https://cdn.example/gallery-one.webp',
    1200,
    900,
    30000
  );
  if v_final.gallery_revision <> 1
     or v_final.organization_revision is not null
     or v_final.position <> 0 then
    raise exception 'gallery finalization used the wrong revision domain';
  end if;

  select * into v_reorder
  from public.brownsync_reorder_org_gallery(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    0,
    array['90300000-0000-4000-8000-000000000003']::uuid[]
  );
  if v_reorder.changed or v_reorder.gallery_revision <> 1 then
    raise exception 'identical stale reorder was not a no-op';
  end if;

  select * into v_delete
  from public.brownsync_delete_org_media(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    '90300000-0000-4000-8000-000000000001',
    1
  );
  if not v_delete.changed
     or v_delete.organization_revision <> 2
     or v_delete.gallery_revision is not null
     or exists (
       select 1 from public.brownsync_get_org_media('chk-asset-alpha')
       where media_id = '90300000-0000-4000-8000-000000000001'
     )
     or not exists (
       select 1 from public.org_media_cleanup_queue
       where object_path =
         'org/chk-asset-alpha/avatar/90200000-0000-4000-8000-000000000001.webp'
     ) then
    raise exception 'media delete did not hide then enqueue';
  end if;

  select * into v_delete
  from public.brownsync_delete_org_media(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    '90300000-0000-4000-8000-000000000001',
    0
  );
  if v_delete.changed or v_delete.organization_revision <> 2 then
    raise exception 'deleted media retry checked stale revision';
  end if;

  select * into v_projection
  from public.brownsync_get_org_media('chk-asset-alpha')
  where media_id = '90300000-0000-4000-8000-000000000003';
  if v_projection.organization_revision <> 2
     or v_projection.gallery_revision <> 1
     or v_projection.kind <> 'gallery'
     or v_projection.asset_revision <> 1 then
    raise exception 'public media projection is not collection-safe';
  end if;

  select * into v_delete
  from public.brownsync_delete_org_media(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    '90300000-0000-4000-8000-000000000003',
    1
  );
  select * into v_retry
  from public.brownsync_finalize_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000003',
    '90300000-0000-4000-8000-000000000003',
    'https://cdn.example/gallery-one.webp',
    1200,
    900,
    30000
  );
  if not v_delete.changed
     or v_delete.gallery_revision <> 2
     or not v_retry.replayed
     or v_retry.position <> 0
     or v_retry.asset_revision <> 1
     or v_retry.gallery_revision <> 1 then
    raise exception 'finalized gallery replay used mutable asset state';
  end if;

  perform * from public.brownsync_reserve_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    '90100000-0000-4000-8000-000000000030',
    '90200000-0000-4000-8000-000000000030',
    'gallery',
    'Gallery refill',
    null,
    2,
    'org/chk-asset-alpha/gallery/90200000-0000-4000-8000-000000000030.webp'
  );
  perform * from public.brownsync_begin_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000030'
  );
  select * into v_final
  from public.brownsync_finalize_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000030',
    '90300000-0000-4000-8000-000000000030',
    'https://cdn.example/gallery-refill.webp',
    900,
    900,
    31000
  );
  if v_final.position <> 0
     or v_final.gallery_revision <> 3 then
    raise exception 'deleted gallery position was not reusable';
  end if;
end
$$;

-- A removed admin cannot finalize, but the original actor can still fail the
-- claimed upload so an already-written object enters the cleanup outbox.
do $$
declare
  v_blocked boolean;
  v_failed record;
begin
  perform * from public.brownsync_reserve_org_media_upload(
    '90000000-0000-4000-8000-000000000002',
    'chk-asset-beta',
    '90100000-0000-4000-8000-000000000004',
    '90200000-0000-4000-8000-000000000004',
    'banner',
    'Removed editor banner',
    0,
    null,
    'org/chk-asset-beta/banner/90200000-0000-4000-8000-000000000004.webp'
  );
  perform * from public.brownsync_begin_org_media_upload(
    '90000000-0000-4000-8000-000000000002',
    '90200000-0000-4000-8000-000000000004'
  );
  delete from public.org_admins
  where organization_id = 'chk-asset-beta'
    and user_id = '90000000-0000-4000-8000-000000000002';

  v_blocked := false;
  begin
    perform * from public.brownsync_finalize_org_media_upload(
      '90000000-0000-4000-8000-000000000002',
      '90200000-0000-4000-8000-000000000004',
      '90300000-0000-4000-8000-000000000004',
      'https://cdn.example/removed.webp',
      1000,
      500,
      40000
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end;
  if not v_blocked then
    raise exception 'removed admin finalized a claimed upload';
  end if;

  select * into v_failed
  from public.brownsync_fail_org_media_upload(
    '90000000-0000-4000-8000-000000000002',
    '90200000-0000-4000-8000-000000000004',
    'finalization_failed',
    true
  );
  if not v_failed.changed
     or not v_failed.cleanup_enqueued
     or v_failed.status <> 'failed' then
    raise exception 'removed-admin cleanup continuation failed';
  end if;
end
$$;

-- Cleanup claims are actorless, leased, retry-safe, and never restore public
-- visibility. Completion is bound to worker + token and is replayable.
do $$
declare
  v_blocked boolean;
  v_claim record;
  v_complete record;
  v_retry record;
begin
  select * into v_claim
  from public.brownsync_claim_media_cleanup(
    '90400000-0000-4000-8000-000000000001',
    100
  )
  where object_path =
    'org/chk-asset-beta/banner/90200000-0000-4000-8000-000000000004.webp';
  if v_claim.cleanup_id is null
     or v_claim.attempt_count <> 1
     or v_claim.lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'cleanup claim was not leased';
  end if;

  v_blocked := false;
  begin
    perform * from public.brownsync_complete_media_cleanup(
      '90400000-0000-4000-8000-000000000002',
      v_claim.cleanup_id,
      v_claim.lease_token,
      true,
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_ASSET_LEASE_CONFLICT';
  end;
  if not v_blocked then
    raise exception 'different cleanup worker completed a lease';
  end if;

  select * into v_complete
  from public.brownsync_complete_media_cleanup(
    '90400000-0000-4000-8000-000000000001',
    v_claim.cleanup_id,
    v_claim.lease_token,
    false,
    'storage_unavailable'
  );
  select * into v_retry
  from public.brownsync_complete_media_cleanup(
    '90400000-0000-4000-8000-000000000001',
    v_claim.cleanup_id,
    v_claim.lease_token,
    false,
    'storage_unavailable'
  );
  if v_complete.disposition <> 'retry_scheduled'
     or v_complete.next_attempt_at <= pg_catalog.clock_timestamp()
     or v_complete.replayed
     or not v_retry.replayed
     or v_retry.next_attempt_at <> v_complete.next_attempt_at then
    raise exception 'cleanup retry/replay contract failed';
  end if;
end
$$;

-- SQL accepts only Worker-canonical Instagram post/Reel permalinks. Add,
-- lease, capacity, finalize, projection, embed, refresh, and delete never
-- expose raw render material through the normal public projection.
do $$
declare
  v_add record;
  v_alias record;
  v_blocked boolean;
  v_capacity record;
  v_delete record;
  v_embed record;
  v_final record;
  v_list record;
  v_refresh record;
  v_retry record;
begin
  v_blocked := false;
  begin
    perform * from public.brownsync_add_org_social_post(
      '90000000-0000-4000-8000-000000000001',
      'chk-asset-alpha',
      '90500000-0000-4000-8000-000000000099',
      '90600000-0000-4000-8000-000000000099',
      'https://instagram.com/p/not-canonical/'
    );
  exception when raise_exception then
    v_blocked := sqlerrm =
      'BROWNSYNC_ORG_ASSET_PERMALINK_INVALID';
  end;
  if not v_blocked then
    raise exception 'noncanonical Instagram URL reached storage';
  end if;

  select * into v_add
  from public.brownsync_add_org_social_post(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001',
    'https://www.instagram.com/p/Abc_123-/'
  );
  select * into v_retry
  from public.brownsync_add_org_social_post(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    '90500000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001',
    'https://www.instagram.com/p/Abc_123-/'
  );
  if v_add.replayed
     or not v_add.refresh_required
     or v_add.lease_token is null
     or not v_retry.replayed
     or v_retry.lease_token <> v_add.lease_token
     or (select count from public.org_asset_mutation_limits
         where user_id = '90000000-0000-4000-8000-000000000001'
           and bucket = 'social_hour') <> 1 then
    raise exception 'social add replay/quota contract failed';
  end if;

  select * into v_alias
  from public.brownsync_add_org_social_post(
    '90000000-0000-4000-8000-000000000002',
    'chk-asset-alpha',
    '90500000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000002',
    'https://www.instagram.com/p/Abc_123-/'
  );
  if not v_alias.replayed
     or v_alias.post_id <> v_add.post_id
     or v_alias.lease_token is not null
     or v_alias.refresh_required then
    raise exception 'duplicate permalink did not converge safely';
  end if;

  v_blocked := false;
  begin
    perform * from public.brownsync_add_org_social_post(
      '90000000-0000-4000-8000-000000000002',
      'chk-asset-alpha',
      '90500000-0000-4000-8000-000000000002',
      '90600000-0000-4000-8000-000000000002',
      'https://www.instagram.com/p/Changed_123/'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_ASSET_REQUEST_CONFLICT';
  end;
  if not v_blocked then
    raise exception 'converged request alias accepted changed payload';
  end if;

  update public.org_oembed_control
  set enabled = true,
      updated_at = pg_catalog.clock_timestamp()
  where id = true;

  select * into v_capacity
  from public.brownsync_consume_oembed_capacity(
    v_add.post_id,
    v_add.lease_token
  );
  if not v_capacity.allowed
     or v_capacity.remaining <> 899
     or v_capacity.retry_after_seconds <> 0 then
    raise exception 'first oEmbed capacity unit was not granted';
  end if;

  select * into v_final
  from public.brownsync_finalize_org_social_post(
    '90000000-0000-4000-8000-000000000001',
    v_add.post_id,
    v_add.lease_token,
    'ready',
    '<blockquote>sanitized</blockquote>',
    'Brown Club',
    null
  );
  select * into v_retry
  from public.brownsync_finalize_org_social_post(
    '90000000-0000-4000-8000-000000000001',
    v_add.post_id,
    v_add.lease_token,
    'ready',
    '<blockquote>sanitized</blockquote>',
    'Brown Club',
    null
  );
  if not v_final.changed
     or v_final.replayed
     or v_final.status <> 'ready'
     or v_final.revision <> 1
     or v_final.cache_expires_at <
          pg_catalog.clock_timestamp() + interval '23 hours 59 minutes'
     or not v_retry.replayed
     or v_retry.changed then
    raise exception 'social ready finalization/replay failed';
  end if;

  select * into v_list
  from public.brownsync_list_org_social_posts('chk-asset-alpha')
  where post_id = v_add.post_id;
  if not v_list.embed_available
     or v_list.attribution <> 'Brown Club'
     or pg_catalog.to_jsonb(v_list) ? 'render_html' then
    raise exception 'normal social projection leaked/omitted render state';
  end if;

  select * into v_embed
  from public.brownsync_get_org_social_embed(v_add.post_id);
  if v_embed.render_html <> '<blockquote>sanitized</blockquote>' then
    raise exception 'fresh ready embed was unavailable';
  end if;

  select * into v_refresh
  from public.brownsync_begin_org_social_post_refresh(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    v_add.post_id
  );
  if not v_refresh.claimed or v_refresh.lease_token is null then
    raise exception 'manual refresh did not claim an idle post';
  end if;
  select * into v_retry
  from public.brownsync_begin_org_social_post_refresh(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    v_add.post_id
  );
  if v_retry.claimed or v_retry.lease_token is not null then
    raise exception 'live manual refresh lease was duplicated or exposed';
  end if;

  select * into v_final
  from public.brownsync_finalize_org_social_post(
    '90000000-0000-4000-8000-000000000001',
    v_add.post_id,
    v_refresh.lease_token,
    'deferred',
    null,
    null,
    'provider_rate_limited'
  );
  if v_final.changed
     or v_final.status <> 'ready'
     or v_final.revision <> 1
     or not exists (
       select 1 from public.brownsync_get_org_social_embed(v_add.post_id)
     ) then
    raise exception 'deferred refresh destroyed a fresh cache';
  end if;

  select * into v_delete
  from public.brownsync_delete_org_social_post(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    v_add.post_id,
    1
  );
  if not v_delete.changed
     or v_delete.revision <> 2
     or exists (
       select 1 from public.brownsync_list_org_social_posts('chk-asset-alpha')
       where post_id = v_add.post_id
     )
     or exists (
       select 1 from public.brownsync_get_org_social_embed(v_add.post_id)
     ) then
    raise exception 'social delete did not remove both projections';
  end if;
  select * into v_delete
  from public.brownsync_delete_org_social_post(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    v_add.post_id,
    0
  );
  if v_delete.changed or v_delete.revision <> 2 then
    raise exception 'terminal social retry checked stale revision';
  end if;
end
$$;

-- A processing upload is failed + queued by account deletion, while
-- organization-owned ready assets/social cards survive with nullable actor
-- attribution and actor leases/limits are removed.
do $$
declare
  v_add record;
begin
  perform * from public.brownsync_reserve_org_media_upload(
    '90000000-0000-4000-8000-000000000004',
    'chk-asset-delete',
    '90100000-0000-4000-8000-000000000010',
    '90200000-0000-4000-8000-000000000010',
    'avatar',
    'Delete-race avatar',
    0,
    null,
    'org/chk-asset-delete/avatar/90200000-0000-4000-8000-000000000010.webp'
  );
  perform * from public.brownsync_begin_org_media_upload(
    '90000000-0000-4000-8000-000000000004',
    '90200000-0000-4000-8000-000000000010'
  );
  select * into v_add
  from public.brownsync_add_org_social_post(
    '90000000-0000-4000-8000-000000000004',
    'chk-asset-delete',
    '90500000-0000-4000-8000-000000000010',
    '90600000-0000-4000-8000-000000000010',
    'https://www.instagram.com/reel/Delete_1/'
  );

  delete from auth.users
  where id = '90000000-0000-4000-8000-000000000004';

  if (select status from public.org_media_uploads
      where id = '90200000-0000-4000-8000-000000000010') <> 'failed'
     or (select failure_code from public.org_media_uploads
         where id = '90200000-0000-4000-8000-000000000010')
          <> 'account_deleted'
     or (select actor_user_id from public.org_media_uploads
         where id = '90200000-0000-4000-8000-000000000010') is not null
     or not exists (
       select 1 from public.org_media_cleanup_queue
       where object_path =
         'org/chk-asset-delete/avatar/90200000-0000-4000-8000-000000000010.webp'
     )
     or (select status from public.org_social_posts
         where id = v_add.post_id) <> 'link_only'
     or (select added_by from public.org_social_posts
         where id = v_add.post_id) is not null
     or (select refresh_lease_token from public.org_social_posts
         where id = v_add.post_id) is not null
     or exists (
       select 1 from public.org_asset_mutation_limits
       where user_id = '90000000-0000-4000-8000-000000000004'
     ) then
    raise exception 'account-deletion asset transformation failed';
  end if;
end
$$;

-- The active gallery cap is exactly 12. Tombstones do not consume positions,
-- while a thirteenth finalized output fails atomically and can be cleaned.
do $$
declare
  v_blocked boolean;
  v_client_id uuid;
  v_final record;
  v_media_id uuid;
  v_upload_id uuid;
begin
  for i in 1..12 loop
    v_client_id := (
      '92100000-0000-4000-8000-'
      || pg_catalog.to_char(i, 'FM000000000000')
    )::uuid;
    v_upload_id := (
      '92200000-0000-4000-8000-'
      || pg_catalog.to_char(i, 'FM000000000000')
    )::uuid;
    v_media_id := (
      '92300000-0000-4000-8000-'
      || pg_catalog.to_char(i, 'FM000000000000')
    )::uuid;

    perform * from public.brownsync_reserve_org_media_upload(
      '90000000-0000-4000-8000-000000000001',
      'chk-asset-cap',
      v_client_id,
      v_upload_id,
      'gallery',
      'Cap image ' || i::text,
      null,
      (i - 1)::bigint,
      'org/chk-asset-cap/gallery/' || v_upload_id::text || '.webp'
    );
    perform * from public.brownsync_begin_org_media_upload(
      '90000000-0000-4000-8000-000000000001',
      v_upload_id
    );
    select * into v_final
    from public.brownsync_finalize_org_media_upload(
      '90000000-0000-4000-8000-000000000001',
      v_upload_id,
      v_media_id,
      'https://cdn.example/cap-' || i::text || '.webp',
      100,
      100,
      1000 + i
    );
    if v_final.position <> i - 1
       or v_final.gallery_revision <> i then
      raise exception 'gallery cap setup drifted at %: %', i, v_final;
    end if;
  end loop;

  perform * from public.brownsync_reserve_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-cap',
    '92100000-0000-4000-8000-000000000013',
    '92200000-0000-4000-8000-000000000013',
    'gallery',
    'Cap overflow',
    null,
    12,
    'org/chk-asset-cap/gallery/92200000-0000-4000-8000-000000000013.webp'
  );
  perform * from public.brownsync_begin_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    '92200000-0000-4000-8000-000000000013'
  );
  v_blocked := false;
  begin
    perform * from public.brownsync_finalize_org_media_upload(
      '90000000-0000-4000-8000-000000000001',
      '92200000-0000-4000-8000-000000000013',
      '92300000-0000-4000-8000-000000000013',
      'https://cdn.example/cap-13.webp',
      100,
      100,
      1013
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_ASSET_GALLERY_LIMIT';
  end;
  if not v_blocked
     or (
       select pg_catalog.count(*)
       from public.org_media_assets
       where organization_id = 'chk-asset-cap'
         and kind = 'gallery'
         and status = 'ready'
         and deleted_at is null
     ) <> 12 then
    raise exception 'gallery cap admitted a thirteenth active image';
  end if;

  perform * from public.brownsync_fail_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    '92200000-0000-4000-8000-000000000013',
    'finalization_failed',
    true
  );
end
$$;

-- Fixed actor buckets stop at exactly 30. The rejected statement and any
-- state it inserted are rolled back; a replay remains free at the boundary.
do $$
declare
  v_blocked boolean;
  v_row record;
begin
  update public.org_asset_mutation_limits
  set count = 30,
      window_started_at = pg_catalog.clock_timestamp()
  where user_id = '90000000-0000-4000-8000-000000000001'
    and bucket = 'media_hour';

  v_blocked := false;
  begin
    perform * from public.brownsync_reserve_org_media_upload(
      '90000000-0000-4000-8000-000000000001',
      'chk-asset-beta',
      '90100000-0000-4000-8000-000000000020',
      '90200000-0000-4000-8000-000000000020',
      'gallery',
      'At quota',
      null,
      0,
      'org/chk-asset-beta/gallery/90200000-0000-4000-8000-000000000020.webp'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_ASSET_RATE_LIMITED';
  end;
  if not v_blocked
     or exists (
       select 1 from public.org_media_uploads
       where id = '90200000-0000-4000-8000-000000000020'
     )
     or (select count from public.org_asset_mutation_limits
         where user_id = '90000000-0000-4000-8000-000000000001'
           and bucket = 'media_hour') <> 30 then
    raise exception 'media quota boundary did not roll back';
  end if;

  select * into v_row
  from public.brownsync_reserve_org_media_upload(
    '90000000-0000-4000-8000-000000000001',
    'chk-asset-alpha',
    '90100000-0000-4000-8000-000000000003',
    '90200000-0000-4000-8000-000000000003',
    'gallery',
    'Gallery one',
    null,
    0,
    'org/chk-asset-alpha/gallery/90200000-0000-4000-8000-000000000003.webp'
  );
  if not v_row.replayed then
    raise exception 'reservation replay was charged at the boundary';
  end if;
end
$$;

-- Public roles cannot use RLS or routine execution as an alternate write/read
-- path. This transaction-local role switch leaves owner-side fixtures intact.
do $$
declare
  v_blocked boolean;
begin
  v_blocked := false;
  begin
    set local role authenticated;
    perform * from public.brownsync_get_org_media('chk-asset-alpha');
    reset role;
  exception when insufficient_privilege then
    reset role;
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'authenticated executed owner media projection';
  end if;

  v_blocked := false;
  begin
    set local role anon;
    perform * from public.org_social_posts;
    reset role;
  exception when insufficient_privilege then
    reset role;
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'anon read internal social rows';
  end if;
end
$$;

rollback;

\echo '0017_org_assets_checks: all semantic checks passed'
