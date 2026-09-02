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
set profile_type = 'seafarer',
    full_name = case id
      when '11111111-1111-4111-8111-111111111111' then 'Member A'
      else 'Member B'
    end,
    slug = case id
      when '11111111-1111-4111-8111-111111111111' then 'member-a'
      else 'member-b'
    end,
    headline = 'Maritime professional',
    summary = 'Completed profile created only for feed row level security tests.',
    onboarding_completed_at = now()
where id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);

insert into public.maritime_profiles (user_id, rank)
values
  ('11111111-1111-4111-8111-111111111111', 'Chief Officer'),
  ('22222222-2222-4222-8222-222222222222', 'Second Engineer')
on conflict (user_id) do update set rank = excluded.rank;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select lives_ok(
  $$ insert into public.posts(id, author_id, category, body)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111',
             'technical_discussion',
             'A real technical lesson from member A.') $$,
  'member A creates own post'
);

select is(
  (select count(*) from public.posts
   where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  'active completed member can read feed post'
);

select throws_ok(
  $$ insert into public.posts(author_id, category, body)
     values ('22222222-2222-4222-8222-222222222222',
             'technical_discussion',
             'Impersonation attempt.') $$,
  '42501',
  null,
  'member A cannot create a post as member B'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

update public.posts
set body = 'Member B should not be able to edit this.'
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select is(
  (select body from public.posts where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'A real technical lesson from member A.',
  'member B cannot update member A post'
);

select lives_ok(
  $$ insert into public.post_reactions(post_id, user_id, reaction_type)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '22222222-2222-4222-8222-222222222222', 'like') $$,
  'member B can like a readable post'
);

select lives_ok(
  $$ insert into public.post_comments(post_id, author_id, body)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '22222222-2222-4222-8222-222222222222',
             'Useful technical lesson.') $$,
  'member B can comment on a readable post'
);

select lives_ok(
  $$ insert into public.saved_posts(post_id, user_id)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '22222222-2222-4222-8222-222222222222') $$,
  'member B can save a readable post'
);

select is(
  (select count(*) from public.saved_posts),
  1::bigint,
  'member sees only own save rows'
);

reset role;
update public.profiles
set account_status = 'suspended'
where id = '22222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is(
  (select count(*) from public.posts),
  0::bigint,
  'suspended member cannot read feed posts'
);

select throws_ok(
  $$ insert into public.post_comments(post_id, author_id, body)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '22222222-2222-4222-8222-222222222222',
             'Suspended member comment.') $$,
  '42501',
  null,
  'suspended member cannot comment'
);

select * from finish();
rollback;
