#!/usr/bin/env bash
# Deterministic multi-session checks for student-event serialization.
set -euo pipefail

if [[ ${BROWNSYNC_DISPOSABLE_USER_EVENT_RACE:-} != 1 ]]; then
  echo "refusing user-event race fixtures without BROWNSYNC_DISPOSABLE_USER_EVENT_RACE=1" >&2
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
  for child_pid in "${child_pids[@]}"; do
    if kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
    fi
  done
  if [[ $cleanup_armed == true ]]; then
    psql_task >/dev/null 2>&1 <<'SQL' || true
delete from public.user_events
where client_request_id::text like '83100000-%';
delete from auth.users
where id::text like '83000000-0000-4000-8000-00000000000_';
delete from public.organizations
where id in (
  'chk-user-event-race-org',
  'chk-user-event-race-other'
);
delete from public.places
where id = 'chk-user-event-race-place';
update public.user_event_controls
set posting_enabled = true,
    updated_by = null,
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
    held=$(psql_task -c "select not pg_catalog.pg_try_advisory_lock($lock_key)")
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

expect_nowait_conflict() {
  local label=$1
  local statement=$2
  local output_file=$3
  local status
  set +e
  psql_task -c "$statement" >"$output_file" 2>&1
  status=$?
  set -e
  if [[ $status -eq 0 ]] \
     || ! grep -Fq 'could not obtain lock on row' "$output_file"; then
    echo "$label did not encounter the expected row-lock conflict" >&2
    sed -n '1,180p' "$output_file" >&2
    return 1
  fi
}

if [[ $(psql_task -c "
  select
    pg_catalog.to_regprocedure(
      'public.brownsync_create_user_event(uuid,uuid,text,text,text,timestamptz,timestamptz,text,text,text,text)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.brownsync_edit_user_event(uuid,uuid,bigint,jsonb)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.brownsync_delete_user_event(uuid,uuid)'
    ) is not null
") != t ]]; then
  echo "BROWNSYNC_USER_EVENTS_MIGRATION_MISSING: race owner routines" >&2
  exit 1
fi

collision_count=$(psql_task -c "
  select
    (select pg_catalog.count(*)
     from auth.users
     where id::text like '83000000-0000-4000-8000-00000000000_')
    +
    (select pg_catalog.count(*)
     from public.organizations
     where id in (
       'chk-user-event-race-org',
       'chk-user-event-race-other'
     ))
    +
    (select pg_catalog.count(*)
     from public.places
     where id = 'chk-user-event-race-place')
    +
    (select pg_catalog.count(*)
     from public.user_events
     where client_request_id::text like '83100000-%')
")
if [[ $collision_count != 0 ]]; then
  echo "refusing to overwrite pre-existing Task 5D race fixtures" >&2
  exit 2
fi
cleanup_armed=true

psql_task <<'SQL'
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('83000000-0000-4000-8000-000000000001', 'event.race.same@brown.edu', '{"full_name":"Event Race Same"}', '{"provider":"google"}'),
  ('83000000-0000-4000-8000-000000000002', 'event.race.counter@brown.edu', '{"full_name":"Event Race Counter"}', '{"provider":"google"}'),
  ('83000000-0000-4000-8000-000000000003', 'event.race.edit@brown.edu', '{"full_name":"Event Race Edit"}', '{"provider":"google"}'),
  ('83000000-0000-4000-8000-000000000004', 'event.race.owner@brown.edu', '{"full_name":"Event Race Owner"}', '{"provider":"google"}'),
  ('83000000-0000-4000-8000-000000000005', 'event.race.admin@brown.edu', '{"full_name":"Event Race Admin"}', '{"provider":"google"}'),
  ('83000000-0000-4000-8000-000000000006', 'event.race.reviewer@brown.edu', '{"full_name":"Event Race Reviewer"}', '{"provider":"google"}'),
  ('83000000-0000-4000-8000-000000000007', 'event.race.delete@brown.edu', '{"full_name":"Event Race Delete"}', '{"provider":"google"}'),
  ('83000000-0000-4000-8000-000000000008', 'event.race.switch@brown.edu', '{"full_name":"Event Race Switch"}', '{"provider":"google"}');

update public.profiles
set created_at = pg_catalog.clock_timestamp() - interval '2 days'
where id::text like '83000000-0000-4000-8000-00000000000_';

insert into public.places (
  id, name, aliases, kind, lat, lng, source
) values (
  'chk-user-event-race-place',
  'Check User Event Race Place',
  array['CUER Place'],
  'academic',
  41.826,
  -71.403,
  'race'
);

insert into public.organizations (
  id, name, kind, description, source, contact_emails
)
values
  ('chk-user-event-race-org', 'Check User Event Race Org', 'club', 'Race org', 'race', '{}'),
  ('chk-user-event-race-other', 'Check User Event Race Other', 'club', 'Other race org', 'race', '{}');

insert into public.org_admins (
  organization_id, user_id, role, grant_source
)
values
  ('chk-user-event-race-org', '83000000-0000-4000-8000-000000000004', 'owner', 'creator'),
  ('chk-user-event-race-org', '83000000-0000-4000-8000-000000000005', 'editor', 'owner_grant');

insert into public.org_reviewers (user_id)
values ('83000000-0000-4000-8000-000000000006');
SQL

# Concurrent same-key creation yields one event, one quota unit, and one
# replay. The waiter blocks on the uncommitted partial-unique row.
psql_task >"$race_tmp/same-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-same-holder';
select event_id::text || '|' || revision::text || '|' || replayed::text
from public.brownsync_create_user_event(
  '83000000-0000-4000-8000-000000000001',
  '83100000-0000-4000-8000-000000000001',
  null,
  'Same-key race event',
  null,
  '2031-01-01 12:00:00+00',
  null,
  'social',
  null,
  'chk-user-event-race-place',
  null
);
select pg_catalog.pg_advisory_lock(516001);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(516001);
SQL
same_holder_pid=$!
child_pids+=("$same_holder_pid")
wait_for_advisory_marker 516001

psql_task >"$race_tmp/same-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-same-waiter';
select event_id::text || '|' || revision::text || '|' || replayed::text
from public.brownsync_create_user_event(
  '83000000-0000-4000-8000-000000000001',
  '83100000-0000-4000-8000-000000000001',
  null,
  'Same-key race event',
  null,
  '2031-01-01 12:00:00+00',
  null,
  'social',
  null,
  'chk-user-event-race-place',
  null
);
commit;
SQL
same_waiter_pid=$!
child_pids+=("$same_waiter_pid")
wait_for_lock_wait brownsync-task5d-same-waiter
wait_success "$same_holder_pid" "$race_tmp/same-holder.log"
wait_success "$same_waiter_pid" "$race_tmp/same-waiter.log"

if ! grep -Eq '\|0\|false$' "$race_tmp/same-holder.log" \
   || ! grep -Eq '\|0\|true$' "$race_tmp/same-waiter.log" \
   || [[ $(psql_task -c "
     select
       (select pg_catalog.count(*) = 1
        from public.user_events
        where created_by = '83000000-0000-4000-8000-000000000001'
          and client_request_id =
            '83100000-0000-4000-8000-000000000001')
       and
       (select count = 1
        from public.user_event_create_limits
        where user_id = '83000000-0000-4000-8000-000000000001')
   ") != t ]]; then
  echo "same-key race created duplicate state or quota" >&2
  exit 1
fi

# Concurrent reuse of one idempotency key with different canonical payloads
# serializes to one winner; the loser conflicts and consumes no second quota.
psql_task >"$race_tmp/conflict-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-conflict-holder';
select event_id
from public.brownsync_create_user_event(
  '83000000-0000-4000-8000-000000000006',
  '83100000-0000-4000-8000-000000000010',
  null,
  'Concurrent conflict winner',
  null,
  '2031-01-01 15:00:00+00',
  null,
  'social',
  null,
  'chk-user-event-race-place',
  null
);
select pg_catalog.pg_advisory_lock(516009);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(516009);
SQL
conflict_holder_pid=$!
child_pids+=("$conflict_holder_pid")
wait_for_advisory_marker 516009

psql_task >"$race_tmp/conflict-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-conflict-waiter';
select *
from public.brownsync_create_user_event(
  '83000000-0000-4000-8000-000000000006',
  '83100000-0000-4000-8000-000000000010',
  null,
  'Concurrent conflict loser',
  null,
  '2031-01-01 15:00:00+00',
  null,
  'social',
  null,
  'chk-user-event-race-place',
  null
);
commit;
SQL
conflict_waiter_pid=$!
child_pids+=("$conflict_waiter_pid")
wait_for_lock_wait brownsync-task5d-conflict-waiter
wait_success "$conflict_holder_pid" "$race_tmp/conflict-holder.log"
wait_failure \
  "$conflict_waiter_pid" \
  "$race_tmp/conflict-waiter.log" \
  BROWNSYNC_USER_EVENT_REQUEST_CONFLICT

if [[ $(psql_task -c "
  select
    (select pg_catalog.count(*) = 1
     from public.user_events
     where created_by = '83000000-0000-4000-8000-000000000006'
       and client_request_id =
         '83100000-0000-4000-8000-000000000010'
       and title = 'Concurrent conflict winner')
    and
    (select count = 1
     from public.user_event_create_limits
     where user_id = '83000000-0000-4000-8000-000000000006')
") != t ]]; then
  echo "different-payload key race retained loser state or quota" >&2
  exit 1
fi

# Two distinct first-window creates race through the initially absent counter.
# Both commit, and the single durable counter reaches exactly two.
psql_task >"$race_tmp/counter-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-counter-holder';
select event_id
from public.brownsync_create_user_event(
  '83000000-0000-4000-8000-000000000002',
  '83100000-0000-4000-8000-000000000002',
  null,
  'Counter race A',
  null,
  '2031-01-02 12:00:00+00',
  null,
  'academic',
  null,
  'chk-user-event-race-place',
  null
);
select pg_catalog.pg_advisory_lock(516002);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(516002);
SQL
counter_holder_pid=$!
child_pids+=("$counter_holder_pid")
wait_for_advisory_marker 516002

psql_task >"$race_tmp/counter-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-counter-waiter';
select event_id
from public.brownsync_create_user_event(
  '83000000-0000-4000-8000-000000000002',
  '83100000-0000-4000-8000-000000000003',
  null,
  'Counter race B',
  null,
  '2031-01-02 13:00:00+00',
  null,
  'academic',
  null,
  'chk-user-event-race-place',
  null
);
commit;
SQL
counter_waiter_pid=$!
child_pids+=("$counter_waiter_pid")
wait_for_lock_wait brownsync-task5d-counter-waiter
wait_success "$counter_holder_pid" "$race_tmp/counter-holder.log"
wait_success "$counter_waiter_pid" "$race_tmp/counter-waiter.log"

if [[ $(psql_task -c "
  select
    (select pg_catalog.count(*) = 2
     from public.user_events
     where created_by = '83000000-0000-4000-8000-000000000002')
    and
    (select count = 2
     from public.user_event_create_limits
     where user_id = '83000000-0000-4000-8000-000000000002')
") != t ]]; then
  echo "first-counter race did not retain two events and count=2" >&2
  exit 1
fi

# With one quota slot left, two distinct personal creates race on the same
# counter. Exactly one commits, the loser receives the stable rate error, and
# the durable counter stops at ten.
psql_task -c "
  insert into public.user_event_create_limits (
    user_id,
    window_started_at,
    count,
    updated_at
  ) values (
    '83000000-0000-4000-8000-000000000004',
    pg_catalog.clock_timestamp(),
    9,
    pg_catalog.clock_timestamp()
  )
" >/dev/null

psql_task >"$race_tmp/last-slot-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-last-slot-holder';
select event_id
from public.brownsync_create_user_event(
  '83000000-0000-4000-8000-000000000004',
  '83100000-0000-4000-8000-000000000011',
  null,
  'Last slot winner',
  null,
  '2031-01-02 15:00:00+00',
  null,
  'academic',
  null,
  'chk-user-event-race-place',
  null
);
select pg_catalog.pg_advisory_lock(516010);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(516010);
SQL
last_slot_holder_pid=$!
child_pids+=("$last_slot_holder_pid")
wait_for_advisory_marker 516010

psql_task >"$race_tmp/last-slot-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-last-slot-waiter';
select *
from public.brownsync_create_user_event(
  '83000000-0000-4000-8000-000000000004',
  '83100000-0000-4000-8000-000000000012',
  null,
  'Last slot loser',
  null,
  '2031-01-02 16:00:00+00',
  null,
  'academic',
  null,
  'chk-user-event-race-place',
  null
);
commit;
SQL
last_slot_waiter_pid=$!
child_pids+=("$last_slot_waiter_pid")
wait_for_lock_wait brownsync-task5d-last-slot-waiter
wait_success "$last_slot_holder_pid" "$race_tmp/last-slot-holder.log"
wait_failure \
  "$last_slot_waiter_pid" \
  "$race_tmp/last-slot-waiter.log" \
  BROWNSYNC_USER_EVENT_RATE_LIMITED

if [[ $(psql_task -c "
  select
    (select count = 10
     from public.user_event_create_limits
     where user_id = '83000000-0000-4000-8000-000000000004')
    and
    (select pg_catalog.count(*) = 1
     from public.user_events
     where client_request_id in (
       '83100000-0000-4000-8000-000000000011',
       '83100000-0000-4000-8000-000000000012'
     ))
") != t ]]; then
  echo "last-slot counter race exceeded count=10 or retained two events" >&2
  exit 1
fi

edit_event_id=$(psql_task -c "
  select event_id
  from public.brownsync_create_user_event(
    '83000000-0000-4000-8000-000000000003',
    '83100000-0000-4000-8000-000000000004',
    null,
    'Edit race original',
    null,
    '2031-01-03 12:00:00+00',
    null,
    'arts',
    null,
    'chk-user-event-race-place',
    null
  )
")

# One optimistic edit wins. The competing real edit blocks and then conflicts;
# an identical stale retry observes the committed state as a no-op.
psql_task >"$race_tmp/edit-holder.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-edit-holder';
select event_id::text || '|' || revision::text || '|' || changed::text
from public.brownsync_edit_user_event(
  '83000000-0000-4000-8000-000000000003',
  '$edit_event_id',
  0,
  '{"title":"Edit race winner"}'::jsonb
);
select pg_catalog.pg_advisory_lock(516003);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(516003);
SQL
edit_holder_pid=$!
child_pids+=("$edit_holder_pid")
wait_for_advisory_marker 516003

psql_task >"$race_tmp/edit-waiter.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-edit-waiter';
select *
from public.brownsync_edit_user_event(
  '83000000-0000-4000-8000-000000000003',
  '$edit_event_id',
  0,
  '{"title":"Edit race loser"}'::jsonb
);
commit;
SQL
edit_waiter_pid=$!
child_pids+=("$edit_waiter_pid")
wait_for_lock_wait brownsync-task5d-edit-waiter
wait_success "$edit_holder_pid" "$race_tmp/edit-holder.log"
wait_failure \
  "$edit_waiter_pid" \
  "$race_tmp/edit-waiter.log" \
  BROWNSYNC_USER_EVENT_REVISION_CONFLICT

if ! grep -Eq '\|1\|true$' "$race_tmp/edit-holder.log" \
   || [[ $(psql_task -c "
     select revision::text || '|' || changed::text
     from public.brownsync_edit_user_event(
       '83000000-0000-4000-8000-000000000003',
       '$edit_event_id',
       0,
       '{\"title\":\"Edit race winner\"}'::jsonb
     )
   ") != '1|false' ]]; then
  echo "optimistic edit race or stale identical retry was incorrect" >&2
  exit 1
fi

delete_event_id=$(psql_task -c "
  select event_id
  from public.brownsync_create_user_event(
    '83000000-0000-4000-8000-000000000003',
    '83100000-0000-4000-8000-000000000005',
    null,
    'Delete versus edit',
    null,
    '2031-01-04 12:00:00+00',
    null,
    'arts',
    null,
    'chk-user-event-race-place',
    null
  )
")

# Revision-free delete wins safely; a concurrent edit waits and then sees the
# soft-deleted event as not found.
psql_task >"$race_tmp/delete-holder.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-delete-holder';
select event_id::text || '|' || revision::text || '|' || changed::text
from public.brownsync_delete_user_event(
  '83000000-0000-4000-8000-000000000003',
  '$delete_event_id'
);
select pg_catalog.pg_advisory_lock(516004);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(516004);
SQL
delete_holder_pid=$!
child_pids+=("$delete_holder_pid")
wait_for_advisory_marker 516004

psql_task >"$race_tmp/delete-edit-waiter.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-delete-edit-waiter';
select *
from public.brownsync_edit_user_event(
  '83000000-0000-4000-8000-000000000003',
  '$delete_event_id',
  0,
  '{"title":"Edit must lose"}'::jsonb
);
commit;
SQL
delete_edit_waiter_pid=$!
child_pids+=("$delete_edit_waiter_pid")
wait_for_lock_wait brownsync-task5d-delete-edit-waiter
wait_success "$delete_holder_pid" "$race_tmp/delete-holder.log"
wait_failure \
  "$delete_edit_waiter_pid" \
  "$race_tmp/delete-edit-waiter.log" \
  BROWNSYNC_USER_EVENT_NOT_FOUND

if ! grep -Eq '\|1\|true$' "$race_tmp/delete-holder.log" \
   || [[ $(psql_task -c "
     select status = 'canceled'
       and deleted_at is not null
       and revision = 1
     from public.user_events
     where id = '$delete_event_id'
   ") != t ]]; then
  echo "delete-vs-edit did not converge to one soft deletion" >&2
  exit 1
fi

# Removing organization authority commits first. The blocked create refreshes
# authority after the organization lock and fails without an event or quota.
psql_task >"$race_tmp/remove-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-remove-holder';
select changed::text
from public.brownsync_remove_org_admin(
  '83000000-0000-4000-8000-000000000004',
  'chk-user-event-race-org',
  '83000000-0000-4000-8000-000000000005'
);
select pg_catalog.pg_advisory_lock(516005);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(516005);
SQL
remove_holder_pid=$!
child_pids+=("$remove_holder_pid")
wait_for_advisory_marker 516005

psql_task >"$race_tmp/remove-create-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-remove-create-waiter';
select *
from public.brownsync_create_user_event(
  '83000000-0000-4000-8000-000000000005',
  '83100000-0000-4000-8000-000000000006',
  'chk-user-event-race-org',
  'Removed admin must not create',
  null,
  '2031-01-05 12:00:00+00',
  null,
  'club',
  null,
  'chk-user-event-race-place',
  null
);
commit;
SQL
remove_create_waiter_pid=$!
child_pids+=("$remove_create_waiter_pid")
wait_for_lock_wait brownsync-task5d-remove-create-waiter
wait_success "$remove_holder_pid" "$race_tmp/remove-holder.log"
wait_failure \
  "$remove_create_waiter_pid" \
  "$race_tmp/remove-create-waiter.log" \
  BROWNSYNC_USER_EVENT_FORBIDDEN

if ! grep -Fxq true "$race_tmp/remove-holder.log" \
   || [[ $(psql_task -c "
     select
       not exists (
         select 1
         from public.user_events
         where client_request_id =
           '83100000-0000-4000-8000-000000000006'
       )
       and not exists (
         select 1
         from public.user_event_create_limits
         where user_id =
           '83000000-0000-4000-8000-000000000005'
       )
   ") != t ]]; then
  echo "admin-removal/create race retained unauthorized state" >&2
  exit 1
fi

# A disabling UPDATE holds a row lock that conflicts with the create path's
# required FOR SHARE lock. A third NOWAIT session proves the barrier. Once the
# disable commits, the waiter refreshes state and fails without side effects.
psql_task >"$race_tmp/control-create-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local application_name = 'brownsync-task5d-control-create-holder';
update public.user_event_controls
set posting_enabled = false,
    updated_at = pg_catalog.clock_timestamp()
where id = true;
select pg_catalog.pg_advisory_lock(516006);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(516006);
SQL
control_create_holder_pid=$!
child_pids+=("$control_create_holder_pid")
wait_for_advisory_marker 516006

psql_task >"$race_tmp/control-create-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-control-create-waiter';
select *
from public.brownsync_create_user_event(
  '83000000-0000-4000-8000-000000000008',
  '83100000-0000-4000-8000-000000000007',
  null,
  'Switch-blocked create',
  null,
  '2031-01-06 12:00:00+00',
  null,
  'social',
  null,
  'chk-user-event-race-place',
  null
);
commit;
SQL
control_create_waiter_pid=$!
child_pids+=("$control_create_waiter_pid")
wait_for_lock_wait brownsync-task5d-control-create-waiter
expect_nowait_conflict \
  "control/create FOR SHARE barrier" \
  "select id from public.user_event_controls where id = true for share nowait" \
  "$race_tmp/control-create-probe.log"
wait_success \
  "$control_create_holder_pid" \
  "$race_tmp/control-create-holder.log"
wait_failure \
  "$control_create_waiter_pid" \
  "$race_tmp/control-create-waiter.log" \
  BROWNSYNC_USER_EVENT_POSTING_DISABLED

if [[ $(psql_task -c "
  select
    not exists (
      select 1
      from public.user_events
      where client_request_id =
        '83100000-0000-4000-8000-000000000007'
    )
    and not exists (
      select 1
      from public.user_event_create_limits
      where user_id = '83000000-0000-4000-8000-000000000008'
    )
") != t ]]; then
  echo "control/create barrier retained disabled state" >&2
  exit 1
fi

psql_task -c "
  update public.user_event_controls
  set posting_enabled = true,
      updated_at = pg_catalog.clock_timestamp()
  where id = true
" >/dev/null

switch_edit_event_id=$(psql_task -c "
  select event_id
  from public.brownsync_create_user_event(
    '83000000-0000-4000-8000-000000000008',
    '83100000-0000-4000-8000-000000000008',
    null,
    'Switch edit original',
    null,
    '2031-01-07 12:00:00+00',
    null,
    'social',
    null,
    'chk-user-event-race-place',
    null
  )
")

# The same FOR SHARE control barrier protects edit: disable begins first, the
# edit blocks, then observes disabled rather than committing stale enablement.
psql_task >"$race_tmp/control-edit-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local application_name = 'brownsync-task5d-control-edit-holder';
update public.user_event_controls
set posting_enabled = false,
    updated_at = pg_catalog.clock_timestamp()
where id = true;
select pg_catalog.pg_advisory_lock(516007);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(516007);
SQL
control_edit_holder_pid=$!
child_pids+=("$control_edit_holder_pid")
wait_for_advisory_marker 516007

psql_task >"$race_tmp/control-edit-waiter.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-control-edit-waiter';
select *
from public.brownsync_edit_user_event(
  '83000000-0000-4000-8000-000000000008',
  '$switch_edit_event_id',
  0,
  '{"title":"Switch edit must fail"}'::jsonb
);
commit;
SQL
control_edit_waiter_pid=$!
child_pids+=("$control_edit_waiter_pid")
wait_for_lock_wait brownsync-task5d-control-edit-waiter
expect_nowait_conflict \
  "control/edit FOR SHARE barrier" \
  "select id from public.user_event_controls where id = true for share nowait" \
  "$race_tmp/control-edit-probe.log"
wait_success \
  "$control_edit_holder_pid" \
  "$race_tmp/control-edit-holder.log"
wait_failure \
  "$control_edit_waiter_pid" \
  "$race_tmp/control-edit-waiter.log" \
  BROWNSYNC_USER_EVENT_POSTING_DISABLED

if [[ $(psql_task -c "
  select title = 'Switch edit original' and revision = 0
  from public.user_events
  where id = '$switch_edit_event_id'
") != t ]]; then
  echo "control/edit barrier committed a disabled edit" >&2
  exit 1
fi

psql_task -c "
  update public.user_event_controls
  set posting_enabled = true,
      updated_at = pg_catalog.clock_timestamp()
  where id = true
" >/dev/null

# Three-session account-deletion barrier. The profile blocker lets deletion
# own auth.users first. Create must then wait on actor auth before touching the
# control row; a NOWAIT control probe proves the global lock order.
psql_task >"$race_tmp/profile-blocker.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '40s';
set local application_name = 'brownsync-task5d-profile-blocker';
select id
from public.profiles
where id = '83000000-0000-4000-8000-000000000007'
for update;
select pg_catalog.pg_advisory_lock(516008);
select pg_catalog.pg_sleep(30);
commit;
select pg_catalog.pg_advisory_unlock(516008);
SQL
profile_blocker_pid=$!
child_pids+=("$profile_blocker_pid")
wait_for_advisory_marker 516008

psql_task >"$race_tmp/account-delete-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-account-delete-holder';
delete from auth.users
where id = '83000000-0000-4000-8000-000000000007';
commit;
SQL
account_delete_holder_pid=$!
child_pids+=("$account_delete_holder_pid")
wait_for_lock_wait brownsync-task5d-account-delete-holder
expect_nowait_conflict \
  "account deletion auth barrier" \
  "select id from auth.users where id = '83000000-0000-4000-8000-000000000007' for key share nowait" \
  "$race_tmp/account-auth-probe.log"

psql_task >"$race_tmp/account-create-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5d-account-create-waiter';
select *
from public.brownsync_create_user_event(
  '83000000-0000-4000-8000-000000000007',
  '83100000-0000-4000-8000-000000000009',
  null,
  'Deleted actor must not create',
  null,
  '2031-01-08 12:00:00+00',
  null,
  'social',
  null,
  'chk-user-event-race-place',
  null
);
commit;
SQL
account_create_waiter_pid=$!
child_pids+=("$account_create_waiter_pid")
wait_for_lock_wait brownsync-task5d-account-create-waiter

if [[ $(psql_task -c "
  select id
  from public.user_event_controls
  where id = true
  for update nowait
") != t ]]; then
  echo "create locked control before the actor auth barrier" >&2
  exit 1
fi

if [[ $(psql_task -c "
  select pg_catalog.pg_terminate_backend(pid)
  from pg_catalog.pg_stat_activity
  where application_name = 'brownsync-task5d-profile-blocker'
") != t ]]; then
  echo "could not release account-delete profile barrier" >&2
  exit 1
fi
wait_failure \
  "$profile_blocker_pid" \
  "$race_tmp/profile-blocker.log" \
  'terminating connection due to administrator command'
wait_success \
  "$account_delete_holder_pid" \
  "$race_tmp/account-delete-holder.log"
wait_failure \
  "$account_create_waiter_pid" \
  "$race_tmp/account-create-waiter.log" \
  BROWNSYNC_USER_EVENT_UNAUTHORIZED

if [[ $(psql_task -c "
  select
    not exists (
      select 1
      from auth.users
      where id = '83000000-0000-4000-8000-000000000007'
    )
    and not exists (
      select 1
      from public.user_events
      where client_request_id =
        '83100000-0000-4000-8000-000000000009'
    )
    and not exists (
      select 1
      from public.user_event_create_limits
      where user_id = '83000000-0000-4000-8000-000000000007'
    )
") != t ]]; then
  echo "account-delete/create barrier did not drain cleanly" >&2
  exit 1
fi

echo "0016_user_events_race: all deterministic concurrency races passed"
