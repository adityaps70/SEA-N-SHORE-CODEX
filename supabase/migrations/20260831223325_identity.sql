create extension if not exists pgtap with schema extensions;

create type public.profile_type as enum (
  'seafarer', 'maritime_professional', 'company', 'trainer',
  'mentor', 'recruiter', 'service_provider'
);
create type public.contact_visibility as enum ('private', 'members', 'public');
create type public.account_status as enum ('active', 'restricted', 'suspended', 'deletion_requested');
create type public.app_role as enum ('member', 'moderator', 'verifier', 'administrator');
create type public.company_member_role as enum ('owner', 'administrator', 'recruiter', 'member');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  slug text unique,
  profile_type public.profile_type,
  full_name text not null check (char_length(full_name) between 2 and 120),
  avatar_path text,
  location text check (location is null or char_length(location) <= 120),
  headline text check (headline is null or char_length(headline) <= 160),
  summary text check (summary is null or char_length(summary) <= 2000),
  contact_visibility public.contact_visibility not null default 'private',
  account_status public.account_status not null default 'active',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slug is null or slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 160),
  logo_path text,
  company_type text,
  website text,
  description text check (description is null or char_length(description) <= 4000),
  fleet_summary text check (fleet_summary is null or char_length(fleet_summary) <= 2000),
  vessel_types text[] not null default '{}',
  office_locations text[] not null default '{}',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.company_member_role not null default 'member',
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1))
  );
  insert into public.user_roles (user_id, role) values (new.id, 'member');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure private.handle_new_user();

revoke all on function private.handle_new_user() from public;

create or replace function private.prevent_primary_profile_type_change()
returns trigger
language plpgsql
security invoker set search_path = ''
as $$
begin
  if old.onboarding_completed_at is not null
    and new.profile_type is distinct from old.profile_type
  then raise exception 'primary profile type requires support review';
  end if;
  return new;
end;
$$;

create trigger protect_primary_profile_type
before update of profile_type on public.profiles
for each row execute procedure private.prevent_primary_profile_type_change();

revoke all on function private.prevent_primary_profile_type_change() from public;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.audit_events enable row level security;

create policy "public profiles are readable"
on public.profiles for select
to anon, authenticated
using (account_status = 'active' and onboarding_completed_at is not null);

create policy "members read their own profile"
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy "members update their own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

revoke all on public.profiles, public.user_roles, public.companies, public.company_members, public.audit_events from anon, authenticated;
grant select on public.profiles, public.companies, public.company_members to anon, authenticated;
grant select on public.user_roles to authenticated;
grant update (slug, profile_type, full_name, avatar_path, location, headline, summary, contact_visibility, onboarding_completed_at)
on public.profiles to authenticated;

create policy "members read their own roles"
on public.user_roles for select to authenticated
using (user_id = (select auth.uid()));

create policy "active companies are readable"
on public.companies for select
to anon, authenticated
using (exists (
  select 1 from public.company_members cm
  where cm.company_id = companies.id and cm.approved_at is not null
));

create policy "approved company members manage company"
on public.companies for update to authenticated
using (exists (
  select 1 from public.company_members cm
  where cm.company_id = companies.id and cm.user_id = (select auth.uid())
    and cm.approved_at is not null and cm.role in ('owner', 'administrator')
));

grant update (slug, name, logo_path, company_type, website, description, fleet_summary, vessel_types, office_locations, updated_at)
on public.companies to authenticated;

create policy "company memberships are visible to members"
on public.company_members for select to authenticated
using (user_id = (select auth.uid()) or exists (
  select 1 from public.company_members manager
  where manager.company_id = company_members.company_id
    and manager.user_id = (select auth.uid()) and manager.approved_at is not null
    and manager.role in ('owner', 'administrator')
));

create index profiles_public_slug_idx on public.profiles(slug)
where onboarding_completed_at is not null and account_status = 'active';
create index company_members_user_idx on public.company_members(user_id);
