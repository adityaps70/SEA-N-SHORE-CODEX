-- Round I (I2): community categories managed in Admin › Communities › Categories.
--
-- 1. community_categories: the admin-managed list. name (1-40 characters, unique ignoring case), slug (from the
--    name, unique), optional short description (up to 160) and icon (a name from the app's community icon set),
--    position (the admin order, used by the picker, the directory chips and the search facet) and hidden_at
--    (hidden categories leave the picker but stay on the communities that have them). legacy_key keeps the value
--    the old fixed list used (maritime_news, ...), so links such as /community?category=maritime_news keep working.
-- 2. community_groups.category_id: the community's category (nullable; on delete restrict, so a category in use
--    can never be deleted, even outside the app).
-- 3. The backfill: the eight categories of the old fixed list with the same names, slugs, icons and order, plus
--    "Other" (slug other, the old "Other topics" filter). Every community's category_id is set from its old
--    category value; a community with no category goes to "Other". The old column only ever held one of the eight
--    values (its CHECK constraint), so there is no free text to map.
--
-- Additive: one new table, one nullable column, two indexes, nine rows, and one backfill UPDATE of the new column
-- (approved by the owner for this round, listed word for word in the runner's ALLOWED list). The old
-- community_groups.category column, its CHECK constraint and its index are kept and still written by the app.
-- Reversible: update public.community_groups set category_id = null; alter table public.community_groups drop
-- column category_id; drop table public.community_categories (the app built before this release never reads them).
create table if not exists public.community_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (char_length(slug) between 1 and 60 and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 40 and name = btrim(name)),
  description text null check (description is null or char_length(description) between 1 and 160),
  icon text null check (icon is null or icon ~ '^[A-Za-z]{1,40}$'),
  position integer not null default 0,
  hidden_at timestamptz null,
  legacy_key text null unique check (legacy_key is null or legacy_key ~ '^[a-z0-9_]{1,40}$'),
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint

create unique index if not exists community_categories_name_unique_idx
  on public.community_categories (lower(name));
-- statement-breakpoint

alter table public.community_groups
  add column if not exists category_id uuid null references public.community_categories(id) on delete restrict;
-- statement-breakpoint

create index if not exists community_groups_category_id_idx
  on public.community_groups (category_id, lower(name)) where archived_at is null;
-- statement-breakpoint

insert into public.community_categories (slug, name, icon, position, legacy_key) values
  ('maritime-news', 'Maritime News', 'Newspaper', 10, 'maritime_news'),
  ('technical-discussion', 'Technical Discussion', 'Wrench', 20, 'technical_discussion'),
  ('vetting-sire-2-0', 'Vetting & SIRE 2.0', 'ShieldCheck', 30, 'vetting_sire_2_0'),
  ('career-advice', 'Career Advice', 'BriefcaseBusiness', 40, 'career_advice'),
  ('safety-lessons', 'Safety Lessons', 'LifeBuoy', 50, 'safety_lessons'),
  ('achievement', 'Achievement', 'Trophy', 60, 'achievement'),
  ('learning', 'Learning', 'GraduationCap', 70, 'learning'),
  ('industry-opinion', 'Industry Opinion', 'Lightbulb', 80, 'industry_opinion'),
  ('other', 'Other', 'UsersRound', 90, 'other')
on conflict do nothing;
-- statement-breakpoint

update public.community_groups g
set category_id = c.id
from public.community_categories c
where g.category_id is null
  and c.legacy_key = coalesce(g.category, 'other');
