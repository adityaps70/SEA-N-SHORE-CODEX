alter type public.post_reaction_type add value if not exists 'support';
-- statement-breakpoint
alter type public.post_reaction_type add value if not exists 'respect';
-- statement-breakpoint
alter type public.post_reaction_type add value if not exists 'on_point';
-- statement-breakpoint
alter type public.network_notification_type add value if not exists 'post_comment';
-- statement-breakpoint
alter type public.network_notification_type add value if not exists 'comment_reply';
-- statement-breakpoint
alter type public.network_notification_type add value if not exists 'post_reaction';
-- statement-breakpoint
alter type public.network_notification_type add value if not exists 'comment_reaction';
-- statement-breakpoint
alter type public.network_notification_type add value if not exists 'post_mention';
-- statement-breakpoint
alter type public.network_notification_type add value if not exists 'comment_mention';
-- statement-breakpoint
alter table public.post_comments add column if not exists parent_comment_id uuid;
-- statement-breakpoint
alter table public.post_comments add constraint post_comments_id_post_unique unique (id, post_id);
-- statement-breakpoint
alter table public.post_comments add constraint post_comments_parent_same_post_fk foreign key (parent_comment_id, post_id) references public.post_comments(id, post_id) on delete cascade;
-- statement-breakpoint
create table if not exists public.comment_reactions (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type public.post_reaction_type not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
-- statement-breakpoint
create index if not exists comment_reactions_comment_idx on public.comment_reactions (comment_id);
-- statement-breakpoint
create index if not exists post_comments_parent_created_idx on public.post_comments (parent_comment_id, created_at asc, id asc) where deleted_at is null;
-- statement-breakpoint
create table if not exists public.content_mentions (
  id uuid primary key,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  mentioned_profile_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.post_comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint content_mentions_exact_target check ((post_id is not null) <> (comment_id is not null)),
  constraint content_mentions_not_self check (actor_id <> mentioned_profile_id)
);
-- statement-breakpoint
create unique index if not exists content_mentions_post_unique_idx on public.content_mentions (post_id, mentioned_profile_id) where post_id is not null;
-- statement-breakpoint
create unique index if not exists content_mentions_comment_unique_idx on public.content_mentions (comment_id, mentioned_profile_id) where comment_id is not null;
-- statement-breakpoint
create index if not exists content_mentions_recipient_created_idx on public.content_mentions (mentioned_profile_id, created_at desc);
-- statement-breakpoint
alter table public.notifications add column if not exists post_id uuid;
-- statement-breakpoint
alter table public.notifications add column if not exists comment_id uuid;
-- statement-breakpoint
alter table public.notifications add column if not exists reaction_type public.post_reaction_type;
-- statement-breakpoint
alter table public.notifications add column if not exists dedupe_key text;
-- statement-breakpoint
alter table public.notifications add constraint notifications_post_fk foreign key (post_id) references public.posts(id) on delete cascade;
-- statement-breakpoint
alter table public.notifications add constraint notifications_comment_fk foreign key (comment_id) references public.post_comments(id) on delete cascade;
-- statement-breakpoint
create unique index if not exists notifications_recipient_dedupe_unique_idx on public.notifications (recipient_id, dedupe_key) where dedupe_key is not null;
-- statement-breakpoint
create index if not exists notifications_post_created_idx on public.notifications (post_id, created_at desc) where post_id is not null;
-- statement-breakpoint
create index if not exists notifications_comment_created_idx on public.notifications (comment_id, created_at desc) where comment_id is not null;
