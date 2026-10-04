-- Round 14 (2.8): per-member social action quotas (connection requests, posts, comments, reactions).
-- One row per counted action. The app counts rows in a rolling window under a per-member advisory
-- lock, and remembers connection requests so a declined or withdrawn request starts a 7-day
-- re-request cooldown. The app prunes each member's rows older than 8 days as it goes.
-- Additive only: a new table and two indexes; nothing existing is changed or deleted.
create table if not exists public.social_action_events (
  id bigserial primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('connection_request', 'post', 'comment', 'reaction')),
  target_profile_id uuid null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- statement-breakpoint
create index if not exists social_action_events_profile_action_created_idx
  on public.social_action_events (profile_id, action, created_at desc);
-- statement-breakpoint
create index if not exists social_action_events_connection_target_idx
  on public.social_action_events (profile_id, target_profile_id, created_at desc)
  where action = 'connection_request';
