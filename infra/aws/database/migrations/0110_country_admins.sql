-- Round GP (Global Partners), Part C: country admins, the limited admins for country partners.
--
-- 1. public.country_admins: one row per member a platform administrator made a country admin, with the countries
--    (ISO 3166-1 alpha-2 codes, 1 to 50) they review. A country admin is never in public.user_roles: they get no
--    platform administrator power anywhere. last_active_at is when they last used the admin console.
-- 2. public.organization_review_emails: the send queue for the email an organization's applicant gets when its
--    verification is approved, rejected (with the reason) or sent back for changes. Sent by the outbox worker
--    through Resend, at most once per row; the in-app notification is written next to it.
--
-- Each country admin action is written to public.audit_events with the country in its metadata (no schema change).
--
-- Additive and safe to run more than once. No existing row is rewritten. Reversible: drop table
-- public.organization_review_emails; drop table public.country_admins (the enum value from 0109 stays, unused).
-- statement-breakpoint
create table if not exists public.country_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  countries text[] not null,
  granted_by uuid null references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_active_at timestamptz null,
  constraint country_admins_countries_check check (
    cardinality(countries) between 1 and 50
    and array_to_string(countries, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'
  )
);
-- statement-breakpoint
create table if not exists public.organization_review_emails (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  decision text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint organization_review_emails_dedupe_check check (char_length(dedupe_key) between 1 and 300),
  constraint organization_review_emails_decision_check check (decision in ('approved', 'rejected', 'changes_requested')),
  constraint organization_review_emails_status_check check (status in ('pending', 'sent', 'skipped', 'failed')),
  constraint organization_review_emails_attempts_check check (attempts >= 0),
  constraint organization_review_emails_error_check check (last_error is null or char_length(last_error) <= 500)
);
-- statement-breakpoint
create unique index if not exists organization_review_emails_dedupe_uq
  on public.organization_review_emails (dedupe_key);
-- statement-breakpoint
create index if not exists organization_review_emails_due_idx
  on public.organization_review_emails (next_attempt_at)
  where status = 'pending';
