-- Round 14 (3.6): indexes for author timelines, member discovery ordering and name search.
-- Additive only. Each table is small, so the brief write lock of a plain CREATE INDEX is fine.
create index if not exists posts_author_created_live_idx
  on public.posts (author_id, created_at desc, id desc)
  where deleted_at is null;
-- statement-breakpoint
create index if not exists profiles_updated_at_idx
  on public.profiles (updated_at desc, id);
-- statement-breakpoint
create extension if not exists pg_trgm;
-- statement-breakpoint
create index if not exists community_groups_name_trgm_idx
  on public.community_groups using gin (name gin_trgm_ops);
-- statement-breakpoint
create index if not exists companies_name_trgm_idx
  on public.companies using gin (name gin_trgm_ops);
-- statement-breakpoint
create index if not exists events_title_trgm_idx
  on public.events using gin (title gin_trgm_ops);
