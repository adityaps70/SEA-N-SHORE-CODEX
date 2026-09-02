create type public.post_category as enum (
  'maritime_news',
  'technical_discussion',
  'vetting_sire_2_0',
  'career_advice',
  'safety_lessons',
  'achievement',
  'learning',
  'industry_opinion'
);

create type public.post_type as enum ('standard', 'poll');
create type public.post_reaction_type as enum ('like');

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  category public.post_category not null,
  body text not null,
  post_type public.post_type not null default 'standard',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint posts_body_check check (
    body = btrim(body)
    and char_length(body) between 1 and 5000
  )
);

create table public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type public.post_reaction_type not null default 'like',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint post_comments_body_check check (
    body = btrim(body)
    and char_length(body) between 1 and 2000
  )
);

create table public.saved_posts (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index posts_feed_idx
on public.posts (created_at desc, id desc)
where deleted_at is null;

create index posts_category_feed_idx
on public.posts (category, created_at desc, id desc)
where deleted_at is null;

create index post_comments_post_idx
on public.post_comments (post_id, created_at asc)
where deleted_at is null;

create index post_reactions_post_idx on public.post_reactions (post_id);
create index saved_posts_user_idx on public.saved_posts (user_id, created_at desc);

create or replace function private.set_feed_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_feed_updated_at() from public, anon, authenticated, service_role;

create trigger posts_set_updated_at
before update on public.posts
for each row execute procedure private.set_feed_updated_at();

create trigger post_comments_set_updated_at
before update on public.post_comments
for each row execute procedure private.set_feed_updated_at();

alter table public.posts enable row level security;
alter table public.post_reactions enable row level security;
alter table public.post_comments enable row level security;
alter table public.saved_posts enable row level security;

revoke all on public.posts, public.post_reactions, public.post_comments, public.saved_posts
from anon, authenticated;

grant select, insert on public.posts to authenticated;
grant update (body, category, deleted_at) on public.posts to authenticated;

grant select, insert, delete on public.post_reactions to authenticated;
grant select, insert on public.post_comments to authenticated;
grant update (body, deleted_at) on public.post_comments to authenticated;
grant select, insert, delete on public.saved_posts to authenticated;

create policy "active members read posts"
on public.posts for select to authenticated
using (
  deleted_at is null
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create policy "members create own posts"
on public.posts for insert to authenticated
with check (
  author_id = (select auth.uid())
  and deleted_at is null
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create policy "active authors update own posts"
on public.posts for update to authenticated
using (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
)
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create policy "active members read reactions"
on public.post_reactions for select to authenticated
using (
  exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and exists (
    select 1 from public.posts p
    where p.id = post_reactions.post_id
      and p.deleted_at is null
  )
);

create policy "active members react as themselves"
on public.post_reactions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and reaction_type = 'like'
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and exists (
    select 1 from public.posts p
    where p.id = post_reactions.post_id
      and p.deleted_at is null
  )
);

create policy "members remove own reactions"
on public.post_reactions for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create policy "active members read comments"
on public.post_comments for select to authenticated
using (
  deleted_at is null
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and exists (
    select 1 from public.posts p
    where p.id = post_comments.post_id
      and p.deleted_at is null
  )
);

create policy "active members comment as themselves"
on public.post_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and deleted_at is null
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and exists (
    select 1 from public.posts p
    where p.id = post_comments.post_id
      and p.deleted_at is null
  )
);

create policy "active authors update own comments"
on public.post_comments for update to authenticated
using (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
)
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create policy "members read own saved posts"
on public.saved_posts for select to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create policy "active members save posts as themselves"
on public.saved_posts for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and exists (
    select 1 from public.posts p
    where p.id = saved_posts.post_id
      and p.deleted_at is null
  )
);

create policy "members remove own saved posts"
on public.saved_posts for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);
