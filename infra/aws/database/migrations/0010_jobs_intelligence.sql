-- Sea N Shore Jobs Intelligence: additive maritime recruitment model.
-- Existing requirements text column remains on public.jobs for backward compatibility.

alter table public.jobs
  add column if not exists company_id uuid references public.companies(id) on delete set null,
  add column if not exists created_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists job_domain text not null default 'sea',
  add column if not exists department text,
  add column if not exists rank text,
  add column if not exists vessel_types text[] not null default '{}'::text[],
  add column if not exists experience_min_years numeric(4,1),
  add column if not exists experience_max_years numeric(4,1),
  add column if not exists joining_from date,
  add column if not exists joining_until date,
  add column if not exists salary_min numeric(12,2),
  add column if not exists salary_max numeric(12,2),
  add column if not exists salary_currency text,
  add column if not exists salary_period text,
  add column if not exists sailing_regions text[] not null default '{}'::text[],
  add column if not exists urgent boolean not null default false,
  add column if not exists easy_apply boolean not null default true,
  add column if not exists published_at timestamptz;
-- statement-breakpoint

update public.jobs
set published_at = created_at
where status = 'published' and published_at is null;
-- statement-breakpoint

alter table public.companies
  add column if not exists is_verified boolean not null default false,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles(id) on delete set null;
-- statement-breakpoint

-- Recruiter verification belongs to an approved company membership, not a self-assigned profile badge.
alter table public.company_members
  add column if not exists is_verified boolean not null default false,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles(id) on delete set null;
-- statement-breakpoint

create table if not exists public.job_certificate_requirements (
  job_id uuid not null references public.jobs(id) on delete cascade,
  certificate_name text not null,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (job_id, certificate_name),
  constraint job_certificate_requirements_name_check check (
    certificate_name = btrim(certificate_name) and char_length(certificate_name) between 2 and 180
  )
);
-- statement-breakpoint

create table if not exists public.job_visa_requirements (
  job_id uuid not null references public.jobs(id) on delete cascade,
  visa_name text not null,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (job_id, visa_name),
  constraint job_visa_requirements_name_check check (
    visa_name = btrim(visa_name) and char_length(visa_name) between 2 and 120
  )
);
-- statement-breakpoint

create table if not exists public.profile_visas (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  visa_type text not null,
  country text,
  expires_on date,
  verification_state text not null default 'self_reported',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_visas_type_check check (
    visa_type = btrim(visa_type) and char_length(visa_type) between 2 and 120
  ),
  constraint profile_visas_country_check check (
    country is null or (country = btrim(country) and char_length(country) between 2 and 120)
  ),
  constraint profile_visas_verification_check check (
    verification_state in ('self_reported', 'pending', 'verified', 'rejected')
  ),
  unique (profile_id, visa_type, country)
);
-- statement-breakpoint

create table if not exists public.job_saves (
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (job_id, user_id)
);
-- statement-breakpoint

create table if not exists public.job_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  frequency text not null default 'daily',
  enabled boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_alerts_name_check check (
    name = btrim(name) and char_length(name) between 2 and 120
  ),
  constraint job_alerts_frequency_check check (frequency in ('instant', 'daily', 'weekly'))
);
-- statement-breakpoint

create table if not exists public.job_application_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.job_applications(id) on delete cascade,
  status public.job_application_status not null,
  actor_id uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint job_application_events_note_check check (note is null or char_length(note) <= 2000)
);
-- statement-breakpoint

insert into public.job_application_events (application_id, status, actor_id, created_at)
select a.id, a.status, a.applicant_id, a.applied_at
from public.job_applications a
where not exists (
  select 1 from public.job_application_events e where e.application_id = a.id
);
-- statement-breakpoint

create table if not exists public.job_recruiter_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.job_applications(id) on delete cascade,
  recruiter_id uuid not null references public.profiles(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_recruiter_notes_note_check check (
    note = btrim(note) and char_length(note) between 1 and 4000
  )
);
-- statement-breakpoint

create table if not exists public.job_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'open',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint job_reports_reason_check check (
    reason in ('recruitment_fee', 'fake_company', 'misleading_salary', 'false_vacancy', 'suspicious_communication', 'inappropriate_content', 'other')
  ),
  constraint job_reports_details_check check (details is null or char_length(details) <= 4000),
  constraint job_reports_status_check check (status in ('open', 'reviewing', 'resolved', 'dismissed'))
);
-- statement-breakpoint

create index if not exists jobs_discovery_idx
  on public.jobs (job_domain, urgent desc, published_at desc, created_at desc, id desc)
  where status = 'published';
-- statement-breakpoint

create index if not exists jobs_search_idx
  on public.jobs using gin (
    to_tsvector(
      'simple'::regconfig,
      coalesce(title, '') || ' ' || coalesce(company_name, '') || ' ' || coalesce(location, '') || ' ' ||
      coalesce(summary, '') || ' ' || coalesce(description, '') || ' ' || coalesce(requirements, '') || ' ' ||
      coalesce(rank, '') || ' ' || coalesce(department, '')
    )
  );
-- statement-breakpoint

create index if not exists jobs_company_idx on public.jobs (company_id, status, created_at desc);
-- statement-breakpoint
create index if not exists jobs_rank_idx on public.jobs (lower(rank)) where rank is not null and status = 'published';
-- statement-breakpoint
create index if not exists jobs_vessel_types_idx on public.jobs using gin (vessel_types);
-- statement-breakpoint
create index if not exists jobs_sailing_regions_idx on public.jobs using gin (sailing_regions);
-- statement-breakpoint
create index if not exists job_saves_user_idx on public.job_saves (user_id, saved_at desc, job_id);
-- statement-breakpoint
create index if not exists job_alerts_user_idx on public.job_alerts (user_id, enabled, created_at desc);
-- statement-breakpoint
create index if not exists job_application_events_application_idx on public.job_application_events (application_id, created_at asc, id asc);
-- statement-breakpoint
create index if not exists job_applications_job_status_idx on public.job_applications (job_id, status, applied_at desc, id desc);
-- statement-breakpoint
create index if not exists job_reports_status_idx on public.job_reports (status, created_at desc);
