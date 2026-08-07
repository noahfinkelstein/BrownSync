#!/usr/bin/env bash
# Deterministic multi-session checks for organization asset serialization.
set -euo pipefail

if [[ ${BROWNSYNC_DISPOSABLE_ORG_ASSET_RACE:-} != 1 ]]; then
  echo "refusing org-asset race fixtures without BROWNSYNC_DISPOSABLE_ORG_ASSET_RACE=1" >&2
  exit 2
fi

database_url=${1:-postgresql://postgres:postgres@localhost:5432/postgres}
race_tmp=$(mktemp -d)
cleanup_armed=false
child_pids=()

psql_task() {
  psql -X "$database_url" -v ON_ERROR_STOP=1 -qAt "$@"
}

cleanup() {
  local child_pid
  for child_pid in ${child_pids[@]+"${child_pids[@]}"}; do
    if kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
    fi
  done
  if [[ $cleanup_armed == true ]]; then
    psql_task >/dev/null 2>&1 <<'SQL' || true
delete from auth.users
where id::text like '91000000-0000-4000-8000-00000000000_';
delete from public.organizations
where id like 'chk-asset-race-%';
delete from public.org_media_cleanup_queue
where object_path like 'org/chk-asset-race-%';
update public.org_oembed_control
set enabled = false,
    circuit_open_until = null,
    window_started_at = pg_catalog.clock_timestamp(),
    request_count = 0,
    updated_at = pg_catalog.clock_timestamp()
where id = true;
SQL
  fi
  if [[ -n ${race_tmp:-} && -d $race_tmp ]]; then
    rm -r -- "$race_tmp"
  fi
}
trap cleanup EXIT

wait_for_advisory_marker() {
  local lock_key=$1
  local attempt
  local held
  for attempt in {1..200}; do
    held=$(psql_task -c \
      "select not pg_catalog.pg_try_advisory_lock($lock_key)")
    if [[ $held == t ]]; then
      return 0
    fi
    sleep 0.05
  done
  echo "timed out waiting for advisory marker $lock_key" >&2
  return 1
}

wait_for_lock_wait() {
  local application_name=$1
  local attempt
  local waiting
  for attempt in {1..200}; do
    waiting=$(psql_task -c "
      select exists (
        select 1
        from pg_catalog.pg_stat_activity
        where application_name = '$application_name'
          and wait_event_type = 'Lock'
      )
    ")
    if [[ $waiting == t ]]; then
      return 0
    fi
    sleep 0.05
  done
  echo "$application_name never entered a lock wait" >&2
  return 1
}

wait_success() {
  local child_pid=$1
  local output_file=$2
  local status
  set +e
  wait "$child_pid"
  status=$?
  set -e
  if [[ $status -ne 0 ]]; then
    echo "race session failed unexpectedly: $output_file" >&2
    sed -n '1,180p' "$output_file" >&2
    return 1
  fi
}

wait_failure() {
  local child_pid=$1
  local output_file=$2
  local expected_error=$3
  local status
  set +e
  wait "$child_pid"
  status=$?
  set -e
  if [[ $status -eq 0 ]] || ! grep -Fq "$expected_error" "$output_file"; then
    echo "race session did not fail with $expected_error: $output_file" >&2
    sed -n '1,180p' "$output_file" >&2
    return 1
  fi
}

if [[ $(psql_task -c "
  select
    pg_catalog.to_regprocedure(
      'public.brownsync_reserve_org_media_upload(uuid,text,uuid,uuid,text,text,bigint,bigint,text)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.brownsync_finalize_org_media_upload(uuid,uuid,uuid,text,integer,integer,integer)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.brownsync_claim_media_cleanup(uuid,integer)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.brownsync_add_org_social_post(uuid,text,uuid,uuid,text)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.brownsync_consume_oembed_capacity(uuid,uuid)'
    ) is not null
") != t ]]; then
  echo "BROWNSYNC_ORG_ASSETS_MIGRATION_MISSING: race owner routines" >&2
  exit 1
fi

collision_count=$(psql_task -c "
  select
    (select pg_catalog.count(*) from auth.users
     where id::text like '91000000-0000-4000-8000-00000000000_')
    +
    (select pg_catalog.count(*) from public.organizations
     where id like 'chk-asset-race-%')
    +
    (select pg_catalog.count(*) from public.org_media_cleanup_queue
     where object_path like 'org/chk-asset-race-%')
")
if [[ $collision_count != 0 ]]; then
  echo "refusing to overwrite pre-existing Task 5E race fixtures" >&2
  exit 2
fi
cleanup_armed=true

psql_task <<'SQL'
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('91000000-0000-4000-8000-000000000001', 'asset.race.owner@brown.edu', '{"full_name":"Asset Race Owner"}', '{"provider":"google"}'),
  ('91000000-0000-4000-8000-000000000002', 'asset.race.editor@brown.edu', '{"full_name":"Asset Race Editor"}', '{"provider":"google"}'),
  ('91000000-0000-4000-8000-000000000003', 'asset.race.quota@brown.edu', '{"full_name":"Asset Race Quota"}', '{"provider":"google"}'),
  ('91000000-0000-4000-8000-000000000004', 'asset.race.sociala@brown.edu', '{"full_name":"Asset Race Social A"}', '{"provider":"google"}'),
  ('91000000-0000-4000-8000-000000000005', 'asset.race.socialb@brown.edu', '{"full_name":"Asset Race Social B"}', '{"provider":"google"}'),
  ('91000000-0000-4000-8000-000000000006', 'asset.race.delete@brown.edu', '{"full_name":"Asset Race Delete"}', '{"provider":"google"}'),
  ('91000000-0000-4000-8000-000000000007', 'asset.race.socialdelete@brown.edu', '{"full_name":"Asset Race Social Delete"}', '{"provider":"google"}');

insert into public.organizations (
  id, name, kind, description, source, contact_emails
) values
  ('chk-asset-race-main', 'Asset Race Main', 'club', 'Main', 'race', '{}'),
  ('chk-asset-race-admin', 'Asset Race Admin', 'club', 'Admin', 'race', '{}'),
  ('chk-asset-race-text', 'Asset Race Text', 'club', 'Text', 'race', '{}'),
  ('chk-asset-race-delete', 'Asset Race Delete', 'club', 'Delete', 'race', '{}'),
  ('chk-asset-race-quota-a', 'Asset Race Quota A', 'club', 'Quota A', 'race', '{}'),
  ('chk-asset-race-quota-b', 'Asset Race Quota B', 'club', 'Quota B', 'race', '{}'),
  ('chk-asset-race-social', 'Asset Race Social', 'club', 'Social', 'race', '{}'),
  ('chk-asset-race-gallery', 'Asset Race Gallery', 'club', 'Gallery', 'race', '{}'),
  ('chk-asset-race-social-delete', 'Asset Race Social Delete', 'club', 'Social Delete', 'race', '{}');

insert into public.org_admins (
  organization_id, user_id, role, grant_source
) values
  ('chk-asset-race-main', '91000000-0000-4000-8000-000000000001', 'owner', 'creator'),
  ('chk-asset-race-admin', '91000000-0000-4000-8000-000000000001', 'owner', 'creator'),
  ('chk-asset-race-admin', '91000000-0000-4000-8000-000000000002', 'editor', 'owner_grant'),
  ('chk-asset-race-text', '91000000-0000-4000-8000-000000000001', 'owner', 'creator'),
  ('chk-asset-race-delete', '91000000-0000-4000-8000-000000000006', 'owner', 'creator'),
  ('chk-asset-race-quota-a', '91000000-0000-4000-8000-000000000003', 'owner', 'creator'),
  ('chk-asset-race-quota-b', '91000000-0000-4000-8000-000000000003', 'owner', 'creator'),
  ('chk-asset-race-social', '91000000-0000-4000-8000-000000000004', 'owner', 'creator'),
  ('chk-asset-race-social', '91000000-0000-4000-8000-000000000005', 'editor', 'owner_grant'),
  ('chk-asset-race-gallery', '91000000-0000-4000-8000-000000000001', 'owner', 'creator'),
  ('chk-asset-race-social-delete', '91000000-0000-4000-8000-000000000007', 'owner', 'creator'),
  ('chk-asset-race-social-delete', '91000000-0000-4000-8000-000000000005', 'editor', 'owner_grant');
SQL

# Same-key reservation serializes on the organization and converges to one
# upload, one actor quota unit, and one replay.
psql_task >"$race_tmp/reserve-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-reserve-holder';
select upload_id::text || '|' || replayed::text
from public.brownsync_reserve_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  'chk-asset-race-main',
  '91100000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000001',
  'avatar',
  'Race avatar',
  0,
  null,
  'org/chk-asset-race-main/avatar/91200000-0000-4000-8000-000000000001.webp'
);
select pg_catalog.pg_advisory_lock(517001);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517001);
SQL
reserve_holder_pid=$!
child_pids+=("$reserve_holder_pid")
wait_for_advisory_marker 517001

psql_task >"$race_tmp/reserve-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-reserve-waiter';
select upload_id::text || '|' || replayed::text
from public.brownsync_reserve_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  'chk-asset-race-main',
  '91100000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000001',
  'avatar',
  'Race avatar',
  0,
  null,
  'org/chk-asset-race-main/avatar/91200000-0000-4000-8000-000000000001.webp'
);
commit;
SQL
reserve_waiter_pid=$!
child_pids+=("$reserve_waiter_pid")
wait_for_lock_wait brownsync-5e-reserve-waiter
wait_success "$reserve_holder_pid" "$race_tmp/reserve-holder.log"
wait_success "$reserve_waiter_pid" "$race_tmp/reserve-waiter.log"

if ! grep -Fq '91200000-0000-4000-8000-000000000001|f' \
    "$race_tmp/reserve-holder.log" \
  || ! grep -Fq '91200000-0000-4000-8000-000000000001|t' \
    "$race_tmp/reserve-waiter.log" \
  || [[ $(psql_task -c "
      select count(*) = 1
        and (select count from public.org_asset_mutation_limits
             where user_id = '91000000-0000-4000-8000-000000000001'
               and bucket = 'media_hour') = 1
      from public.org_media_uploads
      where id = '91200000-0000-4000-8000-000000000001'
    ") != t ]]; then
  echo "same-key reservation did not converge charge-once" >&2
  exit 1
fi

psql_task -c "
  select * from public.brownsync_begin_org_media_upload(
    '91000000-0000-4000-8000-000000000001',
    '91200000-0000-4000-8000-000000000001'
  )
" >/dev/null

# Concurrent identical finalization creates one asset/revision; the waiter
# observes the committed terminal result as a replay.
psql_task >"$race_tmp/finalize-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-finalize-holder';
select media_id::text || '|' || organization_revision::text || '|' ||
       replayed::text
from public.brownsync_finalize_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000001',
  '91300000-0000-4000-8000-000000000001',
  'https://cdn.example/race-avatar.webp',
  800,
  800,
  44000
);
select pg_catalog.pg_advisory_lock(517002);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517002);
SQL
finalize_holder_pid=$!
child_pids+=("$finalize_holder_pid")
wait_for_advisory_marker 517002

psql_task >"$race_tmp/finalize-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-finalize-waiter';
select media_id::text || '|' || organization_revision::text || '|' ||
       replayed::text
from public.brownsync_finalize_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000001',
  '91300000-0000-4000-8000-000000000001',
  'https://cdn.example/race-avatar.webp',
  800,
  800,
  44000
);
commit;
SQL
finalize_waiter_pid=$!
child_pids+=("$finalize_waiter_pid")
wait_for_lock_wait brownsync-5e-finalize-waiter
wait_success "$finalize_holder_pid" "$race_tmp/finalize-holder.log"
wait_success "$finalize_waiter_pid" "$race_tmp/finalize-waiter.log"

if ! grep -Fq '91300000-0000-4000-8000-000000000001|1|f' \
    "$race_tmp/finalize-holder.log" \
  || ! grep -Fq '91300000-0000-4000-8000-000000000001|1|t' \
    "$race_tmp/finalize-waiter.log" \
  || [[ $(psql_task -c "
      select count(*) = 1
      from public.org_media_assets
      where upload_id = '91200000-0000-4000-8000-000000000001'
    ") != t ]]; then
  echo "concurrent avatar finalization did not converge" >&2
  exit 1
fi

# Admin removal wins the organization lock. The waiting finalizer fails closed,
# while the original actor's safety-reducing fail continuation remains usable.
psql_task <<'SQL'
select * from public.brownsync_reserve_org_media_upload(
  '91000000-0000-4000-8000-000000000002',
  'chk-asset-race-admin',
  '91100000-0000-4000-8000-000000000002',
  '91200000-0000-4000-8000-000000000002',
  'banner',
  'Removed editor',
  0,
  null,
  'org/chk-asset-race-admin/banner/91200000-0000-4000-8000-000000000002.webp'
);
select * from public.brownsync_begin_org_media_upload(
  '91000000-0000-4000-8000-000000000002',
  '91200000-0000-4000-8000-000000000002'
);
SQL

psql_task >"$race_tmp/remove-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-remove-holder';
select changed from public.brownsync_remove_org_admin(
  '91000000-0000-4000-8000-000000000001',
  'chk-asset-race-admin',
  '91000000-0000-4000-8000-000000000002'
);
select pg_catalog.pg_advisory_lock(517003);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517003);
SQL
remove_holder_pid=$!
child_pids+=("$remove_holder_pid")
wait_for_advisory_marker 517003

psql_task >"$race_tmp/remove-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-remove-waiter';
select * from public.brownsync_finalize_org_media_upload(
  '91000000-0000-4000-8000-000000000002',
  '91200000-0000-4000-8000-000000000002',
  '91300000-0000-4000-8000-000000000002',
  'https://cdn.example/removed-race.webp',
  1200,
  500,
  45000
);
commit;
SQL
remove_waiter_pid=$!
child_pids+=("$remove_waiter_pid")
wait_for_lock_wait brownsync-5e-remove-waiter
wait_success "$remove_holder_pid" "$race_tmp/remove-holder.log"
wait_failure "$remove_waiter_pid" "$race_tmp/remove-waiter.log" \
  'BROWNSYNC_ORG_ASSET_FORBIDDEN'

psql_task -c "
  select * from public.brownsync_fail_org_media_upload(
    '91000000-0000-4000-8000-000000000002',
    '91200000-0000-4000-8000-000000000002',
    'finalization_failed',
    true
  )
" >/dev/null

# With exactly one pending object, SKIP LOCKED gives it to one cleanup worker
# and returns no row to the other instead of duplicating deletion.
psql_task >"$race_tmp/cleanup-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-cleanup-holder';
select cleanup_id::text || '|' || lease_token::text
from public.brownsync_claim_media_cleanup(
  '91400000-0000-4000-8000-000000000001',
  1
);
select pg_catalog.pg_advisory_lock(517004);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517004);
SQL
cleanup_holder_pid=$!
child_pids+=("$cleanup_holder_pid")
wait_for_advisory_marker 517004

psql_task >"$race_tmp/cleanup-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-cleanup-waiter';
select cleanup_id::text
from public.brownsync_claim_media_cleanup(
  '91400000-0000-4000-8000-000000000002',
  1
);
commit;
SQL
cleanup_waiter_pid=$!
child_pids+=("$cleanup_waiter_pid")
wait_success "$cleanup_waiter_pid" "$race_tmp/cleanup-waiter.log"
wait_success "$cleanup_holder_pid" "$race_tmp/cleanup-holder.log"
if [[ -s "$race_tmp/cleanup-waiter.log" ]] \
  || [[ $(psql_task -c "
      select count(*) = 1
      from public.org_media_cleanup_queue
      where object_path =
        'org/chk-asset-race-admin/banner/91200000-0000-4000-8000-000000000002.webp'
        and status = 'leased'
        and attempt_count = 1
    ") != t ]]; then
  echo "cleanup lease was duplicated" >&2
  sed -n '1,80p' "$race_tmp/cleanup-waiter.log" >&2
  exit 1
fi

# Replacing an existing avatar and a concurrent delete of the old ID serialize
# on the organization. Replacement wins: exactly one new asset is visible, the
# old path is queued once, and the waiter observes an idempotent terminal row.
psql_task <<'SQL'
select * from public.brownsync_reserve_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  'chk-asset-race-main',
  '91100000-0000-4000-8000-000000000010',
  '91200000-0000-4000-8000-000000000010',
  'avatar',
  'Replacement avatar',
  1,
  null,
  'org/chk-asset-race-main/avatar/91200000-0000-4000-8000-000000000010.webp'
);
select * from public.brownsync_begin_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000010'
);
SQL

psql_task >"$race_tmp/replace-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-replace-holder';
select media_id::text || '|' || organization_revision::text
from public.brownsync_finalize_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000010',
  '91300000-0000-4000-8000-000000000010',
  'https://cdn.example/replacement-avatar.webp',
  900,
  900,
  46000
);
select pg_catalog.pg_advisory_lock(517011);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517011);
SQL
replace_holder_pid=$!
child_pids+=("$replace_holder_pid")
wait_for_advisory_marker 517011

psql_task >"$race_tmp/replace-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-replace-waiter';
select changed::text
from public.brownsync_delete_org_media(
  '91000000-0000-4000-8000-000000000001',
  'chk-asset-race-main',
  '91300000-0000-4000-8000-000000000001',
  1
);
commit;
SQL
replace_waiter_pid=$!
child_pids+=("$replace_waiter_pid")
wait_for_lock_wait brownsync-5e-replace-waiter
wait_success "$replace_holder_pid" "$race_tmp/replace-holder.log"
wait_success "$replace_waiter_pid" "$race_tmp/replace-waiter.log"
if ! grep -Fq '91300000-0000-4000-8000-000000000010|2' \
    "$race_tmp/replace-holder.log" \
  || ! grep -Fxq 'false' "$race_tmp/replace-waiter.log" \
  || [[ $(psql_task -c "
      select
        (select count(*) from public.org_media_assets
         where organization_id = 'chk-asset-race-main'
           and kind = 'avatar'
           and status = 'ready'
           and deleted_at is null) = 1
        and (select avatar_url from public.org_overrides
             where organization_id = 'chk-asset-race-main')
          = 'https://cdn.example/replacement-avatar.webp'
        and (select count(*) from public.org_media_cleanup_queue
             where object_path =
               'org/chk-asset-race-main/avatar/91200000-0000-4000-8000-000000000001.webp'
               and reason = 'replaced') = 1
    ") != t ]] \
  || [[ $(psql_task -c "
      select replayed
        and asset_revision = 1
        and organization_revision = 1
      from public.brownsync_finalize_org_media_upload(
        '91000000-0000-4000-8000-000000000001',
        '91200000-0000-4000-8000-000000000001',
        '91300000-0000-4000-8000-000000000001',
        'https://cdn.example/race-avatar.webp',
        800,
        800,
        44000
      )
    ") != t ]]; then
  echo "replacement/delete race lost visibility, outbox, or replay state" >&2
  exit 1
fi

# A committed text edit wins the normal organization revision. Finalization
# waiting behind it must reject the stale revision and leave no asset.
psql_task <<'SQL'
select * from public.brownsync_reserve_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  'chk-asset-race-text',
  '91100000-0000-4000-8000-000000000003',
  '91200000-0000-4000-8000-000000000003',
  'avatar',
  'Text race',
  0,
  null,
  'org/chk-asset-race-text/avatar/91200000-0000-4000-8000-000000000003.webp'
);
select * from public.brownsync_begin_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000003'
);
SQL

psql_task >"$race_tmp/text-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-text-holder';
select * from public.brownsync_edit_organization(
  '91000000-0000-4000-8000-000000000001',
  'chk-asset-race-text',
  0,
  '{"description":"Text edit wins"}'::jsonb
);
select pg_catalog.pg_advisory_lock(517005);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517005);
SQL
text_holder_pid=$!
child_pids+=("$text_holder_pid")
wait_for_advisory_marker 517005

psql_task >"$race_tmp/text-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-text-waiter';
select * from public.brownsync_finalize_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000003',
  '91300000-0000-4000-8000-000000000003',
  'https://cdn.example/text-race.webp',
  500,
  500,
  25000
);
commit;
SQL
text_waiter_pid=$!
child_pids+=("$text_waiter_pid")
wait_for_lock_wait brownsync-5e-text-waiter
wait_success "$text_holder_pid" "$race_tmp/text-holder.log"
wait_failure "$text_waiter_pid" "$race_tmp/text-waiter.log" \
  'BROWNSYNC_ORG_ASSET_REVISION_CONFLICT'
if [[ $(psql_task -c "
  select count(*) = 0 from public.org_media_assets
  where id = '91300000-0000-4000-8000-000000000003'
") != t ]]; then
  echo "stale text/finalize race created an asset" >&2
  exit 1
fi
psql_task -c "
  select * from public.brownsync_fail_org_media_upload(
    '91000000-0000-4000-8000-000000000001',
    '91200000-0000-4000-8000-000000000003',
    'finalization_failed',
    true
  )
" >/dev/null

# Account deletion wins the auth/profile barrier. A waiting finalizer becomes
# unauthorized, while the trigger fails the upload and durably queues its path.
psql_task <<'SQL'
select * from public.brownsync_reserve_org_media_upload(
  '91000000-0000-4000-8000-000000000006',
  'chk-asset-race-delete',
  '91100000-0000-4000-8000-000000000004',
  '91200000-0000-4000-8000-000000000004',
  'avatar',
  'Account delete race',
  0,
  null,
  'org/chk-asset-race-delete/avatar/91200000-0000-4000-8000-000000000004.webp'
);
select * from public.brownsync_begin_org_media_upload(
  '91000000-0000-4000-8000-000000000006',
  '91200000-0000-4000-8000-000000000004'
);
SQL

psql_task >"$race_tmp/delete-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-delete-holder';
delete from auth.users
where id = '91000000-0000-4000-8000-000000000006';
select pg_catalog.pg_advisory_lock(517006);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517006);
SQL
delete_holder_pid=$!
child_pids+=("$delete_holder_pid")
wait_for_advisory_marker 517006

psql_task >"$race_tmp/delete-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-delete-waiter';
select * from public.brownsync_finalize_org_media_upload(
  '91000000-0000-4000-8000-000000000006',
  '91200000-0000-4000-8000-000000000004',
  '91300000-0000-4000-8000-000000000004',
  'https://cdn.example/delete-race.webp',
  400,
  400,
  20000
);
commit;
SQL
delete_waiter_pid=$!
child_pids+=("$delete_waiter_pid")
wait_for_lock_wait brownsync-5e-delete-waiter
wait_success "$delete_holder_pid" "$race_tmp/delete-holder.log"
wait_failure "$delete_waiter_pid" "$race_tmp/delete-waiter.log" \
  'BROWNSYNC_ORG_ASSET_UNAUTHORIZED'
if [[ $(psql_task -c "
  select status = 'failed'
    and failure_code = 'account_deleted'
    and actor_user_id is null
  from public.org_media_uploads
  where id = '91200000-0000-4000-8000-000000000004'
") != t ]] || [[ $(psql_task -c "
  select count(*) = 1
  from public.org_media_cleanup_queue
  where object_path =
    'org/chk-asset-race-delete/avatar/91200000-0000-4000-8000-000000000004.webp'
") != t ]]; then
  echo "account deletion did not own processing cleanup" >&2
  exit 1
fi

# Two independent organizations race at count=29. The first commit takes unit
# 30; the waiter gets the stable rate error and its reservation rolls back.
psql_task <<'SQL'
insert into public.org_asset_mutation_limits (
  user_id, bucket, window_started_at, count, updated_at
) values (
  '91000000-0000-4000-8000-000000000003',
  'media_hour',
  pg_catalog.clock_timestamp(),
  29,
  pg_catalog.clock_timestamp()
);
SQL

psql_task >"$race_tmp/quota-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-quota-holder';
select * from public.brownsync_reserve_org_media_upload(
  '91000000-0000-4000-8000-000000000003',
  'chk-asset-race-quota-a',
  '91100000-0000-4000-8000-000000000005',
  '91200000-0000-4000-8000-000000000005',
  'gallery',
  'Quota winner',
  null,
  0,
  'org/chk-asset-race-quota-a/gallery/91200000-0000-4000-8000-000000000005.webp'
);
select pg_catalog.pg_advisory_lock(517007);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517007);
SQL
quota_holder_pid=$!
child_pids+=("$quota_holder_pid")
wait_for_advisory_marker 517007

psql_task >"$race_tmp/quota-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-quota-waiter';
select * from public.brownsync_reserve_org_media_upload(
  '91000000-0000-4000-8000-000000000003',
  'chk-asset-race-quota-b',
  '91100000-0000-4000-8000-000000000006',
  '91200000-0000-4000-8000-000000000006',
  'gallery',
  'Quota loser',
  null,
  0,
  'org/chk-asset-race-quota-b/gallery/91200000-0000-4000-8000-000000000006.webp'
);
commit;
SQL
quota_waiter_pid=$!
child_pids+=("$quota_waiter_pid")
wait_for_lock_wait brownsync-5e-quota-waiter
wait_success "$quota_holder_pid" "$race_tmp/quota-holder.log"
wait_failure "$quota_waiter_pid" "$race_tmp/quota-waiter.log" \
  'BROWNSYNC_ORG_ASSET_RATE_LIMITED'
if [[ $(psql_task -c "
  select
    (select count from public.org_asset_mutation_limits
     where user_id = '91000000-0000-4000-8000-000000000003'
       and bucket = 'media_hour') = 30
    and exists (
      select 1 from public.org_media_uploads
      where id = '91200000-0000-4000-8000-000000000005'
    )
    and not exists (
      select 1 from public.org_media_uploads
      where id = '91200000-0000-4000-8000-000000000006'
    )
") != t ]]; then
  echo "quota boundary admitted two rows or leaked the failed row" >&2
  exit 1
fi

# Build three gallery rows, then race a reorder against a stale delete. Reorder
# wins revision 4; the waiter fails rather than deleting an unintended order.
psql_task <<'SQL'
do $$
declare
  v_client_id uuid;
  v_media_id uuid;
  v_upload_id uuid;
begin
  for i in 1..3 loop
    v_client_id := (
      '91810000-0000-4000-8000-'
      || pg_catalog.to_char(i, 'FM000000000000')
    )::uuid;
    v_upload_id := (
      '91820000-0000-4000-8000-'
      || pg_catalog.to_char(i, 'FM000000000000')
    )::uuid;
    v_media_id := (
      '91830000-0000-4000-8000-'
      || pg_catalog.to_char(i, 'FM000000000000')
    )::uuid;
    perform * from public.brownsync_reserve_org_media_upload(
      '91000000-0000-4000-8000-000000000001',
      'chk-asset-race-gallery',
      v_client_id,
      v_upload_id,
      'gallery',
      'Race gallery ' || i::text,
      null,
      (i - 1)::bigint,
      'org/chk-asset-race-gallery/gallery/'
        || v_upload_id::text || '.webp'
    );
    perform * from public.brownsync_begin_org_media_upload(
      '91000000-0000-4000-8000-000000000001',
      v_upload_id
    );
    perform * from public.brownsync_finalize_org_media_upload(
      '91000000-0000-4000-8000-000000000001',
      v_upload_id,
      v_media_id,
      'https://cdn.example/gallery-race-' || i::text || '.webp',
      200,
      200,
      2000 + i
    );
  end loop;
end
$$;
SQL

psql_task >"$race_tmp/gallery-order-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-gallery-order-holder';
select gallery_revision::text || '|' || changed::text
from public.brownsync_reorder_org_gallery(
  '91000000-0000-4000-8000-000000000001',
  'chk-asset-race-gallery',
  3,
  array[
    '91830000-0000-4000-8000-000000000003',
    '91830000-0000-4000-8000-000000000002',
    '91830000-0000-4000-8000-000000000001'
  ]::uuid[]
);
select pg_catalog.pg_advisory_lock(517012);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517012);
SQL
gallery_order_holder_pid=$!
child_pids+=("$gallery_order_holder_pid")
wait_for_advisory_marker 517012

psql_task >"$race_tmp/gallery-delete-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-gallery-delete-waiter';
select * from public.brownsync_delete_org_media(
  '91000000-0000-4000-8000-000000000001',
  'chk-asset-race-gallery',
  '91830000-0000-4000-8000-000000000002',
  3
);
commit;
SQL
gallery_delete_waiter_pid=$!
child_pids+=("$gallery_delete_waiter_pid")
wait_for_lock_wait brownsync-5e-gallery-delete-waiter
wait_success "$gallery_order_holder_pid" \
  "$race_tmp/gallery-order-holder.log"
wait_failure "$gallery_delete_waiter_pid" \
  "$race_tmp/gallery-delete-waiter.log" \
  'BROWNSYNC_ORG_ASSET_REVISION_CONFLICT'
if ! grep -Fq '4|true' "$race_tmp/gallery-order-holder.log" \
  || [[ $(psql_task -c "
      select
        (select revision from public.org_media_collections
         where organization_id = 'chk-asset-race-gallery') = 4
        and (select pg_catalog.array_agg(id order by position)
             from public.org_media_assets
             where organization_id = 'chk-asset-race-gallery'
               and kind = 'gallery'
               and status = 'ready'
               and deleted_at is null)
          = array[
              '91830000-0000-4000-8000-000000000003',
              '91830000-0000-4000-8000-000000000002',
              '91830000-0000-4000-8000-000000000001'
            ]::uuid[]
    ") != t ]]; then
  echo "gallery reorder/delete race lost revision or ordering" >&2
  exit 1
fi

# Delete the middle row, prove the tombstoned position is reusable, and prove
# the original finalize replay still returns its immutable position/revision.
psql_task <<'SQL'
select * from public.brownsync_delete_org_media(
  '91000000-0000-4000-8000-000000000001',
  'chk-asset-race-gallery',
  '91830000-0000-4000-8000-000000000002',
  4
);
select * from public.brownsync_reserve_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  'chk-asset-race-gallery',
  '91810000-0000-4000-8000-000000000004',
  '91820000-0000-4000-8000-000000000004',
  'gallery',
  'Race gallery refill',
  null,
  5,
  'org/chk-asset-race-gallery/gallery/91820000-0000-4000-8000-000000000004.webp'
);
select * from public.brownsync_begin_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  '91820000-0000-4000-8000-000000000004'
);
select * from public.brownsync_finalize_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  '91820000-0000-4000-8000-000000000004',
  '91830000-0000-4000-8000-000000000004',
  'https://cdn.example/gallery-race-4.webp',
  200,
  200,
  2004
);
SQL
if [[ $(psql_task -c "
  select replayed
    and position = 1
    and asset_revision = 1
    and gallery_revision = 2
  from public.brownsync_finalize_org_media_upload(
    '91000000-0000-4000-8000-000000000001',
    '91820000-0000-4000-8000-000000000002',
    '91830000-0000-4000-8000-000000000002',
    'https://cdn.example/gallery-race-2.webp',
    200,
    200,
    2002
  )
") != t ]] || [[ $(psql_task -c "
  select position = 2 and gallery_revision = 6
  from public.brownsync_finalize_org_media_upload(
    '91000000-0000-4000-8000-000000000001',
    '91820000-0000-4000-8000-000000000004',
    '91830000-0000-4000-8000-000000000004',
    'https://cdn.example/gallery-race-4.webp',
    200,
    200,
    2004
  )
") != t ]]; then
  echo "gallery tombstone consumed a position or replay mutated" >&2
  exit 1
fi

# Grow to eleven active rows. The twelfth finalization holds the organization;
# a waiting transaction reserves/claims a predicted-revision thirteenth, then
# rolls its whole reservation back when the active cap rejects finalization.
psql_task <<'SQL'
do $$
declare
  v_client_id uuid;
  v_expected bigint := 6;
  v_media_id uuid;
  v_upload_id uuid;
begin
  for i in 5..12 loop
    v_client_id := (
      '91810000-0000-4000-8000-'
      || pg_catalog.to_char(i, 'FM000000000000')
    )::uuid;
    v_upload_id := (
      '91820000-0000-4000-8000-'
      || pg_catalog.to_char(i, 'FM000000000000')
    )::uuid;
    v_media_id := (
      '91830000-0000-4000-8000-'
      || pg_catalog.to_char(i, 'FM000000000000')
    )::uuid;
    perform * from public.brownsync_reserve_org_media_upload(
      '91000000-0000-4000-8000-000000000001',
      'chk-asset-race-gallery',
      v_client_id,
      v_upload_id,
      'gallery',
      'Race gallery ' || i::text,
      null,
      v_expected,
      'org/chk-asset-race-gallery/gallery/'
        || v_upload_id::text || '.webp'
    );
    perform * from public.brownsync_begin_org_media_upload(
      '91000000-0000-4000-8000-000000000001',
      v_upload_id
    );
    perform * from public.brownsync_finalize_org_media_upload(
      '91000000-0000-4000-8000-000000000001',
      v_upload_id,
      v_media_id,
      'https://cdn.example/gallery-race-' || i::text || '.webp',
      200,
      200,
      2000 + i
    );
    v_expected := v_expected + 1;
  end loop;

  perform * from public.brownsync_reserve_org_media_upload(
    '91000000-0000-4000-8000-000000000001',
    'chk-asset-race-gallery',
    '91810000-0000-4000-8000-000000000013',
    '91820000-0000-4000-8000-000000000013',
    'gallery',
    'Race gallery twelfth',
    null,
    14,
    'org/chk-asset-race-gallery/gallery/91820000-0000-4000-8000-000000000013.webp'
  );
  perform * from public.brownsync_begin_org_media_upload(
    '91000000-0000-4000-8000-000000000001',
    '91820000-0000-4000-8000-000000000013'
  );
end
$$;
SQL

psql_task >"$race_tmp/gallery-cap-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-gallery-cap-holder';
select media_id::text || '|' || gallery_revision::text
from public.brownsync_finalize_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  '91820000-0000-4000-8000-000000000013',
  '91830000-0000-4000-8000-000000000013',
  'https://cdn.example/gallery-race-13.webp',
  200,
  200,
  2013
);
select pg_catalog.pg_advisory_lock(517013);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517013);
SQL
gallery_cap_holder_pid=$!
child_pids+=("$gallery_cap_holder_pid")
wait_for_advisory_marker 517013

psql_task >"$race_tmp/gallery-cap-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-gallery-cap-waiter';
select * from public.brownsync_reserve_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  'chk-asset-race-gallery',
  '91810000-0000-4000-8000-000000000014',
  '91820000-0000-4000-8000-000000000014',
  'gallery',
  'Race gallery overflow',
  null,
  15,
  'org/chk-asset-race-gallery/gallery/91820000-0000-4000-8000-000000000014.webp'
);
select * from public.brownsync_begin_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  '91820000-0000-4000-8000-000000000014'
);
select * from public.brownsync_finalize_org_media_upload(
  '91000000-0000-4000-8000-000000000001',
  '91820000-0000-4000-8000-000000000014',
  '91830000-0000-4000-8000-000000000014',
  'https://cdn.example/gallery-race-14.webp',
  200,
  200,
  2014
);
commit;
SQL
gallery_cap_waiter_pid=$!
child_pids+=("$gallery_cap_waiter_pid")
wait_for_lock_wait brownsync-5e-gallery-cap-waiter
wait_success "$gallery_cap_holder_pid" "$race_tmp/gallery-cap-holder.log"
wait_failure "$gallery_cap_waiter_pid" \
  "$race_tmp/gallery-cap-waiter.log" \
  'BROWNSYNC_ORG_ASSET_GALLERY_LIMIT'
if ! grep -Fq '91830000-0000-4000-8000-000000000013|15' \
    "$race_tmp/gallery-cap-holder.log" \
  || [[ $(psql_task -c "
      select
        (select revision from public.org_media_collections
         where organization_id = 'chk-asset-race-gallery') = 15
        and (select count(*) from public.org_media_assets
             where organization_id = 'chk-asset-race-gallery'
               and kind = 'gallery'
               and status = 'ready'
               and deleted_at is null) = 12
        and not exists (
          select 1 from public.org_media_uploads
          where id = '91820000-0000-4000-8000-000000000014'
        )
    ") != t ]]; then
  echo "concurrent gallery cap crossed 12 or leaked the failed reservation" >&2
  exit 1
fi

# A pending post added by one admin is manually leased by a second. Deleting
# the lease owner wins the auth/profile barrier: the waiting actor finalizer is
# unauthorized, the pending card becomes link-only, and the other attribution
# survives while the dead actor's lease disappears.
psql_task <<'SQL'
select * from public.brownsync_add_org_social_post(
  '91000000-0000-4000-8000-000000000005',
  'chk-asset-race-social-delete',
  '91500000-0000-4000-8000-000000000010',
  '91600000-0000-4000-8000-000000000010',
  'https://www.instagram.com/reel/Delete_Refresh/'
);
update public.org_social_posts
set refresh_lease_expires_at =
  pg_catalog.clock_timestamp() - interval '1 second'
where id = '91600000-0000-4000-8000-000000000010';
SQL
social_delete_claim=$(psql_task -F '|' -c "
  select post_id::text, lease_token::text
  from public.brownsync_begin_org_social_post_refresh(
    '91000000-0000-4000-8000-000000000007',
    'chk-asset-race-social-delete',
    '91600000-0000-4000-8000-000000000010'
  )
")
social_delete_post=${social_delete_claim%%|*}
social_delete_lease=${social_delete_claim#*|}

psql_task >"$race_tmp/social-delete-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-social-delete-holder';
delete from auth.users
where id = '91000000-0000-4000-8000-000000000007';
select pg_catalog.pg_advisory_lock(517014);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517014);
SQL
social_delete_holder_pid=$!
child_pids+=("$social_delete_holder_pid")
wait_for_advisory_marker 517014

psql_task >"$race_tmp/social-delete-waiter.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-social-delete-waiter';
select * from public.brownsync_finalize_org_social_post(
  '91000000-0000-4000-8000-000000000007',
  '$social_delete_post',
  '$social_delete_lease',
  'link_only',
  null,
  null,
  'provider_unavailable'
);
commit;
SQL
social_delete_waiter_pid=$!
child_pids+=("$social_delete_waiter_pid")
wait_for_lock_wait brownsync-5e-social-delete-waiter
wait_success "$social_delete_holder_pid" \
  "$race_tmp/social-delete-holder.log"
wait_failure "$social_delete_waiter_pid" \
  "$race_tmp/social-delete-waiter.log" \
  'BROWNSYNC_ORG_ASSET_UNAUTHORIZED'
if [[ $(psql_task -c "
  select status = 'link_only'
    and revision = 1
    and added_by = '91000000-0000-4000-8000-000000000005'
    and refresh_actor_id is null
    and refresh_worker_id is null
    and refresh_lease_token is null
    and refresh_lease_expires_at is null
  from public.org_social_posts
  where id = '91600000-0000-4000-8000-000000000010'
") != t ]]; then
  echo "account deletion left a pending social lease or lost other attribution" >&2
  exit 1
fi

# Different client request IDs for the same canonical org/permalink serialize
# to one post ID and only the creating actor is charged.
psql_task >"$race_tmp/social-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-social-holder';
select post_id::text || '|' || replayed::text || '|' ||
       refresh_required::text
from public.brownsync_add_org_social_post(
  '91000000-0000-4000-8000-000000000004',
  'chk-asset-race-social',
  '91500000-0000-4000-8000-000000000001',
  '91600000-0000-4000-8000-000000000001',
  'https://www.instagram.com/p/Race_Post/'
);
select pg_catalog.pg_advisory_lock(517008);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517008);
SQL
social_holder_pid=$!
child_pids+=("$social_holder_pid")
wait_for_advisory_marker 517008

psql_task >"$race_tmp/social-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-social-waiter';
select post_id::text || '|' || replayed::text || '|' ||
       refresh_required::text
from public.brownsync_add_org_social_post(
  '91000000-0000-4000-8000-000000000005',
  'chk-asset-race-social',
  '91500000-0000-4000-8000-000000000002',
  '91600000-0000-4000-8000-000000000002',
  'https://www.instagram.com/p/Race_Post/'
);
commit;
SQL
social_waiter_pid=$!
child_pids+=("$social_waiter_pid")
wait_for_lock_wait brownsync-5e-social-waiter
wait_success "$social_holder_pid" "$race_tmp/social-holder.log"
wait_success "$social_waiter_pid" "$race_tmp/social-waiter.log"
if ! grep -Fq '91600000-0000-4000-8000-000000000001|false|true' \
    "$race_tmp/social-holder.log" \
  || ! grep -Fq '91600000-0000-4000-8000-000000000001|true|false' \
    "$race_tmp/social-waiter.log" \
  || [[ $(psql_task -c "
      select count(*) = 1
      from public.org_social_posts
      where organization_id = 'chk-asset-race-social'
        and permalink = 'https://www.instagram.com/p/Race_Post/'
    ") != t ]] \
  || [[ $(psql_task -c "
      select
        coalesce((
          select count
          from public.org_asset_mutation_limits
          where user_id = '91000000-0000-4000-8000-000000000004'
            and bucket = 'social_hour'
        ), 0) = 1
        and coalesce((
          select count
          from public.org_asset_mutation_limits
          where user_id = '91000000-0000-4000-8000-000000000005'
            and bucket = 'social_hour'
        ), 0) = 1
    ") != t ]]; then
  echo "concurrent duplicate social add did not converge charge-once" >&2
  exit 1
fi

# The converged waiter's request ID is durably mapped. Reusing that exact
# request for a different permalink conflicts instead of creating a new row.
set +e
psql_task -c "
  select * from public.brownsync_add_org_social_post(
    '91000000-0000-4000-8000-000000000005',
    'chk-asset-race-social',
    '91500000-0000-4000-8000-000000000002',
    '91600000-0000-4000-8000-000000000002',
    'https://www.instagram.com/p/Race_Changed/'
  )
" >"$race_tmp/social-alias-conflict.log" 2>&1
social_alias_status=$?
set -e
if [[ $social_alias_status -eq 0 ]] \
  || ! grep -Fq 'BROWNSYNC_ORG_ASSET_REQUEST_CONFLICT' \
    "$race_tmp/social-alias-conflict.log" \
  || [[ $(psql_task -c "
      select count(*) = 0
      from public.org_social_posts
      where organization_id = 'chk-asset-race-social'
        and permalink = 'https://www.instagram.com/p/Race_Changed/'
    ") != t ]]; then
  echo "converged social request ID was not durable" >&2
  exit 1
fi

# Prepare a second leased post. Two independent live leases race at the exact
# durable 899 boundary; only one provider call is admitted as request 900.
second_social=$(psql_task -F '|' -c "
  select post_id::text, lease_token::text
  from public.brownsync_add_org_social_post(
    '91000000-0000-4000-8000-000000000005',
    'chk-asset-race-social',
    '91500000-0000-4000-8000-000000000003',
    '91600000-0000-4000-8000-000000000003',
    'https://www.instagram.com/reel/Race_Second/'
  )
")
first_social=$(psql_task -F '|' -c "
  select id::text, refresh_lease_token::text
  from public.org_social_posts
  where id = '91600000-0000-4000-8000-000000000001'
")
first_post=${first_social%%|*}
first_lease=${first_social#*|}
second_post=${second_social%%|*}
second_lease=${second_social#*|}

psql_task -c "
  update public.org_oembed_control
  set enabled = true,
      circuit_open_until = null,
      window_started_at = pg_catalog.clock_timestamp(),
      request_count = 899,
      updated_at = pg_catalog.clock_timestamp()
  where id = true
" >/dev/null

psql_task >"$race_tmp/capacity-holder.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-capacity-holder';
select allowed::text || '|' || remaining::text
from public.brownsync_consume_oembed_capacity(
  '$first_post',
  '$first_lease'
);
select pg_catalog.pg_advisory_lock(517009);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517009);
SQL
capacity_holder_pid=$!
child_pids+=("$capacity_holder_pid")
wait_for_advisory_marker 517009

psql_task >"$race_tmp/capacity-waiter.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-capacity-waiter';
select allowed::text || '|' || remaining::text
from public.brownsync_consume_oembed_capacity(
  '$second_post',
  '$second_lease'
);
commit;
SQL
capacity_waiter_pid=$!
child_pids+=("$capacity_waiter_pid")
wait_for_lock_wait brownsync-5e-capacity-waiter
wait_success "$capacity_holder_pid" "$race_tmp/capacity-holder.log"
wait_success "$capacity_waiter_pid" "$race_tmp/capacity-waiter.log"
if ! grep -Fq 'true|0' "$race_tmp/capacity-holder.log" \
  || ! grep -Fq 'false|0' "$race_tmp/capacity-waiter.log" \
  || [[ $(psql_task -c "
      select request_count = 900
      from public.org_oembed_control
      where id = true
    ") != t ]]; then
  echo "concurrent oEmbed calls crossed the 900/hour ceiling" >&2
  exit 1
fi

# Once the first add lease is finalized link-only, a single expired/due post
# is leased by only one scheduled worker under SKIP LOCKED.
psql_task -c "
  select * from public.brownsync_finalize_org_social_post(
    '91000000-0000-4000-8000-000000000004',
    '$first_post',
    '$first_lease',
    'link_only',
    null,
    null,
    'provider_unavailable'
  )
" >/dev/null
psql_task -c "
  update public.org_social_posts
  set next_refresh_at = pg_catalog.clock_timestamp() - interval '1 second'
  where id = '$first_post'
" >/dev/null
psql_task -c "
  update public.org_social_posts
  set next_refresh_at = pg_catalog.clock_timestamp() + interval '1 day'
  where id <> '$first_post'
    and organization_id = 'chk-asset-race-social'
" >/dev/null

psql_task >"$race_tmp/refresh-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-refresh-holder';
select post_id::text
from public.brownsync_claim_due_instagram_posts(
  '91700000-0000-4000-8000-000000000001',
  1
);
select pg_catalog.pg_advisory_lock(517010);
select pg_catalog.pg_sleep(2);
commit;
select pg_catalog.pg_advisory_unlock(517010);
SQL
refresh_holder_pid=$!
child_pids+=("$refresh_holder_pid")
wait_for_advisory_marker 517010

psql_task >"$race_tmp/refresh-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-5e-refresh-waiter';
select post_id::text
from public.brownsync_claim_due_instagram_posts(
  '91700000-0000-4000-8000-000000000002',
  1
);
commit;
SQL
refresh_waiter_pid=$!
child_pids+=("$refresh_waiter_pid")
wait_success "$refresh_waiter_pid" "$race_tmp/refresh-waiter.log"
wait_success "$refresh_holder_pid" "$race_tmp/refresh-holder.log"
if ! grep -Fq "$first_post" "$race_tmp/refresh-holder.log" \
  || [[ -s "$race_tmp/refresh-waiter.log" ]]; then
  echo "scheduled refresh lease was duplicated" >&2
  exit 1
fi

cleanup
cleanup_armed=false
if [[ $(psql_task -c "
  select
    (select pg_catalog.count(*) from auth.users
     where id::text like '91000000-0000-4000-8000-00000000000_')
    +
    (select pg_catalog.count(*) from public.organizations
     where id like 'chk-asset-race-%')
    +
    (select pg_catalog.count(*) from public.org_media_cleanup_queue
     where object_path like 'org/chk-asset-race-%')
") != 0 ]]; then
  echo "race cleanup left fixtures that would make rerun unsafe" >&2
  exit 1
fi
if [[ $(psql_task -c "
  select not enabled
    and circuit_open_until is null
    and request_count = 0
  from public.org_oembed_control
  where id = true
") != t ]]; then
  echo "race cleanup did not restore fail-closed oEmbed control" >&2
  exit 1
fi

echo "0017_org_assets_race: all deterministic concurrency races passed"
