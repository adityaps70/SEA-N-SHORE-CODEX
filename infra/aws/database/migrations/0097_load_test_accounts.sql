-- Round ARCH (Phase 1): flags for the 50 load-test accounts and their one hidden test community.
--
-- A profile or community with is_load_test = true exists only for the repeatable load test. The app keeps it out of
-- people you may know, search, real members' feeds, counts, notifications, emails and analytics, and the
-- loadtest-accounts runner creates and deletes these rows (it refuses to delete anything without the flag).
--
-- Additive only: two boolean columns with a constant default (no table rewrite) and two partial indexes.
-- Reversible: drop the two columns and indexes (the app built before this release never reads them).

-- statement-breakpoint
alter table public.profiles add column if not exists is_load_test boolean not null default false;

-- statement-breakpoint
create index if not exists profiles_load_test_idx on public.profiles (id) where is_load_test;

-- statement-breakpoint
alter table public.community_groups add column if not exists is_load_test boolean not null default false;

-- statement-breakpoint
create index if not exists community_groups_load_test_idx on public.community_groups (id) where is_load_test;
