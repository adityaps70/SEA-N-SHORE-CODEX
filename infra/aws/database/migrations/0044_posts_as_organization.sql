-- Sea N Shore: members can publish feed posts on behalf of an organization.
-- Safe to apply more than once: every statement is guarded or idempotent.
-- 1. posts.company_id names the organization a post is published as. The member who
--    wrote it stays in posts.author_id, so moderation and notifications keep a person.
--    Deleting an organization keeps its posts as the author's own posts.
-- 2. Organization pages list their posts newest first, so they get their own index.

alter table public.posts
  add column if not exists company_id uuid
    references public.companies(id) on delete set null;
-- statement-breakpoint

create index if not exists posts_company_created_idx
  on public.posts (company_id, created_at desc)
  where company_id is not null;
