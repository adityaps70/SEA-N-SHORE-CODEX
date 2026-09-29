-- Sea N Shore round 9B: community groups, group posts, organization mentions, photo people
-- tags and hashtags. Additive and safe to run more than once. No member content is rewritten.
--
-- 1. public.community_groups + public.community_group_memberships (member|admin|owner,
--    active|pending|removed). posts.group_id scopes a post to a group.
-- 2. public.content_organization_mentions: @Organization tags in posts and comments.
-- 3. public.post_photo_tags: people tagged in a post photo (post_media row).
-- 4. public.hashtags / public.post_hashtags / public.hashtag_follows: #tags stored normalised.
-- 5. notifications gain group_id / company_id references; content reports and moderation
--    actions accept the 'group' target type.
-- 6. The five groups from the former static Community page are seeded as public groups owned
--    by the earliest platform administrator account (user_roles.role = 'administrator').

create table if not exists public.community_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text not null default '',
  rules text not null default '',
  cover_path text,
  icon text,
  visibility text not null default 'public',
  created_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_groups_slug_unique unique (slug),
  constraint community_groups_name_check check (char_length(btrim(name)) between 1 and 80),
  constraint community_groups_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 1 and 80),
  constraint community_groups_description_check check (char_length(description) <= 2000),
  constraint community_groups_rules_check check (char_length(rules) <= 4000),
  constraint community_groups_visibility_check check (visibility in ('public', 'private'))
);
-- statement-breakpoint

create index if not exists community_groups_active_name_idx
  on public.community_groups (lower(name)) where archived_at is null;
-- statement-breakpoint

create table if not exists public.community_group_memberships (
  group_id uuid not null references public.community_groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'active',
  requested_at timestamptz not null default now(),
  joined_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (group_id, profile_id),
  constraint community_group_memberships_role_check check (role in ('member', 'admin', 'owner')),
  constraint community_group_memberships_status_check check (status in ('active', 'pending', 'removed'))
);
-- statement-breakpoint

create index if not exists community_group_memberships_profile_idx
  on public.community_group_memberships (profile_id, status);
-- statement-breakpoint

create index if not exists community_group_memberships_group_status_idx
  on public.community_group_memberships (group_id, status, role);
-- statement-breakpoint

alter table public.posts add column if not exists group_id uuid references public.community_groups(id) on delete set null;
-- statement-breakpoint

create index if not exists posts_group_feed_idx
  on public.posts (group_id, created_at desc, id desc) where group_id is not null and deleted_at is null;
-- statement-breakpoint

create table if not exists public.content_organization_mentions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.post_comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint content_organization_mentions_exact_target check ((post_id is not null) <> (comment_id is not null))
);
-- statement-breakpoint

create unique index if not exists content_organization_mentions_post_unique_idx
  on public.content_organization_mentions (post_id, company_id) where post_id is not null;
-- statement-breakpoint

create unique index if not exists content_organization_mentions_comment_unique_idx
  on public.content_organization_mentions (comment_id, company_id) where comment_id is not null;
-- statement-breakpoint

create index if not exists content_organization_mentions_company_created_idx
  on public.content_organization_mentions (company_id, created_at desc);
-- statement-breakpoint

create table if not exists public.post_photo_tags (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  media_id uuid not null references public.post_media(id) on delete cascade,
  tagged_profile_id uuid not null references public.profiles(id) on delete cascade,
  tagged_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint post_photo_tags_media_profile_unique unique (media_id, tagged_profile_id)
);
-- statement-breakpoint

create index if not exists post_photo_tags_post_idx on public.post_photo_tags (post_id);
-- statement-breakpoint

create index if not exists post_photo_tags_profile_idx on public.post_photo_tags (tagged_profile_id, created_at desc);
-- statement-breakpoint

create table if not exists public.hashtags (
  id uuid primary key default gen_random_uuid(),
  tag text not null,
  created_at timestamptz not null default now(),
  constraint hashtags_tag_unique unique (tag),
  constraint hashtags_tag_check check (tag ~ '^[a-z0-9_]{1,64}$')
);
-- statement-breakpoint

create table if not exists public.post_hashtags (
  post_id uuid not null references public.posts(id) on delete cascade,
  hashtag_id uuid not null references public.hashtags(id) on delete cascade,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  primary key (post_id, hashtag_id)
);
-- statement-breakpoint

create index if not exists post_hashtags_hashtag_idx on public.post_hashtags (hashtag_id, created_at desc);
-- statement-breakpoint

create table if not exists public.hashtag_follows (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  hashtag_id uuid not null references public.hashtags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, hashtag_id)
);
-- statement-breakpoint

create index if not exists hashtag_follows_hashtag_idx on public.hashtag_follows (hashtag_id);
-- statement-breakpoint

alter table public.notifications add column if not exists group_id uuid references public.community_groups(id) on delete cascade;
-- statement-breakpoint

alter table public.notifications add column if not exists company_id uuid references public.companies(id) on delete cascade;
-- statement-breakpoint

alter table public.content_reports
  drop constraint if exists content_reports_target_type_check;
-- statement-breakpoint

alter table public.content_reports
  add constraint content_reports_target_type_check check (
    target_type in ('post', 'comment', 'job', 'event', 'profile', 'group')
  );
-- statement-breakpoint

alter table public.moderation_actions
  drop constraint if exists moderation_actions_target_type_check;
-- statement-breakpoint

alter table public.moderation_actions
  add constraint moderation_actions_target_type_check check (
    target_type in ('post', 'comment', 'job', 'event', 'profile', 'group')
  );
-- statement-breakpoint

-- Seed the launch groups (formerly the static Community page) as public groups owned by the
-- platform administrator account. Existing rows with the same slug are left untouched.
insert into public.community_groups (name, slug, description, rules, icon, visibility, created_by)
select
  seed.name,
  seed.slug,
  seed.description,
  'Keep it professional, keep it useful. Share what you know, credit your sources, and treat every member with respect. Sales pitches, recruitment fees and personal attacks are removed.',
  seed.icon,
  'public',
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
    ('Tanker Professionals'::text, 'tanker-professionals'::text, 'Operational discussion around tanker practice, vetting, SIRE 2.0, cargo operations and lessons from the fleet.'::text, 'ShieldCheck'::text),
    ('Masters & Senior Officers'::text, 'masters-senior-officers'::text, 'A peer space for command, leadership, regulation, safety culture and career decisions at senior level.'::text, 'UsersRound'::text),
    ('Marine Engineers'::text, 'marine-engineers'::text, 'Technical conversations spanning machinery, maintenance, troubleshooting, energy efficiency and engineering careers.'::text, 'Wrench'::text),
    ('Cadets Community'::text, 'cadets-community'::text, 'Practical guidance from experienced professionals for training, examinations, first contracts and early-career confidence.'::text, 'BookOpenCheck'::text),
    ('Ask the Community'::text, 'ask-the-community'::text, 'Turn professional questions into structured discussions where useful answers can build reputation over time.'::text, 'BadgeQuestionMark'::text)
) as seed(name, slug, description, icon)
where not exists (
  select 1 from public.community_groups existing where existing.slug = seed.slug
);
-- statement-breakpoint

insert into public.community_group_memberships (group_id, profile_id, role, status, joined_at)
select g.id, g.created_by, 'owner', 'active', now()
from public.community_groups g
where g.created_by is not null
  and g.slug in ('tanker-professionals', 'masters-senior-officers', 'marine-engineers', 'cadets-community', 'ask-the-community')
on conflict (group_id, profile_id) do nothing;
-- statement-breakpoint
