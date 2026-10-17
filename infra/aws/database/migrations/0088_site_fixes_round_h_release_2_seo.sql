-- Sea N Shore site fixes round H, release 2 (H5 SEO). Additive and safe to run more than once. No row is rewritten.
--
-- member_preferences.allow_search_indexing: the member lets search engines list their public profile page
-- (Settings › Privacy). Off by default: until a member opts in, their profile page carries noindex, has no Person
-- structured data and is left out of the sitemap.

alter table public.member_preferences
  add column if not exists allow_search_indexing boolean not null default false;
-- statement-breakpoint

create index if not exists member_preferences_allow_search_indexing_idx
  on public.member_preferences (profile_id)
  where allow_search_indexing;
