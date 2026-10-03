alter type public.post_type add value if not exists 'repost';
-- statement-breakpoint
alter table public.posts
  add column repost_of_post_id uuid references public.posts(id) on delete cascade;
-- statement-breakpoint
alter table public.posts
  drop constraint posts_body_check;
-- statement-breakpoint
alter table public.posts
  add constraint posts_body_check check (
    (post_type = 'repost' and body = '')
    or (
      post_type <> 'repost'
      and body = btrim(body)
      and char_length(body) between 1 and 5000
    )
  );
-- statement-breakpoint
alter table public.posts
  add constraint posts_repost_shape_check check (
    (
      post_type = 'repost'
      and repost_of_post_id is not null
      and repost_of_post_id <> id
    )
    or (
      post_type <> 'repost'
      and repost_of_post_id is null
    )
  );
-- statement-breakpoint
create unique index posts_active_repost_unique_idx
  on public.posts (author_id, repost_of_post_id)
  where post_type = 'repost' and deleted_at is null;
