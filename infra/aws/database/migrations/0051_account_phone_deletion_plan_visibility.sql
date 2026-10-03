-- Sea N Shore round 7: mobile numbers on existing accounts, and plan-lapse visibility.
-- Additive and safe to run more than once. No existing row is rewritten.
--
-- 1. public.phone_link_code_requests: one row each time Settings texts a verification
--    code to a number a member is adding. Used only to rate-limit code requests (per
--    member and per number); rows older than a day are never read.
-- 2. hidden_for_plan_at on public.jobs, public.events and public.learning_courses: set
--    when the owner's Creator Pro / Organization Pro ends (the item disappears for
--    everyone else but is kept), cleared when they subscribe again. Reads also check the
--    owner's plan at read time, so nothing waits for this column to be updated.
-- 3. removed_at on public.events and public.learning_courses: set when the item is
--    removed because its owner deleted their account (personal items, or an
--    organization's items when the leaving member was its only manager). The item leaves
--    every listing and takes no new registrations, enrollments or sales, but existing
--    ticket holders and enrolled learners keep what they have. Jobs use the existing
--    soft delete (jobs.deleted_at) instead.

create table if not exists public.phone_link_code_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  phone_number text not null,
  created_at timestamptz not null default now(),
  constraint phone_link_code_requests_phone_check check (phone_number ~ '^\+[1-9][0-9]{7,14}$')
);
-- statement-breakpoint

create index if not exists phone_link_code_requests_profile_idx
  on public.phone_link_code_requests (profile_id, created_at desc);
-- statement-breakpoint

create index if not exists phone_link_code_requests_phone_idx
  on public.phone_link_code_requests (phone_number, created_at desc);
-- statement-breakpoint

alter table public.jobs
  add column if not exists hidden_for_plan_at timestamptz;
-- statement-breakpoint

alter table public.events
  add column if not exists hidden_for_plan_at timestamptz,
  add column if not exists removed_at timestamptz;
-- statement-breakpoint

alter table public.learning_courses
  add column if not exists hidden_for_plan_at timestamptz,
  add column if not exists removed_at timestamptz;
-- statement-breakpoint

create index if not exists jobs_hidden_for_plan_idx
  on public.jobs (hidden_for_plan_at)
  where hidden_for_plan_at is not null;
-- statement-breakpoint

create index if not exists events_hidden_for_plan_idx
  on public.events (hidden_for_plan_at)
  where hidden_for_plan_at is not null;
-- statement-breakpoint

create index if not exists learning_courses_hidden_for_plan_idx
  on public.learning_courses (hidden_for_plan_at)
  where hidden_for_plan_at is not null;
-- statement-breakpoint

-- Plan checks run per listed item: look up a subject's subscription rows quickly.
create index if not exists account_subscriptions_profile_status_idx
  on public.account_subscriptions (profile_id, status, current_period_ends_at)
  where profile_id is not null;
-- statement-breakpoint

create index if not exists account_subscriptions_company_status_idx
  on public.account_subscriptions (company_id, status, current_period_ends_at)
  where company_id is not null;
-- statement-breakpoint
