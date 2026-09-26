-- Sea N Shore feed sharing, reply threading and per-member hidden posts.
-- Safe to apply more than once: every statement is guarded or idempotent.
-- 1. Reposts may carry optional commentary ("Repost with your thoughts").
--    Plain reposts keep an empty body, so existing rows already satisfy the check.
-- 2. Replies remember which comment they answer, so threads can show "Replying to".
--    parent_comment_id still points at the top-level comment of the thread.
-- 3. Members can hide a post from their own feed (and undo it).

alter table public.posts
  drop constraint if exists posts_body_check,
  add constraint posts_body_check check (
    (
      post_type = 'repost'
      and body = btrim(body)
      and char_length(body) <= 5000
    )
    or (
      post_type <> 'repost'
      and body = btrim(body)
      and char_length(body) between 1 and 5000
    )
  );
-- statement-breakpoint

alter table public.post_comments
  add column if not exists reply_to_comment_id uuid
    references public.post_comments(id) on delete set null;
-- statement-breakpoint

create index if not exists post_comments_reply_to_idx
  on public.post_comments (reply_to_comment_id)
  where reply_to_comment_id is not null;
-- statement-breakpoint

create table if not exists public.post_hides (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
-- statement-breakpoint

create index if not exists post_hides_post_idx
  on public.post_hides (post_id);
