-- Sea N Shore site fixes round F: who can see a post.
-- 'anyone'  : the post can be opened from a shared link without an account (read-only).
-- 'members' : signed-in members only.
-- Existing posts become 'members', so nothing turns public that its author did not choose. The app
-- sends the audience on every new post; the column default keeps any other insert members-only.
-- Additive and safe to run more than once.

alter table public.posts
  add column if not exists audience text not null default 'members';
-- statement-breakpoint
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'posts_audience_check' and conrelid = 'public.posts'::regclass
  ) then
    alter table public.posts
      add constraint posts_audience_check check (audience in ('anyone', 'members'));
  end if;
end $$;
-- statement-breakpoint
