begin;

create extension if not exists pgtap with schema extensions;
select plan(39);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
(
  '91111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'network-a@example.test', '',
  now(), now(), now(), '', '', '', ''
),
(
  '92222222-2222-4222-8222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'network-b@example.test', '',
  now(), now(), now(), '', '', '', ''
),
(
  '93333333-3333-4333-8333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'network-c@example.test', '',
  now(), now(), now(), '', '', '', ''
),
(
  '94444444-4444-4444-8444-444444444444',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'network-d@example.test', '',
  now(), now(), now(), '', '', '', ''
);

update public.profiles
set profile_type = 'seafarer',
    full_name = case id
      when '91111111-1111-4111-8111-111111111111' then 'Network A'
      when '92222222-2222-4222-8222-222222222222' then 'Network B'
      when '93333333-3333-4333-8333-333333333333' then 'Network C'
      else 'Network D'
    end,
    slug = case id
      when '91111111-1111-4111-8111-111111111111' then 'network-a'
      when '92222222-2222-4222-8222-222222222222' then 'network-b'
      when '93333333-3333-4333-8333-333333333333' then 'network-c'
      else 'network-d'
    end,
    headline = 'Maritime professional',
    summary = 'Completed profile created only for network row level security tests.'
where id in (
  '91111111-1111-4111-8111-111111111111',
  '92222222-2222-4222-8222-222222222222',
  '93333333-3333-4333-8333-333333333333',
  '94444444-4444-4444-8444-444444444444'
);

insert into public.maritime_profiles (user_id, rank)
values
  ('91111111-1111-4111-8111-111111111111', 'Master'),
  ('92222222-2222-4222-8222-222222222222', 'Chief Officer'),
  ('93333333-3333-4333-8333-333333333333', 'Chief Engineer'),
  ('94444444-4444-4444-8444-444444444444', 'Second Engineer')
on conflict (user_id) do update set rank = excluded.rank;

update public.profiles
set onboarding_completed_at = now()
where id in (
  '91111111-1111-4111-8111-111111111111',
  '92222222-2222-4222-8222-222222222222',
  '93333333-3333-4333-8333-333333333333',
  '94444444-4444-4444-8444-444444444444'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '91111111-1111-4111-8111-111111111111', true);

select lives_ok(
  $$ select public.follow_profile('92222222-2222-4222-8222-222222222222') $$,
  'member A can follow member B'
);
select is(
  (select count(*) from public.follows
   where follower_id = '91111111-1111-4111-8111-111111111111'
     and following_id = '92222222-2222-4222-8222-222222222222'),
  1::bigint,
  'follow row belongs to caller'
);
select is(
  public.follow_profile('92222222-2222-4222-8222-222222222222'),
  false,
  'duplicate follow is idempotent'
);
select throws_ok(
  $$ select public.follow_profile('91111111-1111-4111-8111-111111111111') $$,
  'P0001', 'network_self_interaction',
  'member cannot follow self'
);
select throws_ok(
  $$ insert into public.notifications(recipient_id, actor_id, notification_type)
     values ('91111111-1111-4111-8111-111111111111',
             '92222222-2222-4222-8222-222222222222', 'new_follower') $$,
  '42501', null,
  'ordinary authenticated role cannot manufacture notifications'
);

select set_config('request.jwt.claim.sub', '92222222-2222-4222-8222-222222222222', true);
select is(
  (select count(*) from public.notifications
   where recipient_id = '92222222-2222-4222-8222-222222222222'
     and actor_id = '91111111-1111-4111-8111-111111111111'
     and notification_type = 'new_follower'),
  1::bigint,
  'new follow creates exactly one follower notification'
);

select set_config('request.jwt.claim.sub', '91111111-1111-4111-8111-111111111111', true);
select is(
  (select count(*) from public.notifications
   where recipient_id = '92222222-2222-4222-8222-222222222222'),
  0::bigint,
  'member A cannot read member B notifications'
);
update public.notifications
set read_at = now()
where recipient_id = '92222222-2222-4222-8222-222222222222';
select set_config('request.jwt.claim.sub', '92222222-2222-4222-8222-222222222222', true);
select is(
  (select count(*) from public.notifications
   where recipient_id = '92222222-2222-4222-8222-222222222222'
     and read_at is not null),
  0::bigint,
  'member A cannot update member B notification read state'
);

select set_config('request.jwt.claim.sub', '91111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$ select public.send_connection_request('94444444-4444-4444-8444-444444444444') $$,
  'member A can send member D a connection request'
);
select set_config(
  'network.test.conn_ad',
  (select id::text from public.connections
   where user_low_id = least('91111111-1111-4111-8111-111111111111'::uuid, '94444444-4444-4444-8444-444444444444'::uuid)
     and user_high_id = greatest('91111111-1111-4111-8111-111111111111'::uuid, '94444444-4444-4444-8444-444444444444'::uuid)),
  true
);
select throws_ok(
  $$ select public.accept_connection_request(current_setting('network.test.conn_ad')::uuid) $$,
  'P0001', 'network_action_not_allowed',
  'requester cannot accept own request'
);

select set_config('request.jwt.claim.sub', '94444444-4444-4444-8444-444444444444', true);
select throws_ok(
  $$ select public.send_connection_request('91111111-1111-4111-8111-111111111111') $$,
  'P0001', 'network_request_exists',
  'reciprocal pending request is rejected'
);
select lives_ok(
  $$ select public.decline_connection_request(current_setting('network.test.conn_ad')::uuid) $$,
  'recipient can decline request'
);
select is(
  (select count(*) from public.connections
   where user_low_id = least('91111111-1111-4111-8111-111111111111'::uuid, '94444444-4444-4444-8444-444444444444'::uuid)
     and user_high_id = greatest('91111111-1111-4111-8111-111111111111'::uuid, '94444444-4444-4444-8444-444444444444'::uuid)),
  0::bigint,
  'decline removes pending connection'
);

select set_config('request.jwt.claim.sub', '91111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$ select public.send_connection_request('93333333-3333-4333-8333-333333333333') $$,
  'member A can send member C a connection request'
);
select set_config(
  'network.test.conn_ac',
  (select id::text from public.connections
   where user_low_id = least('91111111-1111-4111-8111-111111111111'::uuid, '93333333-3333-4333-8333-333333333333'::uuid)
     and user_high_id = greatest('91111111-1111-4111-8111-111111111111'::uuid, '93333333-3333-4333-8333-333333333333'::uuid)),
  true
);
select set_config('request.jwt.claim.sub', '93333333-3333-4333-8333-333333333333', true);
select lives_ok(
  $$ select public.accept_connection_request(current_setting('network.test.conn_ac')::uuid) $$,
  'recipient can accept connection request'
);
select is(
  (select count(*) from public.follows
   where (follower_id = '91111111-1111-4111-8111-111111111111' and following_id = '93333333-3333-4333-8333-333333333333')
      or (follower_id = '93333333-3333-4333-8333-333333333333' and following_id = '91111111-1111-4111-8111-111111111111')),
  2::bigint,
  'accept creates mutual follows'
);
select is(
  (select count(*) from public.notifications
   where recipient_id = '93333333-3333-4333-8333-333333333333'
     and actor_id = '91111111-1111-4111-8111-111111111111'
     and notification_type = 'new_follower'),
  0::bigint,
  'accept does not create redundant follower notification'
);

select set_config('request.jwt.claim.sub', '91111111-1111-4111-8111-111111111111', true);
select is(
  (select count(*) from public.notifications
   where recipient_id = '91111111-1111-4111-8111-111111111111'
     and actor_id = '93333333-3333-4333-8333-333333333333'
     and notification_type = 'connection_accepted'),
  1::bigint,
  'accept creates one accepted notification for requester'
);

select set_config('request.jwt.claim.sub', '92222222-2222-4222-8222-222222222222', true);
select is(
  (select count(*) from public.connections
   where user_low_id = least('91111111-1111-4111-8111-111111111111'::uuid, '93333333-3333-4333-8333-333333333333'::uuid)
     and user_high_id = greatest('91111111-1111-4111-8111-111111111111'::uuid, '93333333-3333-4333-8333-333333333333'::uuid)),
  0::bigint,
  'unrelated member cannot read raw connection row'
);
select throws_ok(
  $$ select public.remove_connection(current_setting('network.test.conn_ac')::uuid) $$,
  'P0001', 'network_action_not_allowed',
  'unrelated member cannot remove accepted connection'
);

select set_config('request.jwt.claim.sub', '91111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$ select public.unfollow_profile('93333333-3333-4333-8333-333333333333') $$,
  'connected member can unfollow independently'
);
select is(
  (select count(*) from public.connections
   where id = current_setting('network.test.conn_ac')::uuid and status = 'accepted'),
  1::bigint,
  'unfollow preserves accepted connection'
);
select lives_ok(
  $$ select public.follow_profile('93333333-3333-4333-8333-333333333333') $$,
  'member can follow connected member again'
);
select lives_ok(
  $$ select public.remove_connection(current_setting('network.test.conn_ac')::uuid) $$,
  'pair member can remove accepted connection'
);
select is(
  (select count(*) from public.follows
   where (follower_id = '91111111-1111-4111-8111-111111111111' and following_id = '93333333-3333-4333-8333-333333333333')
      or (follower_id = '93333333-3333-4333-8333-333333333333' and following_id = '91111111-1111-4111-8111-111111111111')),
  2::bigint,
  'removing connection preserves independent follows'
);

select set_config('request.jwt.claim.sub', '92222222-2222-4222-8222-222222222222', true);
select lives_ok(
  $$ select public.follow_profile('91111111-1111-4111-8111-111111111111') $$,
  'member B can follow member A before block'
);
select lives_ok(
  $$ select public.send_connection_request('91111111-1111-4111-8111-111111111111') $$,
  'member B can request member A before block'
);

select set_config('request.jwt.claim.sub', '91111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$ select public.block_profile('92222222-2222-4222-8222-222222222222') $$,
  'member A can block member B'
);
select is(
  (select count(*) from public.follows
   where (follower_id = '91111111-1111-4111-8111-111111111111' and following_id = '92222222-2222-4222-8222-222222222222')
      or (follower_id = '92222222-2222-4222-8222-222222222222' and following_id = '91111111-1111-4111-8111-111111111111')),
  0::bigint,
  'block removes both follow directions'
);
select is(
  (select count(*) from public.connections
   where user_low_id = least('91111111-1111-4111-8111-111111111111'::uuid, '92222222-2222-4222-8222-222222222222'::uuid)
     and user_high_id = greatest('91111111-1111-4111-8111-111111111111'::uuid, '92222222-2222-4222-8222-222222222222'::uuid)),
  0::bigint,
  'block removes pair connection'
);
select is(
  (select count(*) from public.notifications
   where actor_id = '92222222-2222-4222-8222-222222222222'
     and notification_type = 'connection_request'),
  0::bigint,
  'block removes actionable request notification'
);
select is(
  (select count(*) from public.user_blocks
   where blocker_id = '91111111-1111-4111-8111-111111111111'
     and blocked_id = '92222222-2222-4222-8222-222222222222'),
  1::bigint,
  'blocker can read own outgoing block'
);

select set_config('request.jwt.claim.sub', '92222222-2222-4222-8222-222222222222', true);
select is(
  (select count(*) from public.user_blocks
   where blocker_id = '91111111-1111-4111-8111-111111111111'
     and blocked_id = '92222222-2222-4222-8222-222222222222'),
  0::bigint,
  'blocked member cannot read incoming block row'
);
select throws_ok(
  $$ select public.follow_profile('91111111-1111-4111-8111-111111111111') $$,
  'P0001', 'network_interaction_unavailable',
  'blocked pair cannot follow'
);
select throws_ok(
  $$ select public.send_connection_request('91111111-1111-4111-8111-111111111111') $$,
  'P0001', 'network_interaction_unavailable',
  'blocked pair cannot connect'
);

select set_config('request.jwt.claim.sub', '91111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$ select public.unblock_profile('92222222-2222-4222-8222-222222222222') $$,
  'blocker can unblock member'
);
select is(
  (select count(*) from public.user_blocks
   where blocker_id = '91111111-1111-4111-8111-111111111111'
     and blocked_id = '92222222-2222-4222-8222-222222222222'),
  0::bigint,
  'unblock removes block row'
);
select is(
  (select count(*) from public.follows
   where (follower_id = '91111111-1111-4111-8111-111111111111' and following_id = '92222222-2222-4222-8222-222222222222')
      or (follower_id = '92222222-2222-4222-8222-222222222222' and following_id = '91111111-1111-4111-8111-111111111111')),
  0::bigint,
  'unblock does not restore follows'
);
select is(
  (select count(*) from public.connections
   where user_low_id = least('91111111-1111-4111-8111-111111111111'::uuid, '92222222-2222-4222-8222-222222222222'::uuid)
     and user_high_id = greatest('91111111-1111-4111-8111-111111111111'::uuid, '92222222-2222-4222-8222-222222222222'::uuid)),
  0::bigint,
  'unblock does not restore connection'
);

select * from finish();
rollback;
