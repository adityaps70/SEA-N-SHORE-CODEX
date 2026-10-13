-- Algorithms round G, release 2 (G3 jobs and job alerts, G4 search, G5 suggestions, G6 digest).
-- Additive only: new tables, functions, triggers, indexes and nullable columns, plus seed rows. Nothing existing is
-- changed, rewritten or deleted.

-- G3 Job alerts. last_sent_at already exists (0010); last_checked_at lets the sender look at each alert once per
-- period even when nothing new matched. Deliveries make the sender idempotent: a job is sent once per alert.
alter table public.job_alerts add column if not exists last_checked_at timestamptz null;
-- statement-breakpoint
create table if not exists public.job_alert_deliveries (
  alert_id uuid not null references public.job_alerts(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (alert_id, job_id)
);
-- statement-breakpoint
create index if not exists job_alert_deliveries_delivered_idx on public.job_alert_deliveries (delivered_at);
-- statement-breakpoint
create index if not exists job_alerts_due_idx on public.job_alerts (enabled, last_checked_at nulls first, id);
-- statement-breakpoint
-- Email topics for the two round G emails. A missing row means on; the one-click unsubscribe turns one topic off.
create table if not exists public.member_email_topics (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  topic text not null check (topic in ('job_alerts', 'weekly_digest')),
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (profile_id, topic)
);
-- statement-breakpoint
-- The send queue for job alert and weekly digest emails (same pattern as learning_notification_emails). The row id
-- is the unsubscribe token: random, names no one, and only turns its own topic off for its own recipient.
create table if not exists public.ranking_emails (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  topic text not null check (topic in ('job_alerts', 'weekly_digest')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  last_error text null,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz null
);
-- statement-breakpoint
create index if not exists ranking_emails_due_idx on public.ranking_emails (next_attempt_at, id) where status = 'pending';
-- statement-breakpoint
create index if not exists ranking_emails_recipient_idx on public.ranking_emails (recipient_id, topic, created_at desc);
-- statement-breakpoint
create index if not exists ranking_emails_created_idx on public.ranking_emails (created_at);
-- statement-breakpoint
-- Release 2 switches start on for administrators only; the owner turns each on for everyone on Admin › Ranking.
insert into public.ranking_settings (key, mode) values
  ('jobs', 'admins'),
  ('job_alerts', 'admins'),
  ('search', 'admins'),
  ('suggestions', 'admins'),
  ('notifications', 'admins'),
  ('weekly_digest', 'admins')
on conflict (key) do nothing;
-- statement-breakpoint
-- G4 Search. pg_trgm is already on (0063); this is a no-op kept so the release states what it needs.
create extension if not exists pg_trgm;
-- statement-breakpoint
-- One table to search: a row per person, organization, community, job, course, event and original post. It is a
-- candidate index only: every query re-checks the canonical visibility rules against the source tables, so a stale
-- row can never show something the viewer may not see. A removed or hidden source keeps its row with visibility
-- 'hidden' (the outbox worker clears those rows later).
create table if not exists public.search_documents (
  kind text not null check (kind in ('person', 'org', 'community', 'job', 'course', 'event', 'post')),
  entity_id uuid not null,
  display_name text not null default '',
  normalized_name text not null default '',
  subtitle text null,
  tsv tsvector not null default ''::tsvector,
  popularity real not null default 0,
  visibility text not null default 'hidden',
  owner_id uuid null,
  org_id uuid null,
  group_id uuid null,
  avatar_path text null,
  slug text null,
  source_created_at timestamptz null,
  updated_at timestamptz not null default now(),
  primary key (kind, entity_id)
);
-- statement-breakpoint
create index if not exists search_documents_prefix_idx on public.search_documents (kind, normalized_name text_pattern_ops) where visibility <> 'hidden';
-- statement-breakpoint
create index if not exists search_documents_trgm_idx on public.search_documents using gin (normalized_name gin_trgm_ops) where visibility <> 'hidden';
-- statement-breakpoint
create index if not exists search_documents_tsv_idx on public.search_documents using gin (tsv) where visibility <> 'hidden';
-- statement-breakpoint
create index if not exists search_documents_hidden_idx on public.search_documents (updated_at) where visibility = 'hidden';
-- statement-breakpoint
-- Code tokens without underscores (the text parser splits on them): rank 'rk' + code, vessel type 'vt' + code.
create or replace function public.search_code_token(prefix text, code text) returns text
language sql immutable parallel safe
as $$ select case when code is null or code = '' then null else prefix || replace(code, '_', '') end $$;
-- statement-breakpoint
create or replace function public.search_refresh_people(ids uuid[]) returns void
language sql
as $$
  insert into public.search_documents as d (kind, entity_id, display_name, normalized_name, subtitle, tsv, visibility, owner_id, avatar_path, slug, source_created_at, updated_at)
  select 'person', ref.id, coalesce(p.full_name, ''), coalesce(public.taxonomy_normalize(p.full_name), ''),
         left(coalesce(nullif(btrim(p.headline), ''), nullif(btrim(mp.rank), ''), nullif(btrim(p.role_other_text), '')), 160),
         setweight(to_tsvector('simple', coalesce(p.full_name, '')), 'A')
           || setweight(to_tsvector('simple', concat_ws(' ', p.headline, mp.rank, mp.current_company, array_to_string(mp.vessel_types, ' '),
                p.location, p.occupation_text, p.role_other_text, p.institution_name)), 'B')
           || to_tsvector('simple', concat_ws(' ', public.search_code_token('rk', p.role_key),
                (select string_agg(public.search_code_token('vt', code), ' ') from unnest(coalesce(mp.vessel_type_codes, '{}'::text[])) code))),
         case when p.id is not null and p.account_status = 'active' and p.onboarding_completed_at is not null then 'members' else 'hidden' end,
         ref.id, p.avatar_path, p.slug, p.created_at, now()
  from unnest(ids) as ref(id)
  left join public.profiles p on p.id = ref.id
  left join public.maritime_profiles mp on mp.user_id = ref.id
  on conflict (kind, entity_id) do update set
    display_name = excluded.display_name, normalized_name = excluded.normalized_name, subtitle = excluded.subtitle,
    tsv = excluded.tsv, visibility = excluded.visibility, avatar_path = excluded.avatar_path, slug = excluded.slug,
    source_created_at = coalesce(excluded.source_created_at, d.source_created_at), updated_at = now()
$$;
-- statement-breakpoint
create or replace function public.search_refresh_orgs(ids uuid[]) returns void
language sql
as $$
  insert into public.search_documents as d (kind, entity_id, display_name, normalized_name, subtitle, tsv, popularity, visibility, org_id, avatar_path, slug, source_created_at, updated_at)
  select 'org', ref.id, coalesce(c.name, ''), coalesce(public.taxonomy_normalize(c.name), ''),
         left(coalesce(nullif(btrim(c.tagline), ''), nullif(btrim(c.company_type), ''), c.office_locations[1]), 160),
         setweight(to_tsvector('simple', coalesce(c.name, '')), 'A')
           || setweight(to_tsvector('simple', concat_ws(' ', c.tagline, c.company_type, c.organization_type, array_to_string(c.office_locations, ' '),
                array_to_string(c.specialties, ' '), array_to_string(c.vessel_types, ' '))), 'B')
           || setweight(to_tsvector('english', coalesce(c.description, '')), 'C'),
         coalesce((select count(*) from public.organization_follows f where f.company_id = ref.id), 0)::real,
         case when c.id is null then 'hidden' else 'public' end,
         ref.id, c.logo_path, c.slug, c.created_at, now()
  from unnest(ids) as ref(id)
  left join public.companies c on c.id = ref.id
  on conflict (kind, entity_id) do update set
    display_name = excluded.display_name, normalized_name = excluded.normalized_name, subtitle = excluded.subtitle, tsv = excluded.tsv,
    popularity = excluded.popularity, visibility = excluded.visibility, avatar_path = excluded.avatar_path, slug = excluded.slug,
    source_created_at = coalesce(excluded.source_created_at, d.source_created_at), updated_at = now()
$$;
-- statement-breakpoint
create or replace function public.search_refresh_communities(ids uuid[]) returns void
language sql
as $$
  insert into public.search_documents as d (kind, entity_id, display_name, normalized_name, subtitle, tsv, popularity, visibility, org_id, avatar_path, slug, source_created_at, updated_at)
  select 'community', ref.id, coalesce(g.name, ''), coalesce(public.taxonomy_normalize(g.name), ''),
         left(nullif(btrim(g.description), ''), 160),
         setweight(to_tsvector('simple', coalesce(g.name, '')), 'A')
           || setweight(to_tsvector('simple', coalesce(g.category, '')), 'B')
           || setweight(to_tsvector('english', coalesce(g.description, '')), 'C'),
         coalesce((select count(*) from public.community_group_memberships m where m.group_id = ref.id and m.status = 'active'), 0)::real,
         case when g.id is null or g.archived_at is not null then 'hidden' else g.visibility end,
         g.owner_company_id, g.icon_path, g.slug, g.created_at, now()
  from unnest(ids) as ref(id)
  left join public.community_groups g on g.id = ref.id
  on conflict (kind, entity_id) do update set
    display_name = excluded.display_name, normalized_name = excluded.normalized_name, subtitle = excluded.subtitle, tsv = excluded.tsv,
    popularity = excluded.popularity, visibility = excluded.visibility, org_id = excluded.org_id, avatar_path = excluded.avatar_path, slug = excluded.slug,
    source_created_at = coalesce(excluded.source_created_at, d.source_created_at), updated_at = now()
$$;
-- statement-breakpoint
create or replace function public.search_refresh_jobs(ids uuid[]) returns void
language sql
as $$
  insert into public.search_documents as d (kind, entity_id, display_name, normalized_name, subtitle, tsv, visibility, owner_id, org_id, source_created_at, updated_at)
  select 'job', ref.id, coalesce(j.title, ''), coalesce(public.taxonomy_normalize(j.title), ''),
         left(concat_ws(' · ', coalesce(c.name, j.company_name), j.location), 160),
         setweight(to_tsvector('simple', coalesce(j.title, '')), 'A')
           || setweight(to_tsvector('simple', concat_ws(' ', coalesce(c.name, j.company_name), j.location, j.rank, j.department,
                array_to_string(j.vessel_types, ' '), array_to_string(j.sailing_regions, ' '))), 'B')
           || setweight(to_tsvector('english', concat_ws(' ', j.summary, j.requirements)), 'C')
           || to_tsvector('simple', concat_ws(' ',
                (select string_agg(public.search_code_token('rk', code), ' ') from unnest(coalesce(j.accepted_role_keys, '{}'::text[])) code),
                (select string_agg(public.search_code_token('vt', code), ' ') from unnest(coalesce(j.vessel_type_codes, '{}'::text[])) code))),
         case when j.id is not null and j.status = 'published' and j.deleted_at is null then 'open' else 'hidden' end,
         j.created_by_user_id, j.company_id, coalesce(j.published_at, j.created_at), now()
  from unnest(ids) as ref(id)
  left join public.jobs j on j.id = ref.id
  left join public.companies c on c.id = j.company_id
  on conflict (kind, entity_id) do update set
    display_name = excluded.display_name, normalized_name = excluded.normalized_name, subtitle = excluded.subtitle, tsv = excluded.tsv,
    visibility = excluded.visibility, owner_id = excluded.owner_id, org_id = excluded.org_id,
    source_created_at = coalesce(excluded.source_created_at, d.source_created_at), updated_at = now()
$$;
-- statement-breakpoint
create or replace function public.search_refresh_courses(ids uuid[]) returns void
language sql
as $$
  insert into public.search_documents as d (kind, entity_id, display_name, normalized_name, subtitle, tsv, visibility, org_id, avatar_path, slug, source_created_at, updated_at)
  select 'course', ref.id, coalesce(lc.title, ''), coalesce(public.taxonomy_normalize(lc.title), ''),
         left(coalesce(nullif(btrim(lc.subtitle), ''), lc.category), 160),
         setweight(to_tsvector('simple', coalesce(lc.title, '')), 'A')
           || setweight(to_tsvector('simple', concat_ws(' ', lc.category, lc.level)), 'B')
           || setweight(to_tsvector('english', concat_ws(' ', lc.subtitle, lc.description)), 'C'),
         case when lc.id is not null and lc.status = 'published' and lc.removed_at is null and lc.is_discoverable then 'published' else 'hidden' end,
         lc.company_id, lc.thumbnail_path, lc.slug, coalesce(lc.published_at, lc.created_at), now()
  from unnest(ids) as ref(id)
  left join public.learning_courses lc on lc.id = ref.id
  on conflict (kind, entity_id) do update set
    display_name = excluded.display_name, normalized_name = excluded.normalized_name, subtitle = excluded.subtitle, tsv = excluded.tsv,
    visibility = excluded.visibility, org_id = excluded.org_id, avatar_path = excluded.avatar_path, slug = excluded.slug,
    source_created_at = coalesce(excluded.source_created_at, d.source_created_at), updated_at = now()
$$;
-- statement-breakpoint
create or replace function public.search_refresh_events(ids uuid[]) returns void
language sql
as $$
  insert into public.search_documents as d (kind, entity_id, display_name, normalized_name, subtitle, tsv, visibility, owner_id, org_id, source_created_at, updated_at)
  select 'event', ref.id, coalesce(e.title, ''), coalesce(public.taxonomy_normalize(e.title), ''),
         left(concat_ws(' · ', to_char(e.start_at at time zone 'UTC', 'DD Mon YYYY'), nullif(concat_ws(', ', e.city, e.country), '')), 160),
         setweight(to_tsvector('simple', coalesce(e.title, '')), 'A')
           || setweight(to_tsvector('simple', concat_ws(' ', e.city, e.country, e.location_name, array_to_string(e.topics, ' '))), 'B')
           || setweight(to_tsvector('english', concat_ws(' ', e.summary, e.description)), 'C'),
         case when e.id is not null and e.status = 'published' and e.removed_at is null then 'published' else 'hidden' end,
         e.host_user_id, e.company_id, e.start_at, now()
  from unnest(ids) as ref(id)
  left join public.events e on e.id = ref.id
  on conflict (kind, entity_id) do update set
    display_name = excluded.display_name, normalized_name = excluded.normalized_name, subtitle = excluded.subtitle, tsv = excluded.tsv,
    visibility = excluded.visibility, owner_id = excluded.owner_id, org_id = excluded.org_id,
    source_created_at = excluded.source_created_at, updated_at = now()
$$;
-- statement-breakpoint
-- Posts: the text in 'english' (ships finds ship), the author's name and the hashtags in 'simple'. No name tiers:
-- normalized_name stays empty, so posts only match by full text. Reposts are not indexed (the original is).
create or replace function public.search_refresh_posts(ids uuid[]) returns void
language sql
as $$
  insert into public.search_documents as d (kind, entity_id, display_name, normalized_name, subtitle, tsv, visibility, owner_id, org_id, group_id, source_created_at, updated_at)
  select 'post', ref.id, coalesce(coalesce(c.name, author.full_name), ''), '',
         left(regexp_replace(coalesce(p.body, ''), '\s+', ' ', 'g'), 200),
         setweight(to_tsvector('english', coalesce(p.body, '')), 'A')
           || setweight(to_tsvector('simple', concat_ws(' ', author.full_name, c.name)), 'B')
           || setweight(to_tsvector('simple', coalesce((select string_agg(h.tag, ' ') from public.post_hashtags ph join public.hashtags h on h.id = ph.hashtag_id where ph.post_id = ref.id), '')), 'A'),
         case when p.id is not null and p.deleted_at is null and p.post_type <> 'repost' and btrim(coalesce(p.body, '')) <> '' then p.audience else 'hidden' end,
         p.author_id, p.company_id, p.group_id, p.created_at, now()
  from unnest(ids) as ref(id)
  left join public.posts p on p.id = ref.id
  left join public.profiles author on author.id = p.author_id
  left join public.companies c on c.id = p.company_id
  on conflict (kind, entity_id) do update set
    display_name = excluded.display_name, subtitle = excluded.subtitle, tsv = excluded.tsv, visibility = excluded.visibility,
    owner_id = excluded.owner_id, org_id = excluded.org_id, group_id = excluded.group_id,
    source_created_at = coalesce(excluded.source_created_at, d.source_created_at), updated_at = now()
$$;
-- statement-breakpoint
-- Triggers keep the table current on every insert, edit and removal (a removal marks the row hidden).
create or replace function public.search_on_profile() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.search_refresh_people(array[old.id]);
    return null;
  end if;
  perform public.search_refresh_people(array[new.id]);
  if tg_op = 'UPDATE' and new.full_name is distinct from old.full_name then
    perform public.search_refresh_posts(array(select id from public.posts where author_id = new.id and deleted_at is null and post_type <> 'repost'));
  end if;
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger search_profiles
  after insert or delete or update of full_name, slug, headline, avatar_path, account_status, onboarding_completed_at, role_key, location,
    occupation_text, role_other_text, institution_name
  on public.profiles
  for each row execute function public.search_on_profile();
-- statement-breakpoint
create or replace function public.search_on_maritime_profile() returns trigger
language plpgsql
as $$
begin
  perform public.search_refresh_people(array[case when tg_op = 'DELETE' then old.user_id else new.user_id end]);
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger search_maritime_profiles
  after insert or delete or update on public.maritime_profiles
  for each row execute function public.search_on_maritime_profile();
-- statement-breakpoint
create or replace function public.search_on_company() returns trigger
language plpgsql
as $$
begin
  perform public.search_refresh_orgs(array[case when tg_op = 'DELETE' then old.id else new.id end]);
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger search_companies
  after insert or delete or update of name, slug, tagline, company_type, organization_type, office_locations, specialties, vessel_types, description, logo_path
  on public.companies
  for each row execute function public.search_on_company();
-- statement-breakpoint
create or replace function public.search_on_community() returns trigger
language plpgsql
as $$
begin
  perform public.search_refresh_communities(array[case when tg_op = 'DELETE' then old.id else new.id end]);
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger search_community_groups
  after insert or delete or update of name, slug, description, category, visibility, archived_at, icon_path, owner_company_id
  on public.community_groups
  for each row execute function public.search_on_community();
-- statement-breakpoint
create or replace function public.search_on_job() returns trigger
language plpgsql
as $$
begin
  perform public.search_refresh_jobs(array[case when tg_op = 'DELETE' then old.id else new.id end]);
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger search_jobs
  after insert or delete or update on public.jobs
  for each row execute function public.search_on_job();
-- statement-breakpoint
create or replace function public.search_on_course() returns trigger
language plpgsql
as $$
begin
  perform public.search_refresh_courses(array[case when tg_op = 'DELETE' then old.id else new.id end]);
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger search_learning_courses
  after insert or delete or update of title, slug, subtitle, description, category, level, status, removed_at, is_discoverable, thumbnail_path, company_id
  on public.learning_courses
  for each row execute function public.search_on_course();
-- statement-breakpoint
create or replace function public.search_on_event() returns trigger
language plpgsql
as $$
begin
  perform public.search_refresh_events(array[case when tg_op = 'DELETE' then old.id else new.id end]);
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger search_events
  after insert or delete or update on public.events
  for each row execute function public.search_on_event();
-- statement-breakpoint
create or replace function public.search_on_post() returns trigger
language plpgsql
as $$
begin
  perform public.search_refresh_posts(array[case when tg_op = 'DELETE' then old.id else new.id end]);
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger search_posts
  after insert or delete or update of body, deleted_at, audience, group_id, company_id
  on public.posts
  for each row execute function public.search_on_post();
-- statement-breakpoint
create or replace function public.search_on_post_hashtag() returns trigger
language plpgsql
as $$
begin
  perform public.search_refresh_posts(array[case when tg_op = 'DELETE' then old.post_id else new.post_id end]);
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger search_post_hashtags
  after insert or delete on public.post_hashtags
  for each row execute function public.search_on_post_hashtag();
-- statement-breakpoint
-- One-time backfill of everything that exists today.
select public.search_refresh_people(array(select id from public.profiles));
-- statement-breakpoint
select public.search_refresh_orgs(array(select id from public.companies));
-- statement-breakpoint
select public.search_refresh_communities(array(select id from public.community_groups));
-- statement-breakpoint
select public.search_refresh_jobs(array(select id from public.jobs));
-- statement-breakpoint
select public.search_refresh_courses(array(select id from public.learning_courses));
-- statement-breakpoint
select public.search_refresh_events(array(select id from public.events));
-- statement-breakpoint
select public.search_refresh_posts(array(select id from public.posts where post_type <> 'repost'));
