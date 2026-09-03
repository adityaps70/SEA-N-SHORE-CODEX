create schema if not exists private;
-- statement-breakpoint
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
-- statement-breakpoint
create type public.post_type as enum ('standard', 'poll');
-- statement-breakpoint
create type public.post_reaction_type as enum ('like');
-- statement-breakpoint
create type public.connection_status as enum ('pending', 'accepted');
-- statement-breakpoint
create type public.network_notification_type as enum (
  'connection_request',
  'connection_accepted',
  'new_follower'
);
-- statement-breakpoint
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
-- statement-breakpoint
create table public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type public.post_reaction_type not null default 'like',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
-- statement-breakpoint
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
-- statement-breakpoint
create table public.saved_posts (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
-- statement-breakpoint
create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  alt_text text,
  created_at timestamptz not null default now(),
  constraint post_media_mime_check check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  constraint post_media_alt_check check (
    alt_text is null or char_length(alt_text) <= 300
  )
);
-- statement-breakpoint
create table public.post_polls (
  post_id uuid primary key references public.posts(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- statement-breakpoint
create table public.post_poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.post_polls(post_id) on delete cascade,
  label text not null,
  position smallint not null,
  constraint post_poll_options_label_check check (
    label = btrim(label)
    and char_length(label) between 1 and 120
  ),
  constraint post_poll_options_position_check check (position between 0 and 5),
  unique (post_id, position),
  unique (post_id, id)
);
-- statement-breakpoint
create table public.post_poll_votes (
  post_id uuid not null,
  option_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id),
  foreign key (post_id, option_id)
    references public.post_poll_options(post_id, id)
    on delete cascade
);
-- statement-breakpoint
create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_not_self check (follower_id <> following_id)
);
-- statement-breakpoint
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_low_id uuid not null references public.profiles(id) on delete cascade,
  user_high_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status public.connection_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_low_id, user_high_id),
  constraint connections_canonical_pair check (user_low_id < user_high_id),
  constraint connections_requester_in_pair check (
    requested_by = user_low_id or requested_by = user_high_id
  )
);
-- statement-breakpoint
create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);
-- statement-breakpoint
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  notification_type public.network_notification_type not null,
  connection_id uuid references public.connections(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
-- statement-breakpoint
create index posts_feed_idx
  on public.posts (created_at desc, id desc)
  where deleted_at is null;
-- statement-breakpoint
create index posts_category_feed_idx
  on public.posts (category, created_at desc, id desc)
  where deleted_at is null;
-- statement-breakpoint
create index post_comments_post_idx
  on public.post_comments (post_id, created_at asc)
  where deleted_at is null;
-- statement-breakpoint
create index post_reactions_post_idx on public.post_reactions (post_id);
-- statement-breakpoint
create index saved_posts_user_idx on public.saved_posts (user_id, created_at desc);
-- statement-breakpoint
create index post_poll_options_post_idx on public.post_poll_options (post_id, position);
-- statement-breakpoint
create index post_poll_votes_option_idx on public.post_poll_votes (option_id);
-- statement-breakpoint
create index follows_following_created_idx
  on public.follows (following_id, created_at desc);
-- statement-breakpoint
create index follows_follower_created_idx
  on public.follows (follower_id, created_at desc);
-- statement-breakpoint
create index connections_low_status_updated_idx
  on public.connections (user_low_id, status, updated_at desc);
-- statement-breakpoint
create index connections_high_status_updated_idx
  on public.connections (user_high_id, status, updated_at desc);
-- statement-breakpoint
create index connections_requested_by_status_idx
  on public.connections (requested_by, status, created_at desc);
-- statement-breakpoint
create index user_blocks_blocked_blocker_idx
  on public.user_blocks (blocked_id, blocker_id);
-- statement-breakpoint
create index notifications_recipient_read_created_idx
  on public.notifications (recipient_id, read_at, created_at desc);
-- statement-breakpoint
create index notifications_connection_idx
  on public.notifications (connection_id)
  where connection_id is not null;
-- statement-breakpoint
create index notifications_actor_idx
  on public.notifications (actor_id)
  where actor_id is not null;
-- statement-breakpoint
create or replace function private.set_feed_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
-- statement-breakpoint
create trigger posts_set_updated_at
before update on public.posts
for each row execute procedure private.set_feed_updated_at();
-- statement-breakpoint
create trigger post_comments_set_updated_at
before update on public.post_comments
for each row execute procedure private.set_feed_updated_at();
-- statement-breakpoint
create or replace function private.set_network_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
-- statement-breakpoint
create trigger connections_set_updated_at
before update on public.connections
for each row execute procedure private.set_network_updated_at();
-- statement-breakpoint
create or replace function private.enforce_poll_option_count()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_post_id uuid;
  v_count integer;
begin
  if tg_op = 'DELETE' then
    v_post_id := old.post_id;
  else
    v_post_id := new.post_id;
  end if;

  if not exists (
    select 1
    from public.post_polls poll
    where poll.post_id = v_post_id
  ) then
    return null;
  end if;

  select count(*)::integer
  into v_count
  from public.post_poll_options option_row
  where option_row.post_id = v_post_id;

  if v_count not between 2 and 6 then
    raise check_violation using message = 'polls require 2 to 6 options';
  end if;

  return null;
end;
$$;
-- statement-breakpoint
create constraint trigger post_polls_require_options
after insert on public.post_polls
deferrable initially deferred
for each row execute procedure private.enforce_poll_option_count();
-- statement-breakpoint
create constraint trigger post_poll_options_enforce_count
after insert or delete or update of post_id on public.post_poll_options
deferrable initially deferred
for each row execute procedure private.enforce_poll_option_count();
