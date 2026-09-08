create table if not exists public.profile_experiences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  track text not null,
  title text not null,
  organization text,
  vessel text,
  vessel_type text,
  location text,
  started_on date,
  ended_on date,
  is_current boolean not null default false,
  description text,
  cargo_experience text[] not null default '{}'::text[],
  engine_experience text[] not null default '{}'::text[],
  trading_areas text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_experiences_track_check check (
    track in ('sea_service', 'shore_role', 'training', 'other_maritime')
  ),
  constraint profile_experiences_title_check check (
    title = btrim(title) and char_length(title) between 2 and 160
  ),
  constraint profile_experiences_organization_check check (
    organization is null or (organization = btrim(organization) and char_length(organization) between 1 and 180)
  ),
  constraint profile_experiences_vessel_check check (
    vessel is null or (vessel = btrim(vessel) and char_length(vessel) between 1 and 160)
  ),
  constraint profile_experiences_vessel_type_check check (
    vessel_type is null or (vessel_type = btrim(vessel_type) and char_length(vessel_type) between 1 and 120)
  ),
  constraint profile_experiences_location_check check (
    location is null or (location = btrim(location) and char_length(location) between 1 and 160)
  ),
  constraint profile_experiences_description_check check (
    description is null or (description = btrim(description) and char_length(description) between 1 and 4000)
  ),
  constraint profile_experiences_dates_check check (
    (started_on is null or ended_on is null or ended_on >= started_on)
    and (not is_current or ended_on is null)
  ),
  constraint profile_experiences_cargo_count_check check (cardinality(cargo_experience) <= 30),
  constraint profile_experiences_engine_count_check check (cardinality(engine_experience) <= 30),
  constraint profile_experiences_trading_count_check check (cardinality(trading_areas) <= 30),
  constraint profile_experiences_sort_order_check check (sort_order between 0 and 10000)
);
-- statement-breakpoint
create index if not exists profile_experiences_profile_order_idx
  on public.profile_experiences (profile_id, is_current desc, started_on desc, sort_order asc);
-- statement-breakpoint
create table if not exists public.profile_credentials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  issuer text not null,
  credential_number text,
  issued_on date,
  expires_on date,
  no_expiry boolean not null default false,
  verification_state text not null default 'self_reported',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_credentials_name_check check (
    name = btrim(name) and char_length(name) between 2 and 180
  ),
  constraint profile_credentials_issuer_check check (
    issuer = btrim(issuer) and char_length(issuer) between 2 and 180
  ),
  constraint profile_credentials_number_check check (
    credential_number is null
    or (credential_number = btrim(credential_number) and char_length(credential_number) between 1 and 180)
  ),
  constraint profile_credentials_dates_check check (
    (issued_on is null or expires_on is null or expires_on >= issued_on)
    and (not no_expiry or expires_on is null)
  ),
  constraint profile_credentials_verification_check check (
    verification_state in ('self_reported', 'pending', 'verified', 'rejected')
  ),
  constraint profile_credentials_sort_order_check check (sort_order between 0 and 10000)
);
-- statement-breakpoint
create index if not exists profile_credentials_profile_order_idx
  on public.profile_credentials (profile_id, sort_order asc, issued_on desc);
