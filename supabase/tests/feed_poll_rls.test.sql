begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
(
  '11111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'member-a@example.test', '',
  now(), now(), now(), '', '', '', ''
),
(
  '22222222-2222-4222-8222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'member-b@example.test', '',
  now(), now(), now(), '', '', '', ''
);

update public.profiles
set profile_type = 'maritime_professional',
    full_name = case id
      when '11111111-1111-4111-8111-111111111111' then 'Member A'
      else 'Member B'
    end,
    slug = case id
      when '11111111-1111-4111-8111-111111111111' then 'member-a-poll'
      else 'member-b-poll'
    end,
    headline = 'Maritime professional',
    summary = 'Completed profile created only for feed poll row level security tests.',
    onboarding_completed_at = now()
where id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select lives_ok(
  $$ select public.create_poll_post(
       'career_advice',
       'Which shore role would you choose?',
       array['Marine Superintendent', 'Vetting Superintendent']
     ) $$,
  'member A can create a two-option poll'
);

select throws_ok(
  $$ select public.create_poll_post(
       'career_advice',
       'Invalid poll',
       array['Only one']
     ) $$,
  '22023',
  'polls require 2 to 6 distinct options',
  'one-option poll is rejected'
);

select throws_ok(
  $$ select public.create_poll_post(
       'career_advice',
       'Invalid poll',
       array['1','2','3','4','5','6','7']
     ) $$,
  '22023',
  'polls require 2 to 6 distinct options',
  'seven-option poll is rejected'
);

reset role;
select id into temporary table created_poll
from public.posts
where author_id = '11111111-1111-4111-8111-111111111111'
  and post_type = 'poll'
order by created_at desc
limit 1;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select lives_ok(
  $$ insert into public.post_poll_votes(post_id, option_id, user_id)
     select p.id, o.id, '22222222-2222-4222-8222-222222222222'
     from created_poll p
     join public.post_poll_options o on o.post_id = p.id
     order by o.position
     limit 1 $$,
  'member B can vote on member A poll'
);

select lives_ok(
  $$ update public.post_poll_votes v
     set option_id = (
       select o.id
       from public.post_poll_options o
       where o.post_id = v.post_id and o.id <> v.option_id
       order by o.position
       limit 1
     )
     where v.user_id = '22222222-2222-4222-8222-222222222222' $$,
  'member B can change own vote'
);

select throws_ok(
  $$ delete from public.post_poll_options
     where post_id = (select id from created_poll)
       and position = 0 $$,
  '42501',
  null,
  'member B cannot alter member A poll options'
);

reset role;
insert into public.posts (
  id, author_id, category, body, post_type
) values (
  'bbbbbbbb-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'achievement',
  'Member A image post.',
  'standard'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select throws_ok(
  $$ insert into public.post_media(post_id, storage_path, mime_type)
     values (
       'bbbbbbbb-0000-4000-8000-000000000001',
       '22222222-2222-4222-8222-222222222222/bad/image.jpg',
       'image/jpeg'
     ) $$,
  '42501',
  null,
  'member B cannot attach media metadata to member A post'
);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select lives_ok(
  $$ insert into public.post_media(post_id, storage_path, mime_type)
     values (
       'bbbbbbbb-0000-4000-8000-000000000001',
       '11111111-1111-4111-8111-111111111111/bbbbbbbb-0000-4000-8000-000000000001/image.jpg',
       'image/jpeg'
     ) $$,
  'member A can attach media metadata to own post'
);

select throws_ok(
  $$ insert into public.post_media(post_id, storage_path, mime_type)
     values (
       'bbbbbbbb-0000-4000-8000-000000000001',
       '11111111-1111-4111-8111-111111111111/bbbbbbbb-0000-4000-8000-000000000001/second.jpg',
       'image/jpeg'
     ) $$,
  '23505',
  null,
  'a post cannot have a second media row'
);

select is(
  (select count(*) from public.post_poll_votes where user_id = '22222222-2222-4222-8222-222222222222'),
  1::bigint,
  'one vote row per member per poll is enforced'
);

select * from finish();
rollback;
