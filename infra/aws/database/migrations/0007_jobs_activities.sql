create type public.job_listing_status as enum ('draft', 'published', 'closed');
-- statement-breakpoint
create type public.job_application_status as enum (
  'applied',
  'under_review',
  'shortlisted',
  'interview',
  'selected',
  'rejected',
  'withdrawn'
);
-- statement-breakpoint
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company_name text not null,
  location text,
  summary text not null,
  description text not null,
  requirements text,
  status public.job_listing_status not null default 'draft',
  apply_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_title_check check (
    title = btrim(title)
    and char_length(title) between 2 and 160
  ),
  constraint jobs_company_name_check check (
    company_name = btrim(company_name)
    and char_length(company_name) between 2 and 160
  ),
  constraint jobs_location_check check (
    location is null or char_length(location) <= 160
  ),
  constraint jobs_summary_check check (
    summary = btrim(summary)
    and char_length(summary) between 1 and 500
  ),
  constraint jobs_description_check check (
    description = btrim(description)
    and char_length(description) between 1 and 12000
  ),
  constraint jobs_requirements_check check (
    requirements is null or char_length(requirements) <= 8000
  )
);
-- statement-breakpoint
create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  status public.job_application_status not null default 'applied',
  applied_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, applicant_id)
);
-- statement-breakpoint
create index if not exists jobs_published_created_idx
  on public.jobs (created_at desc, id desc)
  where status = 'published';
-- statement-breakpoint
create index if not exists job_applications_applicant_applied_idx
  on public.job_applications (applicant_id, applied_at desc, id desc);
-- statement-breakpoint
create index if not exists post_comments_author_created_idx
  on public.post_comments (author_id, created_at desc, id desc)
  where deleted_at is null;
