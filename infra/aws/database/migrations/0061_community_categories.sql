-- Round 10: community categories.
-- 1. community_groups.category: one of the eight post categories (null = uncategorised), used by
--    the Community page's "Browse by category" chips and directory filter.
-- 2. The eight post categories that were phone Home feed chips become public, open communities
--    with the same names, owned by the platform administrator account (the earliest
--    administrator, as migration 0055 did). A category whose slug or name already exists is
--    skipped, so re-running this migration changes nothing.
-- 3. The five launch groups from 0055 get a category when they have none yet.
-- Non-destructive: adds a column, a check constraint, an index and rows; deletes nothing.

alter table public.community_groups add column if not exists category text;
-- statement-breakpoint

alter table public.community_groups
  drop constraint if exists community_groups_category_check;
-- statement-breakpoint

alter table public.community_groups
  add constraint community_groups_category_check check (
    category is null or category in (
      'maritime_news',
      'technical_discussion',
      'vetting_sire_2_0',
      'career_advice',
      'safety_lessons',
      'achievement',
      'learning',
      'industry_opinion'
    )
  );
-- statement-breakpoint

create index if not exists community_groups_category_idx
  on public.community_groups (category, lower(name)) where archived_at is null;
-- statement-breakpoint

insert into public.community_groups (name, slug, description, rules, icon, visibility, join_policy, category, created_by)
select
  seed.name,
  seed.slug,
  seed.description,
  'Keep it professional, keep it useful. Share what you know, credit your sources, and treat every member with respect. Sales pitches, recruitment fees and personal attacks are removed.',
  seed.icon,
  'public',
  'open',
  seed.category,
  (
    select ur.user_id
    from public.user_roles ur
    join public.profiles owner on owner.id = ur.user_id
    where ur.role::text = 'administrator'
    order by ur.granted_at asc, ur.user_id asc
    limit 1
  )
from (
  values
    ('Maritime News'::text, 'maritime-news'::text, 'maritime_news'::text, 'Newspaper'::text, 'Shipping and port news that matters to people at sea and ashore: regulation, markets, incidents and fleet updates, with sources.'::text),
    ('Technical Discussion'::text, 'technical-discussion'::text, 'technical_discussion'::text, 'Wrench'::text, 'Machinery, navigation, cargo and systems questions answered by people who work with them every day.'::text),
    ('Vetting & SIRE 2.0'::text, 'vetting-and-sire-2-0'::text, 'vetting_sire_2_0'::text, 'ShieldCheck'::text, 'Inspection preparation, SIRE 2.0 questionnaires, observations and how fleets close them out.'::text),
    ('Career Advice'::text, 'career-advice'::text, 'career_advice'::text, 'BriefcaseBusiness'::text, 'Promotions, certificates of competency, moving ashore, contracts and choosing your next company.'::text),
    ('Safety Lessons'::text, 'safety-lessons'::text, 'safety_lessons'::text, 'LifeBuoy'::text, 'Near misses, incident learnings and safety culture: what happened, why, and what changed afterwards.'::text),
    ('Achievement'::text, 'achievement'::text, 'achievement'::text, 'Trophy'::text, 'Celebrate promotions, new certificates, first command, milestones and team wins across the maritime community.'::text),
    ('Learning'::text, 'learning'::text, 'learning'::text, 'GraduationCap'::text, 'Courses, exam preparation, study material and training tips for cadets, officers and shore professionals.'::text),
    ('Industry Opinion'::text, 'industry-opinion'::text, 'industry_opinion'::text, 'Lightbulb'::text, 'Considered views on where shipping is heading: decarbonisation, crewing, technology and policy.'::text)
) as seed(name, slug, category, icon, description)
where not exists (
  select 1
  from public.community_groups existing
  where existing.slug = seed.slug
     or lower(btrim(existing.name)) = lower(seed.name)
);
-- statement-breakpoint

insert into public.community_group_memberships (group_id, profile_id, role, status, joined_at)
select g.id, g.created_by, 'owner', 'active', now()
from public.community_groups g
where g.created_by is not null
  and g.slug in ('maritime-news', 'technical-discussion', 'vetting-and-sire-2-0', 'career-advice', 'safety-lessons', 'achievement', 'learning', 'industry-opinion')
on conflict (group_id, profile_id) do nothing;
-- statement-breakpoint

update public.community_groups g
set category = launch.category,
    updated_at = now()
from (
  values
    ('tanker-professionals'::text, 'vetting_sire_2_0'::text),
    ('masters-senior-officers'::text, 'career_advice'::text),
    ('marine-engineers'::text, 'technical_discussion'::text),
    ('cadets-community'::text, 'learning'::text),
    ('ask-the-community'::text, 'technical_discussion'::text)
) as launch(slug, category)
where g.slug = launch.slug
  and g.category is null;
