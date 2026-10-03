create extension if not exists pgcrypto;
-- statement-breakpoint
create type public.profile_type as enum (
  'seafarer',
  'maritime_professional',
  'company',
  'trainer',
  'mentor',
  'recruiter',
  'service_provider'
);
-- statement-breakpoint
create type public.contact_visibility as enum ('private', 'members', 'public');
-- statement-breakpoint
create type public.account_status as enum ('active', 'restricted', 'suspended', 'deletion_requested');
-- statement-breakpoint
create type public.app_role as enum ('member', 'moderator', 'verifier', 'administrator');
-- statement-breakpoint
create type public.company_member_role as enum ('owner', 'administrator', 'recruiter', 'member');
-- statement-breakpoint
create table public.profiles (
  id uuid primary key,
  slug text unique,
  profile_type public.profile_type,
  full_name text not null,
  avatar_path text,
  location text,
  headline text,
  summary text,
  contact_visibility public.contact_visibility not null default 'private',
  account_status public.account_status not null default 'active',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_check check (
    full_name = btrim(full_name) and char_length(full_name) between 2 and 120
  ),
  constraint profiles_slug_check check (
    slug is null
    or (
      slug = lower(btrim(slug))
      and char_length(slug) between 1 and 80
      and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    )
  ),
  constraint profiles_location_check check (
    location is null or (location = btrim(location) and char_length(location) between 1 and 120)
  ),
  constraint profiles_headline_check check (
    headline is null or (headline = btrim(headline) and char_length(headline) between 1 and 160)
  ),
  constraint profiles_summary_check check (
    summary is null or (summary = btrim(summary) and char_length(summary) between 1 and 2000)
  ),
  constraint profiles_completed_identity_check check (
    onboarding_completed_at is null
    or (
      profile_type is not null
      and slug is not null
      and headline is not null
      and char_length(headline) between 4 and 160
      and summary is not null
      and char_length(summary) between 20 and 2000
    )
  )
);
-- statement-breakpoint
create table public.identity_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  provider_subject text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identity_accounts_provider_check check (provider in ('cognito')),
  constraint identity_accounts_provider_subject_check check (
    provider_subject = btrim(provider_subject)
    and char_length(provider_subject) between 1 and 255
  ),
  constraint identity_accounts_email_check check (
    email is null or (email = lower(btrim(email)) and char_length(email) between 3 and 320)
  ),
  unique (provider, provider_subject),
  unique (profile_id, provider)
);
-- statement-breakpoint
create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
-- statement-breakpoint
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  logo_path text,
  company_type text,
  website text,
  description text,
  fleet_summary text,
  vessel_types text[] not null default '{}',
  office_locations text[] not null default '{}',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_slug_check check (
    slug = lower(btrim(slug))
    and char_length(slug) between 1 and 80
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint companies_name_check check (
    name = btrim(name) and char_length(name) between 2 and 160
  ),
  constraint companies_description_check check (
    description is null or char_length(description) <= 4000
  ),
  constraint companies_fleet_summary_check check (
    fleet_summary is null or char_length(fleet_summary) <= 2000
  )
);
-- statement-breakpoint
create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.company_member_role not null default 'member',
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
-- statement-breakpoint
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- statement-breakpoint
create table public.maritime_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  rank text,
  current_company text,
  current_vessel text,
  sailing_experience_years numeric(4,1),
  vessel_types text[] not null default '{}',
  trading_areas text[] not null default '{}',
  shore_career_preference boolean not null default false,
  availability text,
  updated_at timestamptz not null default now(),
  constraint maritime_profiles_rank_check check (
    rank is null or (rank = btrim(rank) and char_length(rank) between 1 and 100)
  ),
  constraint maritime_profiles_current_company_check check (
    current_company is null
    or (current_company = btrim(current_company) and char_length(current_company) between 1 and 160)
  ),
  constraint maritime_profiles_current_vessel_check check (
    current_vessel is null
    or (current_vessel = btrim(current_vessel) and char_length(current_vessel) between 1 and 160)
  ),
  constraint maritime_profiles_experience_check check (
    sailing_experience_years is null or sailing_experience_years between 0 and 70
  ),
  constraint maritime_profiles_vessel_types_check check (cardinality(vessel_types) <= 20),
  constraint maritime_profiles_trading_areas_check check (cardinality(trading_areas) <= 20),
  constraint maritime_profiles_availability_check check (
    availability is null or (availability = btrim(availability) and char_length(availability) between 1 and 100)
  )
);
-- statement-breakpoint
create table public.profile_skills (
  user_id uuid not null references public.profiles(id) on delete cascade,
  skill text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, skill),
  constraint profile_skills_skill_check check (
    skill = btrim(skill) and char_length(skill) between 1 and 80
  )
);
-- statement-breakpoint
create index profiles_public_slug_idx
  on public.profiles(slug)
  where onboarding_completed_at is not null and account_status = 'active';
-- statement-breakpoint
create index identity_accounts_profile_idx on public.identity_accounts(profile_id);
-- statement-breakpoint
create index identity_accounts_email_ci_idx
  on public.identity_accounts(lower(email))
  where email is not null;
-- statement-breakpoint
create index company_members_user_idx on public.company_members(user_id);
-- statement-breakpoint
create unique index profile_skills_user_skill_ci_key
  on public.profile_skills(user_id, lower(skill));
