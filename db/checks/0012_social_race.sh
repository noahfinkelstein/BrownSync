#!/usr/bin/env bash
# Deterministic two-session checks for Task 4A pair/presence serialization.
set -euo pipefail

if [[ ${BROWNSYNC_DISPOSABLE_SOCIAL_RACE:-} != 1 ]]; then
  echo "refusing social race fixtures without BROWNSYNC_DISPOSABLE_SOCIAL_RACE=1" >&2
  exit 2
fi

database_url=${1:-postgresql://postgres@localhost:5432/postgres}
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
delete from auth.users
where id in (
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000003',
  '70000000-0000-4000-8000-000000000004'
);
delete from public.places where id = 'chk-race-place';
SQL
  fi
  if [[ -n ${race_tmp:-} && -d $race_tmp ]]; then
    rm -r -- "$race_tmp"
  fi
}
trap cleanup EXIT

claim_a='{"sub":"70000000-0000-4000-8000-000000000001","email":"chk-race-a@brown.edu","app_metadata":{"provider":"google"}}'
claim_b='{"sub":"70000000-0000-4000-8000-000000000002","email":"chk-race-b@brown.edu","app_metadata":{"provider":"google"}}'
claim_c='{"sub":"70000000-0000-4000-8000-000000000003","email":"chk-race-c@brown.edu","app_metadata":{"provider":"google"}}'
claim_d='{"sub":"70000000-0000-4000-8000-000000000004","email":"chk-race-d@brown.edu","app_metadata":{"provider":"google"}}'

collision_count=$(psql_task -c "
  select
    (select count(*)
     from auth.users
     where id in (
       '70000000-0000-4000-8000-000000000001',
       '70000000-0000-4000-8000-000000000002',
       '70000000-0000-4000-8000-000000000003',
       '70000000-0000-4000-8000-000000000004'
     ))
    +
    (select count(*) from public.places where id = 'chk-race-place')
")
if [[ $collision_count != 0 ]]; then
  echo "refusing to overwrite pre-existing Task 4A race fixtures" >&2
  exit 2
fi
cleanup_armed=true

psql_task <<'SQL'
insert into public.places (id, name, aliases, kind, lat, lng, source)
values (
  'chk-race-place',
  'chk-race-place',
  '{}',
  'other',
  41.0,
  -71.0,
  'chk-race'
);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  (
    '70000000-0000-4000-8000-000000000001',
    'chk-race-a@brown.edu',
    '{"full_name":"chk-race-a"}',
    '{"provider":"google"}'
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    'chk-race-b@brown.edu',
    '{"full_name":"chk-race-b"}',
    '{"provider":"google"}'
  ),
  (
    '70000000-0000-4000-8000-000000000003',
    'chk-race-c@brown.edu',
    '{"full_name":"chk-race-c"}',
    '{"provider":"google"}'
  ),
  (
    '70000000-0000-4000-8000-000000000004',
    'chk-race-d@brown.edu',
    '{"full_name":"chk-race-d"}',
    '{"provider":"google"}'
  );
SQL

wait_for_advisory_lock() {
  local lock_key=$1
  local attempt
  local held
  for attempt in {1..100}; do
    held=$(psql_task -c "select not pg_try_advisory_lock($lock_key)")
    if [[ $held == t ]]; then
      return 0
    fi
    sleep 0.05
  done
  echo "timed out waiting for advisory marker $lock_key" >&2
  return 1
}

expect_rpc_failure() {
  local expected=$1
  local claims=$2
  local statement=$3
  local output_file=$4
  local status
  set +e
  psql_task >"$output_file" 2>&1 <<SQL
begin;
set local statement_timeout = '10s';
set local role authenticated;
select set_config('request.jwt.claims', '$claims', true);
$statement
commit;
SQL
  status=$?
  set -e
  if [[ $status -eq 0 ]]; then
    echo "expected RPC failure $expected, but call succeeded" >&2
    return 1
  fi
  if ! grep -Fq "$expected" "$output_file"; then
    echo "RPC failed without expected $expected" >&2
    sed -n '1,120p' "$output_file" >&2
    return 1
  fi
}

# Remove versus grant: session 2 starts only after session 1 completed the
# uncommitted remove and published its advisory marker. It must wait for the
# canonical profile locks, then fail after the removal commits.
psql_task <<'SQL'
insert into public.friendships (requester, addressee, status, responded_at)
values (
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002',
  'accepted',
  clock_timestamp()
);
insert into public.presence_shares (owner, viewer, created_at, expires_at)
values (
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002',
  clock_timestamp(),
  clock_timestamp() + interval '1 day'
);
SQL

psql_task >"$race_tmp/remove-holder.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '10s';
set local lock_timeout = '8s';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_a', true);
select public.remove_friend('70000000-0000-4000-8000-000000000002');
select pg_advisory_lock(412001);
select pg_sleep(2);
commit;
select pg_advisory_unlock(412001);
SQL
remove_holder_pid=$!
child_pids+=("$remove_holder_pid")
wait_for_advisory_lock 412001
expect_rpc_failure \
  BROWNSYNC_SHARE_FRIEND_REQUIRED \
  "$claim_a" \
  "select public.set_presence_share('70000000-0000-4000-8000-000000000002', clock_timestamp() + interval '1 day');" \
  "$race_tmp/remove-share.log"
wait "$remove_holder_pid"

if [[ $(psql_task -c "
  select
    (select count(*) from public.friendships
      where requester in (
        '70000000-0000-4000-8000-000000000001',
        '70000000-0000-4000-8000-000000000002'
      )
      and addressee in (
        '70000000-0000-4000-8000-000000000001',
        '70000000-0000-4000-8000-000000000002'
      ))
    +
    (select count(*) from public.presence_shares
      where owner = '70000000-0000-4000-8000-000000000001'
        and viewer = '70000000-0000-4000-8000-000000000002')
") != 0 ]]; then
  echo "remove/share race left pair or stale share" >&2
  exit 1
fi

# Block versus grant has the same serialization requirement, and an already
# blocked row cannot have blocked_by stolen by the other party.
psql_task <<'SQL'
insert into public.friendships (requester, addressee, status, responded_at)
values (
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002',
  'accepted',
  clock_timestamp()
);
insert into public.presence_shares (owner, viewer, created_at, expires_at)
values (
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002',
  clock_timestamp(),
  clock_timestamp() + interval '1 day'
);
SQL

psql_task >"$race_tmp/block-holder.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '10s';
set local lock_timeout = '8s';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_a', true);
select public.block_user('70000000-0000-4000-8000-000000000002');
select pg_advisory_lock(412002);
select pg_sleep(4);
commit;
select pg_advisory_unlock(412002);
SQL
block_holder_pid=$!
child_pids+=("$block_holder_pid")
wait_for_advisory_lock 412002

psql_task >"$race_tmp/block-owner.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '10s';
set local lock_timeout = '8s';
set local application_name = 'brownsync-task4a-competing-blocker';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_b', true);
select public.block_user('70000000-0000-4000-8000-000000000001');
commit;
SQL
competing_blocker_pid=$!
child_pids+=("$competing_blocker_pid")
competing_block_wait_observed=false
for attempt in {1..100}; do
  if [[ $(psql_task -c "
    select exists (
      select 1
      from pg_stat_activity
      where application_name = 'brownsync-task4a-competing-blocker'
        and wait_event_type = 'Lock'
    )
  ") == t ]]; then
    competing_block_wait_observed=true
    break
  fi
  sleep 0.05
done
if [[ $competing_block_wait_observed != true ]]; then
  echo "competing blocker never waited on the uncommitted block" >&2
  exit 1
fi

expect_rpc_failure \
  BROWNSYNC_SHARE_FRIEND_REQUIRED \
  "$claim_a" \
  "select public.set_presence_share('70000000-0000-4000-8000-000000000002', clock_timestamp() + interval '1 day');" \
  "$race_tmp/block-share.log"
wait "$block_holder_pid"

set +e
wait "$competing_blocker_pid"
competing_blocker_status=$?
set -e
if [[ $competing_blocker_status -eq 0 ]] \
   || ! grep -Fq BROWNSYNC_FRIEND_PAIR_BLOCKED "$race_tmp/block-owner.log"; then
  echo "competing blocker did not fail with stable blocked-pair ownership" >&2
  sed -n '1,120p' "$race_tmp/block-owner.log" >&2
  exit 1
fi

if [[ $(psql_task -c "
  select count(*) = 1
  from public.friendships
  where status = 'blocked'
    and blocked_by = '70000000-0000-4000-8000-000000000001'
") != t ]]; then
  echo "blocked ownership changed during competing block" >&2
  exit 1
fi

psql_task <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '$claim_a', true);
select public.unblock_user('70000000-0000-4000-8000-000000000002');
commit;
SQL

# Reverse requests serialize without deadlock. Session C publishes a marker
# only after its request has created the pending row but before commit. D then
# starts the reverse request, waits for the canonical profile locks, and gets
# the stable reverse-pending result after C commits.
psql_task >"$race_tmp/reverse-c.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '10s';
set local lock_timeout = '8s';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_c', true);
select public.request_friend('70000000-0000-4000-8000-000000000004');
select pg_advisory_lock(412007);
select pg_sleep(2);
commit;
select pg_advisory_unlock(412007);
SQL
reverse_c_pid=$!
child_pids+=("$reverse_c_pid")
wait_for_advisory_lock 412007
expect_rpc_failure \
  BROWNSYNC_FRIEND_REVERSE_PENDING \
  "$claim_d" \
  "select public.request_friend('70000000-0000-4000-8000-000000000003');" \
  "$race_tmp/reverse-d.log"
wait "$reverse_c_pid"

if [[ $(psql_task -c "
  select count(*)
  from public.friendships
  where requester in (
    '70000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000004'
  )
    and addressee in (
      '70000000-0000-4000-8000-000000000003',
      '70000000-0000-4000-8000-000000000004'
    )
") != 1 ]]; then
  echo "reverse request race did not leave one pending row" >&2
  exit 1
fi
psql_task -c "
  delete from public.friendships
  where requester in (
    '70000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000004'
  )
    and addressee in (
      '70000000-0000-4000-8000-000000000003',
      '70000000-0000-4000-8000-000000000004'
    )
"

# Accept versus block must produce one legal serialized terminal state. Session
# 1 accepts a pending request and holds the canonical pair locks uncommitted;
# session 2 then waits, observes accepted, and converts it to caller-owned block.
psql_task <<'SQL'
delete from public.social_write_limits
where user_id in (
  '70000000-0000-4000-8000-000000000003',
  '70000000-0000-4000-8000-000000000004'
);
insert into public.friendships (requester, addressee, status)
values (
  '70000000-0000-4000-8000-000000000003',
  '70000000-0000-4000-8000-000000000004',
  'pending'
);
insert into public.presence_shares (owner, viewer, created_at, expires_at)
values
  (
    '70000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000004',
    clock_timestamp(),
    clock_timestamp() + interval '1 day'
  ),
  (
    '70000000-0000-4000-8000-000000000004',
    '70000000-0000-4000-8000-000000000003',
    clock_timestamp(),
    clock_timestamp() + interval '1 day'
  );
SQL

psql_task >"$race_tmp/accept-holder.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '10s';
set local lock_timeout = '8s';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_d', true);
select public.respond_friend(
  '70000000-0000-4000-8000-000000000003',
  true
);
select pg_advisory_lock(412005);
select pg_sleep(2);
commit;
select pg_advisory_unlock(412005);
SQL
accept_holder_pid=$!
child_pids+=("$accept_holder_pid")
wait_for_advisory_lock 412005
psql_task >"$race_tmp/accept-block.log" 2>&1 <<SQL
begin;
set local statement_timeout = '10s';
set local lock_timeout = '8s';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_c', true);
select public.block_user('70000000-0000-4000-8000-000000000004');
commit;
SQL
wait "$accept_holder_pid"

if [[ $(psql_task -c "
  select
    (select count(*) = 1
     from public.friendships
     where requester in (
       '70000000-0000-4000-8000-000000000003',
       '70000000-0000-4000-8000-000000000004'
     )
       and addressee in (
         '70000000-0000-4000-8000-000000000003',
         '70000000-0000-4000-8000-000000000004'
       )
       and status = 'blocked'
       and blocked_by = '70000000-0000-4000-8000-000000000003')
    and
    (select count(*) = 0
     from public.presence_shares
     where owner in (
       '70000000-0000-4000-8000-000000000003',
       '70000000-0000-4000-8000-000000000004'
     )
       and viewer in (
         '70000000-0000-4000-8000-000000000003',
         '70000000-0000-4000-8000-000000000004'
       ))
") != t ]]; then
  echo "accept/block race did not leave one caller-owned block with no shares" >&2
  exit 1
fi
psql_task -c "
  delete from public.friendships
  where requester in (
    '70000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000004'
  )
    and addressee in (
      '70000000-0000-4000-8000-000000000003',
      '70000000-0000-4000-8000-000000000004'
    );
  delete from public.social_write_limits
  where user_id in (
    '70000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000004'
  );
"

# Two first limited writes for the same actor race the internal bucket's first
# row creation. create_checkin takes only compatible prerequisite locks, so
# unlike pair RPCs this reaches the first-row conflict concurrently. Session 1
# marks only after creating the bucket row but before commit; session 2 must
# then recover from that uncommitted unique-row conflict. Both valid check-ins
# must commit and the shared count must be 2.
psql_task -c "
  delete from public.social_write_limits
  where user_id = '70000000-0000-4000-8000-000000000001'
"
psql_task >"$race_tmp/limit-b.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '10s';
set local lock_timeout = '8s';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_a', true);
select public.create_checkin(
  'chk-race-place',
  'chk-race-limit-one',
  interval '1 hour'
);
select pg_advisory_lock(412006);
select pg_sleep(2);
commit;
select pg_advisory_unlock(412006);
SQL
limit_b_pid=$!
child_pids+=("$limit_b_pid")
wait_for_advisory_lock 412006
set +e
psql_task >"$race_tmp/limit-c.log" 2>&1 <<SQL
begin;
set local statement_timeout = '10s';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_a', true);
select public.create_checkin(
  'chk-race-place',
  'chk-race-limit-two',
  interval '1 hour'
);
commit;
SQL
limit_c_status=$?
wait "$limit_b_pid"
limit_b_status=$?
set -e
if [[ $limit_b_status -ne 0 || $limit_c_status -ne 0 ]]; then
  echo "first limiter-row race rejected a valid check-in" >&2
  sed -n '1,120p' "$race_tmp/limit-b.log" >&2
  sed -n '1,120p' "$race_tmp/limit-c.log" >&2
  exit 1
fi
if [[ $(psql_task -c "
  select
    (select count = 2
     from public.social_write_limits
     where user_id = '70000000-0000-4000-8000-000000000001'
       and bucket = 'shared')
    and
    (select count(*) = 2
     from public.checkins
     where owner = '70000000-0000-4000-8000-000000000001'
       and note in ('chk-race-limit-one', 'chk-race-limit-two'))
") != t ]]; then
  echo "first limiter-row race did not retain two writes and count=2" >&2
  exit 1
fi
psql_task -c "
  delete from public.checkins
  where owner = '70000000-0000-4000-8000-000000000001'
    and note in ('chk-race-limit-one', 'chk-race-limit-two');
  delete from public.social_write_limits
  where user_id = '70000000-0000-4000-8000-000000000001';
"

# If the transaction owning the first limiter row rolls back, a blocked waiter
# must become the true first successful writer and rebase the window to its
# post-wait lock time (rather than inherit its stale pre-wait insert sample).
psql_task >"$race_tmp/limit-rollback-holder.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '15s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task4a-limit-rollback-holder';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_a', true);
select public.create_checkin(
  'chk-race-place',
  'chk-race-rollback-holder',
  interval '1 hour'
);
select pg_advisory_lock(412009);
select pg_sleep(12);
commit;
SQL
limit_rollback_holder_pid=$!
child_pids+=("$limit_rollback_holder_pid")
wait_for_advisory_lock 412009
psql_task >"$race_tmp/limit-rollback-waiter.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '15s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task4a-limit-rollback-waiter';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_a', true);
select public.create_checkin(
  'chk-race-place',
  'chk-race-rollback-waiter',
  interval '1 hour'
);
commit;
SQL
limit_rollback_waiter_pid=$!
child_pids+=("$limit_rollback_waiter_pid")

limit_rollback_wait_observed=false
for attempt in {1..200}; do
  if [[ $(psql_task -c "
    select exists (
      select 1
      from pg_stat_activity
      where application_name = 'brownsync-task4a-limit-rollback-waiter'
        and wait_event_type = 'Lock'
    )
  ") == t ]]; then
    limit_rollback_wait_observed=true
    break
  fi
  sleep 0.05
done
if [[ $limit_rollback_wait_observed != true ]]; then
  echo "first-row rollback waiter never entered a lock wait" >&2
  exit 1
fi
limit_rollback_release_at=$(psql_task -c "select clock_timestamp()")
if [[ $(psql_task -c "
  select pg_terminate_backend(pid)
  from pg_stat_activity
  where application_name = 'brownsync-task4a-limit-rollback-holder'
") != t ]]; then
  echo "could not roll back the uncommitted first limiter row" >&2
  exit 1
fi

set +e
wait "$limit_rollback_holder_pid"
limit_rollback_holder_status=$?
wait "$limit_rollback_waiter_pid"
limit_rollback_waiter_status=$?
set -e
if [[ $limit_rollback_holder_status -eq 0 || $limit_rollback_waiter_status -ne 0 ]]; then
  echo "first-row rollback race did not leave the waiter as sole success" >&2
  sed -n '1,120p' "$race_tmp/limit-rollback-holder.log" >&2
  sed -n '1,120p' "$race_tmp/limit-rollback-waiter.log" >&2
  exit 1
fi
if [[ $(psql_task -c "
  select
    coalesce((
      select count = 1
        and window_started_at >= '$limit_rollback_release_at'::timestamptz
      from public.social_write_limits
      where user_id = '70000000-0000-4000-8000-000000000001'
        and bucket = 'shared'
    ), false)
    and
    (select count(*) = 0
     from public.checkins
     where note = 'chk-race-rollback-holder')
    and
    (select count(*) = 1
     from public.checkins
     where note = 'chk-race-rollback-waiter')
") != t ]]; then
  echo "first-row rollback waiter inherited a stale window or wrong write state" >&2
  exit 1
fi
psql_task -c "
  delete from public.checkins
  where owner = '70000000-0000-4000-8000-000000000001'
    and note = 'chk-race-rollback-waiter';
  delete from public.social_write_limits
  where user_id = '70000000-0000-4000-8000-000000000001';
"

# A limiter row may be held across the fixed-window boundary. The waiter must
# evaluate time after acquiring the row lock, not reuse a stale pre-wait clock
# sample and falsely reject an otherwise valid write.
psql_task -c "
  insert into public.social_write_limits (
    user_id,
    bucket,
    window_started_at,
    count
  ) values (
    '70000000-0000-4000-8000-000000000001',
    'shared',
    clock_timestamp() - interval '55 seconds',
    20
  )
"
psql_task >"$race_tmp/limit-boundary-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '15s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task4a-limit-holder';
select 1
from public.social_write_limits
where user_id = '70000000-0000-4000-8000-000000000001'
  and bucket = 'shared'
for update;
select pg_advisory_lock(412008);
select pg_sleep(12);
commit;
SQL
limit_boundary_holder_pid=$!
child_pids+=("$limit_boundary_holder_pid")
wait_for_advisory_lock 412008
if [[ $(psql_task -c "
  select clock_timestamp() < window_started_at + interval '60 seconds'
  from public.social_write_limits
  where user_id = '70000000-0000-4000-8000-000000000001'
    and bucket = 'shared'
") != t ]]; then
  echo "limiter boundary waiter did not begin before the boundary" >&2
  exit 1
fi
psql_task >"$race_tmp/limit-boundary-waiter.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '15s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task4a-limit-waiter';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_a', true);
select public.create_checkin(
  'chk-race-place',
  'chk-race-boundary-after-wait',
  interval '1 hour'
);
commit;
SQL
limit_boundary_waiter_pid=$!
child_pids+=("$limit_boundary_waiter_pid")

limit_wait_observed=false
for attempt in {1..200}; do
  if [[ $(psql_task -c "
    select exists (
      select 1
      from pg_stat_activity
      where application_name = 'brownsync-task4a-limit-waiter'
        and wait_event_type = 'Lock'
    )
  ") == t ]]; then
    limit_wait_observed=true
    break
  fi
  sleep 0.05
done
if [[ $limit_wait_observed != true ]]; then
  echo "limiter boundary waiter never entered a lock wait" >&2
  exit 1
fi
if [[ $(psql_task -c "
  select clock_timestamp() < window_started_at + interval '60 seconds'
  from public.social_write_limits
  where user_id = '70000000-0000-4000-8000-000000000001'
    and bucket = 'shared'
") != t ]]; then
  echo "limiter waiter entered its lock wait after the boundary" >&2
  exit 1
fi

limit_boundary_crossed=false
for attempt in {1..200}; do
  if [[ $(psql_task -c "
    select clock_timestamp() >= window_started_at + interval '60 seconds'
    from public.social_write_limits
    where user_id = '70000000-0000-4000-8000-000000000001'
      and bucket = 'shared'
  ") == t ]]; then
    limit_boundary_crossed=true
    break
  fi
  sleep 0.05
done
if [[ $limit_boundary_crossed != true ]]; then
  echo "timed out waiting to cross the limiter boundary" >&2
  exit 1
fi
if [[ $(psql_task -c "
  select pg_terminate_backend(pid)
  from pg_stat_activity
  where application_name = 'brownsync-task4a-limit-holder'
") != t ]]; then
  echo "could not terminate the limiter boundary lock holder" >&2
  exit 1
fi

set +e
wait "$limit_boundary_holder_pid"
limit_boundary_holder_status=$?
wait "$limit_boundary_waiter_pid"
limit_boundary_waiter_status=$?
set -e
if [[ $limit_boundary_waiter_status -ne 0 || $limit_boundary_holder_status -eq 0 ]]; then
  echo "limiter waiter did not reopen after crossing the boundary under lock" >&2
  sed -n '1,120p' "$race_tmp/limit-boundary-holder.log" >&2
  sed -n '1,120p' "$race_tmp/limit-boundary-waiter.log" >&2
  exit 1
fi
if [[ $(psql_task -c "
  select
    (select count = 1
     from public.social_write_limits
     where user_id = '70000000-0000-4000-8000-000000000001'
       and bucket = 'shared')
    and
    (select count(*) = 1
     from public.checkins
     where owner = '70000000-0000-4000-8000-000000000001'
       and note = 'chk-race-boundary-after-wait')
") != t ]]; then
  echo "limiter waiter did not reset the elapsed window to one write" >&2
  exit 1
fi
psql_task -c "
  delete from public.checkins
  where owner = '70000000-0000-4000-8000-000000000001'
    and note = 'chk-race-boundary-after-wait';
  delete from public.social_write_limits
  where user_id = '70000000-0000-4000-8000-000000000001';
"

# A stale publisher that starts after an uncommitted ghost=true must wait and
# then fail; ghost remains an expired coordinate-free sentinel.
psql_task <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '$claim_a', true);
select public.set_ghost(false);
select public.set_presence(
  'chk-race-place',
  'free',
  'chk-race-before-ghost',
  interval '1 hour'
);
commit;
SQL
psql_task -c "
  update public.social_write_limits
  set last_success_at = clock_timestamp() - interval '61 seconds'
  where user_id = '70000000-0000-4000-8000-000000000001'
    and bucket = 'presence'
"
psql_task >"$race_tmp/ghost-holder.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '10s';
set local lock_timeout = '8s';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_a', true);
select public.set_ghost(true);
select pg_advisory_lock(412003);
select pg_sleep(2);
commit;
select pg_advisory_unlock(412003);
SQL
ghost_holder_pid=$!
child_pids+=("$ghost_holder_pid")
wait_for_advisory_lock 412003
expect_rpc_failure \
  BROWNSYNC_PRESENCE_GHOSTED \
  "$claim_a" \
  "select public.set_presence('chk-race-place', 'free', 'chk-race-stale-publish', interval '1 hour');" \
  "$race_tmp/ghost-publish.log"
wait "$ghost_holder_pid"
if [[ $(psql_task -c "
  select count(*) = 1
  from public.presence_state
  where user_id = '70000000-0000-4000-8000-000000000001'
    and ghost
    and place_id is null
    and status is null
    and note is null
    and expires_at <= clock_timestamp()
") != t ]]; then
  echo "ghost/set race did not retain an expired coordinate-free opt-out" >&2
  exit 1
fi

# clear_presence also leaves a sentinel row. A later set blocks behind clear,
# then serially replaces that one row rather than racing a delete/reinsert.
psql_task -c "
  update public.social_write_limits
  set window_started_at = clock_timestamp() - interval '61 seconds',
      count = 0,
      last_success_at = case
        when bucket = 'presence'
          then clock_timestamp() - interval '61 seconds'
        else last_success_at
      end
  where user_id = '70000000-0000-4000-8000-000000000001'
"
psql_task <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '$claim_a', true);
select public.set_ghost(false);
commit;
SQL
psql_task >"$race_tmp/clear-holder.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '10s';
set local lock_timeout = '8s';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_a', true);
select public.clear_presence();
select pg_advisory_lock(412004);
select pg_sleep(2);
commit;
select pg_advisory_unlock(412004);
SQL
clear_holder_pid=$!
child_pids+=("$clear_holder_pid")
wait_for_advisory_lock 412004
psql_task >"$race_tmp/clear-publish.log" 2>&1 <<SQL
begin;
set local statement_timeout = '10s';
set local role authenticated;
select set_config('request.jwt.claims', '$claim_a', true);
select public.set_presence(
  'chk-race-place',
  'studying',
  'chk-race-after-clear',
  interval '1 hour'
);
commit;
SQL
wait "$clear_holder_pid"
if [[ $(psql_task -c "
  select count(*) = 1
  from public.presence_state
  where user_id = '70000000-0000-4000-8000-000000000001'
    and not ghost
    and place_id = 'chk-race-place'
    and note = 'chk-race-after-clear'
") != t ]]; then
  echo "clear/set race did not serialize onto one state row" >&2
  exit 1
fi

echo "Task 4A two-session social race checks passed."
