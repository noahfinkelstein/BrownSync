#!/usr/bin/env bash
# Deterministic multi-session checks for the native Brown-only board.
set -euo pipefail

if [[ ${BROWNSYNC_DISPOSABLE_BOARD_RACE:-} != 1 ]]; then
  echo "refusing board race fixtures without BROWNSYNC_DISPOSABLE_BOARD_RACE=1" >&2
  exit 2
fi

database_url=${1:-postgresql://postgres:postgres@localhost:5432/postgres}
race_tmp=$(mktemp -d)
cleanup_armed=false
child_pids=()

psql_task() { psql -X "$database_url" -v ON_ERROR_STOP=1 -qAt "$@"; }

cleanup() {
  local pid
  for pid in ${child_pids[@]+"${child_pids[@]}"}; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  if [[ $cleanup_armed == true ]]; then
    psql_task >/dev/null 2>&1 <<'SQL' || true
delete from public.board_moderation_actions
where moderator_user_id::text like 'b0000000-0000-4000-8000-00000000000_'
   or target_id::text like 'b1000000-0000-4000-8000-%'
   or target_id::text like 'b7000000-0000-4000-8000-%';
delete from public.board_appeals
where id::text like 'b7000000-0000-4000-8000-%'
   or author_token in (repeat('a',64),repeat('7',64),repeat('8',64));
delete from public.board_bans
where created_by::text like 'b0000000-0000-4000-8000-00000000000_';
delete from public.board_posts
where id::text like 'b1000000-0000-4000-8000-%'
   or client_request_id::text like 'b5000000-0000-4000-8000-%';
delete from public.board_rate_limits
where author_token in (
  repeat('a',64),repeat('b',64),repeat('c',64),repeat('d',64),
  repeat('e',64),repeat('f',64),repeat('7',64),repeat('8',64)
);
delete from public.board_account_deletion_fences
where author_token in (repeat('7',64),repeat('8',64));
delete from auth.users
where id::text like 'b0000000-0000-4000-8000-00000000000_';
SQL
  fi
  rm -r -- "$race_tmp"
}
trap cleanup EXIT

wait_for_marker() {
  local key=$1 held attempt
  for attempt in {1..160}; do
    held=$(psql_task -c \
      "select not pg_catalog.pg_try_advisory_lock($key)")
    [[ $held == t ]] && return
    sleep 0.025
  done
  echo "holder never reached marker $key" >&2
  exit 1
}

wait_for_lock_wait() {
  local app=$1 waiting attempt
  for attempt in {1..160}; do
    waiting=$(psql_task -c "
      select exists(
        select 1 from pg_catalog.pg_stat_activity
        where application_name='$app' and wait_event_type='Lock'
      )")
    [[ $waiting == t ]] && return
    sleep 0.025
  done
  echo "$app never waited on a real board lock" >&2
  exit 1
}

pair() {
  local label=$1 key=$2 left=$3 right=$4 mode=$5
  local lo="$race_tmp/$label.left" ro="$race_tmp/$label.right"
  local app="board-$label-waiter"
  (
    printf '%s\n' "begin; set local statement_timeout='5s'; set local lock_timeout='4s';" "$left" \
      "select pg_catalog.pg_advisory_xact_lock($key);" \
      "select pg_catalog.pg_sleep(0.8); commit;" |
      psql_task >"$lo" 2>&1
  ) &
  local lp=$!
  child_pids+=("$lp")
  wait_for_marker "$key"
  (
    printf '%s\n' "begin; set local statement_timeout='5s'; set local lock_timeout='4s';" "$right" \
      "commit;" | PGAPPNAME="$app" psql_task >"$ro" 2>&1
  ) &
  local rp=$!
  child_pids+=("$rp")
  wait_for_lock_wait "$app"
  local ls rs
  set +e
  wait "$lp"; ls=$?
  wait "$rp"; rs=$?
  set -e
  if [[ $mode == both && ($ls -ne 0 || $rs -ne 0) ]]; then
    echo "$label expected two successes" >&2
    sed -n '1,100p' "$lo" "$ro" >&2
    exit 1
  fi
  if [[ $mode == one ]]; then
    if ! { [[ $ls -eq 0 && $rs -ne 0 ]] ||
           [[ $ls -ne 0 && $rs -eq 0 ]]; }; then
      echo "$label expected one winner" >&2
      sed -n '1,100p' "$lo" "$ro" >&2
      exit 1
    fi
    if ! grep -Eq 'BROWNSYNC_BOARD_(REQUEST|REVISION|TERMINAL|NOT_FOUND|RATE_LIMITED|ACCOUNT_DELETED|BANNED|DISABLED|FORBIDDEN)' "$lo" "$ro"; then
      echo "$label loser lacked a stable board error" >&2
      exit 1
    fi
  fi
}

if [[ $(psql_task -c "
  select pg_catalog.to_regprocedure(
    'public.brownsync_delete_board_account(uuid,text)'
  ) is not null
") != t ]]; then
  echo "BROWNSYNC_BOARD_MIGRATION_MISSING: race owner routines" >&2
  exit 3
fi

if [[ $(psql_task -c "
  select count(*) from auth.users
  where id::text like 'b0000000-0000-4000-8000-00000000000_'
") != 0 ]]; then
  echo "refusing to overwrite pre-existing Task 6 race fixtures" >&2
  exit 2
fi

psql_task <<'SQL'
insert into auth.users (id,email,raw_user_meta_data,raw_app_meta_data)
select
  ('b0000000-0000-4000-8000-00000000000'||n)::uuid,
  'board.race.'||n||'@brown.edu',
  '{"full_name":"Race"}'::jsonb,
  '{"provider":"google"}'::jsonb
from pg_catalog.generate_series(1,8) n;
insert into public.board_moderators(user_id,role) values
 ('b0000000-0000-4000-8000-000000000001','owner'),
 ('b0000000-0000-4000-8000-000000000002','owner');
update public.board_control set enabled=true,auto_hide_threshold=3;
insert into public.board_posts(
 id,author_token,client_request_id,create_fingerprint,title,body
)
select
 ('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 repeat('a',64),
 ('b2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 repeat('1',64),'Race '||n,'Body '||n
from pg_catalog.generate_series(1,15) n;
insert into public.board_comments(
 id,post_id,author_token,client_request_id,create_fingerprint,body
) values (
 'b3000000-0000-4000-8000-000000000001',
 'b1000000-0000-4000-8000-000000000001',
 repeat('b',64),'b4000000-0000-4000-8000-000000000001',
 repeat('2',64),'Comment'
);
SQL
cleanup_armed=true

# Post/comment replay and changed-payload conflict.
pair post_replay 61501 \
 "select * from public.brownsync_create_board_post('b0000000-0000-4000-8000-000000000003',repeat('c',64),1,'b5000000-0000-4000-8000-000000000001',' Same ',' Body ');" \
 "select * from public.brownsync_create_board_post('b0000000-0000-4000-8000-000000000003',repeat('c',64),1,'b5000000-0000-4000-8000-000000000001','Same','Body');" both
if [[ $(grep -hE '\|f$' "$race_tmp"/post_replay.* | wc -l) -ne 1 ||
      $(grep -hE '\|t$' "$race_tmp"/post_replay.* | wc -l) -ne 1 ]]; then
  echo "post replay outputs did not identify one original and one replay" >&2
  exit 1
fi
psql_task -c "do \$\$ begin if (select count(*) from public.board_posts where author_token=repeat('c',64) and client_request_id='b5000000-0000-4000-8000-000000000001')<>1 or (select count from public.board_rate_limits where author_token=repeat('c',64) and bucket='post_hour')<>1 or (select count from public.board_rate_limits where author_token=repeat('c',64) and bucket='post_day')<>1 then raise exception 'post replay charged twice'; end if; end \$\$;"
pair post_conflict 61502 \
 "select * from public.brownsync_create_board_post('b0000000-0000-4000-8000-000000000003',repeat('c',64),1,'b5000000-0000-4000-8000-000000000002',null,'Left');" \
 "select * from public.brownsync_create_board_post('b0000000-0000-4000-8000-000000000003',repeat('c',64),1,'b5000000-0000-4000-8000-000000000002',null,'Right');" one
pair comment_replay 61503 \
 "select * from public.brownsync_create_board_comment('b0000000-0000-4000-8000-000000000004',repeat('d',64),1,'b5000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000001',null,' Same ');" \
 "select * from public.brownsync_create_board_comment('b0000000-0000-4000-8000-000000000004',repeat('d',64),1,'b5000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000001',null,'Same');" both
if [[ $(grep -hE '\|f$' "$race_tmp"/comment_replay.* | wc -l) -ne 1 ||
      $(grep -hE '\|t$' "$race_tmp"/comment_replay.* | wc -l) -ne 1 ]]; then
  echo "comment replay outputs did not identify one original and one replay" >&2
  exit 1
fi
psql_task -c "do \$\$ begin if (select count(*) from public.board_comments where author_token=repeat('d',64) and client_request_id='b5000000-0000-4000-8000-000000000003')<>1 or (select count from public.board_rate_limits where author_token=repeat('d',64) and bucket='comment_hour')<>1 then raise exception 'comment replay charged twice'; end if; end \$\$;"
pair comment_conflict 61518 \
 "select * from public.brownsync_create_board_comment('b0000000-0000-4000-8000-000000000004',repeat('d',64),1,'b5000000-0000-4000-8000-000000000018','b1000000-0000-4000-8000-000000000001',null,'Left');" \
 "select * from public.brownsync_create_board_comment('b0000000-0000-4000-8000-000000000004',repeat('d',64),1,'b5000000-0000-4000-8000-000000000018','b1000000-0000-4000-8000-000000000001',null,'Right');" one

# Opposite votes converge; threshold reporters emit one hide/audit.
pair vote 61504 \
 "select * from public.brownsync_set_board_vote('b0000000-0000-4000-8000-000000000005',repeat('e',64),1,'b1000000-0000-4000-8000-000000000002',null,1);" \
 "select * from public.brownsync_set_board_vote('b0000000-0000-4000-8000-000000000005',repeat('e',64),1,'b1000000-0000-4000-8000-000000000002',null,-1);" both
psql_task -c "do \$\$ begin if (select count(*) from public.board_votes where author_token=repeat('e',64) and post_id='b1000000-0000-4000-8000-000000000002')<>1 or (select score from public.board_posts where id='b1000000-0000-4000-8000-000000000002')<>(select value from public.board_votes where author_token=repeat('e',64) and post_id='b1000000-0000-4000-8000-000000000002') then raise exception 'vote did not converge'; end if; end \$\$;"
pair vote_replay 61519 \
 "select * from public.brownsync_set_board_vote('b0000000-0000-4000-8000-000000000004',repeat('d',64),1,'b1000000-0000-4000-8000-000000000013',null,1);" \
 "select * from public.brownsync_set_board_vote('b0000000-0000-4000-8000-000000000004',repeat('d',64),1,'b1000000-0000-4000-8000-000000000013',null,1);" both
if [[ $(grep -hE '\|t$' "$race_tmp"/vote_replay.* | wc -l) -ne 1 ||
      $(grep -hE '\|f$' "$race_tmp"/vote_replay.* | wc -l) -ne 1 ]]; then
  echo "vote replay outputs did not identify one change and one no-op" >&2
  exit 1
fi
psql_task -c "do \$\$ begin if (select score from public.board_posts where id='b1000000-0000-4000-8000-000000000013')<>1 or (select count(*) from public.board_votes where author_token=repeat('d',64) and post_id='b1000000-0000-4000-8000-000000000013')<>1 then raise exception 'vote replay double-adjusted'; end if; end \$\$;"
psql_task -c "insert into public.board_reports(reporter_token,post_id,target_epoch,reason,result_visibility,result_revision) values(repeat('b',64),'b1000000-0000-4000-8000-000000000003',0,'spam','visible',1);"
pair threshold 61505 \
 "select * from public.brownsync_report_board_content('b0000000-0000-4000-8000-000000000003',repeat('c',64),1,'b1000000-0000-4000-8000-000000000003',null,'hate',null);" \
 "select * from public.brownsync_report_board_content('b0000000-0000-4000-8000-000000000004',repeat('d',64),1,'b1000000-0000-4000-8000-000000000003',null,'threat',null);" both
psql_task -c "do \$\$ begin if (select visibility from public.board_posts where id='b1000000-0000-4000-8000-000000000003')<>'auto_hidden' or (select count(distinct reporter_token) from public.board_reports where post_id='b1000000-0000-4000-8000-000000000003' and state='open')<>3 or (select count(*) from public.board_moderation_actions where target_id='b1000000-0000-4000-8000-000000000003' and action='auto_hide')<>1 then raise exception 'threshold invariant failed'; end if; end \$\$;"

# Restore/report epoch separation; appeal decisions yield one winner.
pair restore_report 61506 \
 "select * from public.brownsync_decide_board_content('b0000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003',null,0,'restore','race');" \
 "select * from public.brownsync_report_board_content('b0000000-0000-4000-8000-000000000006',repeat('f',64),1,'b1000000-0000-4000-8000-000000000003',null,'other','race');" both
psql_task -c "do \$\$ begin if (select visibility<>'visible' or moderation_epoch<>1 from public.board_posts where id='b1000000-0000-4000-8000-000000000003') or exists(select 1 from public.board_reports where post_id='b1000000-0000-4000-8000-000000000003' and target_epoch=0 and state='open') or (select count(*) from public.board_reports where post_id='b1000000-0000-4000-8000-000000000003' and target_epoch=1 and state='open')<>1 then raise exception 'restore epoch failed'; end if; end \$\$;"
psql_task <<'SQL'
update public.board_posts set visibility='auto_hidden'
where id='b1000000-0000-4000-8000-000000000004';
insert into public.board_appeals(
 id,author_token,client_request_id,post_id,target_epoch,body
) values (
 'b7000000-0000-4000-8000-000000000001',repeat('a',64),
 'b7100000-0000-4000-8000-000000000001',
 'b1000000-0000-4000-8000-000000000004',0,'Race'
);
SQL
pair appeal 61507 \
 "select * from public.brownsync_decide_board_appeal('b0000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000002','b7000000-0000-4000-8000-000000000001','approved','one');" \
 "select * from public.brownsync_decide_board_appeal('b0000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000003','b7000000-0000-4000-8000-000000000001','denied','two');" one
psql_task -c "do \$\$ begin if (select state from public.board_appeals where id='b7000000-0000-4000-8000-000000000001')<>'approved' or (select count(*) from public.board_moderation_actions where target_id='b7000000-0000-4000-8000-000000000001')<>1 then raise exception 'appeal winner drift'; end if; end \$\$;"

# Edit/delete/moderation, author-delete/report, and global moderator keys.
pair edit_delete 61508 \
 "select * from public.brownsync_edit_board_post('b0000000-0000-4000-8000-000000000003',repeat('a',64),1,'b1000000-0000-4000-8000-000000000005',1,'{\"body\":\"edit\"}'::jsonb);" \
 "select * from public.brownsync_delete_board_post('b0000000-0000-4000-8000-000000000003',repeat('a',64),1,'b1000000-0000-4000-8000-000000000005',1);" one
psql_task -c "do \$\$ begin if (select revision<>2 or body<>'edit' or visibility<>'visible' from public.board_posts where id='b1000000-0000-4000-8000-000000000005') then raise exception 'edit/delete winner drift'; end if; end \$\$;"
pair delete_report 61509 \
 "select * from public.brownsync_delete_board_post('b0000000-0000-4000-8000-000000000003',repeat('a',64),1,'b1000000-0000-4000-8000-000000000006',1);" \
 "select * from public.brownsync_report_board_content('b0000000-0000-4000-8000-000000000004',repeat('d',64),1,'b1000000-0000-4000-8000-000000000006',null,'spam',null);" one
psql_task -c "do \$\$ begin if (select visibility from public.board_posts where id='b1000000-0000-4000-8000-000000000006')<>'author_deleted' or exists(select 1 from public.board_reports where post_id='b1000000-0000-4000-8000-000000000006' and state='open') then raise exception 'delete/report failed closed'; end if; end \$\$;"
pair moderator_key 61510 \
 "select * from public.brownsync_decide_board_content('b0000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-000000000007',null,0,'hide','key');" \
 "select * from public.brownsync_decide_board_content('b0000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-000000000008',null,0,'hide','key');" one
psql_task -c "do \$\$ begin if (select count(*) from public.board_moderation_actions where moderator_user_id='b0000000-0000-4000-8000-000000000002' and client_request_id='b6000000-0000-4000-8000-000000000004')<>1 then raise exception 'moderator key drift'; end if; end \$\$;"
pair edit_moderation 61520 \
 "select * from public.brownsync_decide_board_content('b0000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000020','b1000000-0000-4000-8000-000000000014',null,0,'remove','race');" \
 "select * from public.brownsync_edit_board_post('b0000000-0000-4000-8000-000000000003',repeat('a',64),1,'b1000000-0000-4000-8000-000000000014',1,'{\"body\":\"late\"}'::jsonb);" one
pair delete_moderation 61523 \
 "select * from public.brownsync_delete_board_post('b0000000-0000-4000-8000-000000000003',repeat('a',64),1,'b1000000-0000-4000-8000-000000000015',1);" \
 "select * from public.brownsync_decide_board_content('b0000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000023','b1000000-0000-4000-8000-000000000015',null,0,'remove','late moderation');" one
psql_task -c "do \$\$ begin if (select visibility from public.board_posts where id='b1000000-0000-4000-8000-000000000015')<>'author_deleted' or exists(select 1 from public.board_moderation_actions where client_request_id='b6000000-0000-4000-8000-000000000023') then raise exception 'delete/moderation conflict drift'; end if; end \$\$;"

# Two-owner cross-demotion is serialized by board_control; no deadlock and one
# owner always remains.
pair config_add_target 61524 \
 "select * from public.brownsync_add_board_moderator('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','owner');" \
 "select * from public.brownsync_set_board_config('b0000000-0000-4000-8000-000000000002',false,3);" both
psql_task -c "update public.board_control set enabled=true;"
pair owner_cross 61511 \
 "select * from public.brownsync_add_board_moderator('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','moderator');" \
 "select * from public.brownsync_add_board_moderator('b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','moderator');" one
psql_task -c "do \$\$ begin if (select count(*) from public.board_moderators where role='owner')<1 then raise exception 'ownerless'; end if; end \$\$;"
owner_id=$(psql_task -c "select user_id from public.board_moderators where role='owner' limit 1")
other_id=$(psql_task -c "select user_id from public.board_moderators where user_id<>'$owner_id' limit 1")
pair config_authority 61521 \
 "select * from public.brownsync_set_board_config('$owner_id',false,3);" \
 "select * from public.brownsync_add_board_moderator('$owner_id','$other_id','owner');" both
psql_task -c "update public.board_control set enabled=true;"

# Two overlapping cleanup calls both succeed idempotently and cannot recreate
# the canonical rate mutex after the fence commits.
pair cleanup_retry 61512 \
 "select * from public.brownsync_delete_board_account('b0000000-0000-4000-8000-000000000007',repeat('7',64));" \
 "select * from public.brownsync_delete_board_account('b0000000-0000-4000-8000-000000000007',repeat('7',64));" both
if [[ $(grep -hE '\|f$' "$race_tmp"/cleanup_retry.* | wc -l) -ne 1 ||
      $(grep -hE '\|t$' "$race_tmp"/cleanup_retry.* | wc -l) -ne 1 ]]; then
  echo "cleanup overlap did not produce one mutation and one replay" >&2
  exit 1
fi
psql_task -c "do \$\$ begin if (select count(*) from public.board_account_deletion_fences where author_token=repeat('7',64))<>1 or exists(select 1 from public.board_rate_limits where author_token=repeat('7',64)) then raise exception 'cleanup retry residue'; end if; end \$\$;"

# Account-delete/write, kill-switch/write, ban/create and durable boundary all
# fail closed after the serialization winner commits.
pair account_write 61513 \
 "select * from public.brownsync_delete_board_account('b0000000-0000-4000-8000-000000000008',repeat('8',64));" \
 "select * from public.brownsync_create_board_post('b0000000-0000-4000-8000-000000000008',repeat('8',64),1,'b5000000-0000-4000-8000-000000000013',null,'write');" one
psql_task -c "do \$\$ begin if not exists(select 1 from public.board_account_deletion_fences where author_token=repeat('8',64)) or exists(select 1 from public.board_rate_limits where author_token=repeat('8',64)) or exists(select 1 from public.board_posts where author_token=repeat('8',64)) then raise exception 'account/write residue'; end if; end \$\$;"
owner_id=$(psql_task -c "select user_id from public.board_moderators where role='owner' limit 1")
pair kill_switch 61514 \
 "select * from public.brownsync_set_board_config('$owner_id',false,3);" \
 "select * from public.brownsync_create_board_post('b0000000-0000-4000-8000-000000000006',repeat('f',64),1,'b5000000-0000-4000-8000-000000000014',null,'switch');" one
[[ $(psql_task -c "select enabled from public.board_control where id=true") == f ]] || {
  echo "kill switch did not remain disabled" >&2; exit 1;
}
psql_task -c "update public.board_control set enabled=true;"
pair ban_create 61515 \
 "select * from public.brownsync_create_board_ban('$owner_id','b6000000-0000-4000-8000-000000000005','b1000000-0000-4000-8000-000000000009',null,300,'ban',null);" \
 "select * from public.brownsync_create_board_post('b0000000-0000-4000-8000-000000000003',repeat('a',64),1,'b5000000-0000-4000-8000-000000000015',null,'ban');" one
[[ $(psql_task -c "select count(*) from public.board_bans where author_token=repeat('a',64) and revoked_at is null and expires_at>clock_timestamp()") == 1 ]] || {
  echo "ban/create did not leave one active ban" >&2; exit 1;
}
psql_task -c "insert into public.board_rate_limits(author_token,bucket,count) values(repeat('f',64),'vote_10minute',119) on conflict(author_token,bucket) do update set count=119;"
pair limit 61516 \
 "select * from public.brownsync_set_board_vote('b0000000-0000-4000-8000-000000000006',repeat('f',64),1,'b1000000-0000-4000-8000-000000000010',null,1);" \
 "select * from public.brownsync_set_board_vote('b0000000-0000-4000-8000-000000000006',repeat('f',64),1,'b1000000-0000-4000-8000-000000000011',null,1);" one
psql_task -c "do \$\$ begin if (select count from public.board_rate_limits where author_token=repeat('f',64) and bucket='vote_10minute')<>120 or (select count(*) from public.board_votes where author_token=repeat('f',64) and post_id in('b1000000-0000-4000-8000-000000000010','b1000000-0000-4000-8000-000000000011'))<>1 then raise exception 'limit boundary drift'; end if; end \$\$;"

# Cross-operation quota locks precede the shared post target, preventing the
# vote/report inversion that previously risked deadlock.
pair cross_operation 61517 \
 "select * from public.brownsync_set_board_vote('b0000000-0000-4000-8000-000000000005',repeat('e',64),1,'b1000000-0000-4000-8000-000000000012',null,1);" \
 "select * from public.brownsync_report_board_content('b0000000-0000-4000-8000-000000000005',repeat('e',64),1,'b1000000-0000-4000-8000-000000000012',null,'other','order');" both

# Cleanup wins while an appeal decision is already resolved to the old token;
# the waiter must recheck after the real author mutex and fail NOT_FOUND.
psql_task <<'SQL'
delete from public.board_account_deletion_fences where author_token=repeat('7',64);
update public.board_posts
set author_token=repeat('7',64),visibility='auto_hidden'
where id='b1000000-0000-4000-8000-000000000012';
insert into public.board_appeals(
 id,author_token,client_request_id,post_id,target_epoch,body
) values (
 'b7000000-0000-4000-8000-000000000002',repeat('7',64),
 'b7100000-0000-4000-8000-000000000002',
 'b1000000-0000-4000-8000-000000000012',0,'cleanup race'
);
SQL
pair cleanup_appeal 61522 \
 "select * from public.brownsync_delete_board_account('b0000000-0000-4000-8000-000000000007',repeat('7',64));" \
 "select * from public.brownsync_decide_board_appeal('$owner_id','b6000000-0000-4000-8000-000000000022','b7000000-0000-4000-8000-000000000002','denied','race');" one
psql_task -c "do \$\$ begin if exists(select 1 from public.board_posts where author_token=repeat('7',64)) or exists(select 1 from public.board_appeals where author_token=repeat('7',64)) then raise exception 'cleanup/appeal residue'; end if; end \$\$;"

echo "0015_board_race: all deterministic concurrency races passed"
