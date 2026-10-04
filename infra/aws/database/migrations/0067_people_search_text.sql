-- Round 14 (3.6): people search reads one stored, lower-cased search_text per profile instead of
-- concatenating about twenty columns from three tables on every query. Triggers on the three
-- source tables (profiles, maritime_profiles, profile_skills) keep it current, a backfill fills
-- existing rows and a GIN trigram index (pg_trgm, migration 0063) serves LIKE '%term%'.
-- Additive only. Functions run with the caller's rights (no SECURITY DEFINER) and touch only
-- public tables the app role can already read and write.
alter table public.profiles add column if not exists search_text text;
-- statement-breakpoint

-- The same text, in the same order, that people search concatenated before this migration.
create or replace function public.profile_search_text(profile public.profiles)
returns text
language sql
stable
set search_path = pg_catalog, public
as $$
  select lower(concat_ws(' ',
    profile.full_name,
    profile.slug,
    profile.location,
    profile.headline,
    profile.summary,
    profile.primary_identity,
    profile.primary_identity_family,
    profile.persona,
    array_to_string(profile.profile_intents, ' '),
    profile.community_relationship,
    profile.institution_name,
    profile.specialization,
    profile.role_other_text,
    profile.occupation_text,
    array_to_string(profile.secondary_identities, ' '),
    mp.rank,
    mp.current_company,
    mp.current_vessel,
    array_to_string(mp.vessel_types, ' '),
    array_to_string(mp.trading_areas, ' '),
    coalesce((
      select string_agg(ps.skill, ' ' order by ps.skill)
      from public.profile_skills ps
      where ps.user_id = profile.id
    ), '')
  ))
  from (select 1) as one
  left join public.maritime_profiles mp on mp.user_id = profile.id
$$;
-- statement-breakpoint

create or replace function public.profiles_set_search_text()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.search_text := public.profile_search_text(new);
  return new;
end;
$$;
-- statement-breakpoint

create or replace trigger profiles_set_search_text
before insert or update on public.profiles
for each row execute function public.profiles_set_search_text();
-- statement-breakpoint

-- One statement-level refresh per write to maritime_profiles or profile_skills (a skills save
-- deletes and re-inserts the whole list), touching only profiles whose text really changed.
create or replace function public.refresh_profile_search_text()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles p
    set search_text = public.profile_search_text(p)
    where p.id in (select changed.user_id from new_rows changed)
      and p.search_text is distinct from public.profile_search_text(p);
  elsif tg_op = 'DELETE' then
    update public.profiles p
    set search_text = public.profile_search_text(p)
    where p.id in (select changed.user_id from old_rows changed)
      and p.search_text is distinct from public.profile_search_text(p);
  else
    update public.profiles p
    set search_text = public.profile_search_text(p)
    where p.id in (
        select changed.user_id from new_rows changed
        union
        select changed.user_id from old_rows changed
      )
      and p.search_text is distinct from public.profile_search_text(p);
  end if;
  return null;
end;
$$;
-- statement-breakpoint

create or replace trigger maritime_profiles_search_text_insert
after insert on public.maritime_profiles
referencing new table as new_rows
for each statement execute function public.refresh_profile_search_text();
-- statement-breakpoint

create or replace trigger maritime_profiles_search_text_update
after update on public.maritime_profiles
referencing old table as old_rows new table as new_rows
for each statement execute function public.refresh_profile_search_text();
-- statement-breakpoint

create or replace trigger maritime_profiles_search_text_delete
after delete on public.maritime_profiles
referencing old table as old_rows
for each statement execute function public.refresh_profile_search_text();
-- statement-breakpoint

create or replace trigger profile_skills_search_text_insert
after insert on public.profile_skills
referencing new table as new_rows
for each statement execute function public.refresh_profile_search_text();
-- statement-breakpoint

create or replace trigger profile_skills_search_text_update
after update on public.profile_skills
referencing old table as old_rows new table as new_rows
for each statement execute function public.refresh_profile_search_text();
-- statement-breakpoint

create or replace trigger profile_skills_search_text_delete
after delete on public.profile_skills
referencing old table as old_rows
for each statement execute function public.refresh_profile_search_text();
-- statement-breakpoint

-- Backfill (about 3,700 profiles on staging): one statement; the trigger above computes the text.
-- updated_at is not touched, so discovery ordering does not change.
update public.profiles p
set search_text = public.profile_search_text(p)
where p.search_text is distinct from public.profile_search_text(p);
-- statement-breakpoint

create index if not exists profiles_search_text_trgm_idx
  on public.profiles using gin (search_text gin_trgm_ops);
