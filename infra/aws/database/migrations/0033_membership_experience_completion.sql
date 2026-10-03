-- Sea N Shore membership experience completion delta.
-- Safe to apply after 0032 has already been applied in staging.
-- Reconciles later Organization Pro role requests, organization follows,
-- Creator Pro management entitlements, and legacy management grants.

alter table public.company_access_requests
  drop constraint if exists company_access_requests_type_check,
  add constraint company_access_requests_type_check check (
    request_type in ('join_company', 'recruiter_access', 'role_access')
  );
-- statement-breakpoint

alter table public.company_access_requests
  drop constraint if exists company_access_requests_role_check,
  add constraint company_access_requests_role_check check (
    requested_role::text in (
      'member',
      'recruiter',
      'administrator',
      'lms_manager',
      'event_manager',
      'content_manager',
      'analyst'
    )
  );
-- statement-breakpoint

alter table public.company_access_requests
  drop constraint if exists company_access_requests_type_role_check,
  add constraint company_access_requests_type_role_check check (
    (request_type = 'join_company' and requested_role::text = 'member')
    or (
      request_type = 'recruiter_access'
      and requested_role::text in ('recruiter', 'administrator')
    )
    or (
      request_type = 'role_access'
      and requested_role::text in (
        'recruiter',
        'administrator',
        'lms_manager',
        'event_manager',
        'content_manager',
        'analyst'
      )
    )
  );
-- statement-breakpoint

create table if not exists public.organization_follows (
  company_id uuid not null references public.companies(id) on delete cascade,
  follower_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (company_id, follower_id)
);
-- statement-breakpoint

create index if not exists organization_follows_follower_idx
  on public.organization_follows (follower_id, created_at desc, company_id);
-- statement-breakpoint

insert into public.plan_entitlements (plan_code, capability)
values
  ('free', 'job.apply'),
  ('free', 'event.attend'),
  ('free', 'course.enroll'),
  ('creator_pro', 'job.apply'),
  ('creator_pro', 'event.attend'),
  ('creator_pro', 'course.enroll'),
  ('creator_pro', 'job.publish'),
  ('creator_pro', 'event.publish'),
  ('creator_pro', 'course.publish'),
  ('creator_pro', 'job.manage_applicants'),
  ('creator_pro', 'event.manage_attendees'),
  ('creator_pro', 'course.manage_students'),
  ('organization_pro', 'job.apply'),
  ('organization_pro', 'event.attend'),
  ('organization_pro', 'course.enroll'),
  ('organization_pro', 'job.publish'),
  ('organization_pro', 'event.publish'),
  ('organization_pro', 'course.publish'),
  ('organization_pro', 'job.manage_applicants'),
  ('organization_pro', 'event.manage_attendees'),
  ('organization_pro', 'course.manage_students'),
  ('organization_pro', 'organization.manage'),
  ('organization_pro', 'organization.team'),
  ('organization_pro', 'organization.branding'),
  ('organization_pro', 'analytics.view'),
  ('organization_pro', 'billing.manage')
on conflict (plan_code, capability) do nothing;
-- statement-breakpoint

insert into public.entitlement_grants (company_id, capability, source, reason)
select distinct
  company.id,
  'job.manage_applicants',
  'legacy_migration',
  'Preserve existing verified organization applicant-management access after the membership foundation migration.'
from public.companies company
join public.company_members member on member.company_id = company.id
where company.is_verified = true
  and member.approved_at is not null
  and member.role::text in ('owner', 'administrator', 'recruiter')
on conflict do nothing;
-- statement-breakpoint

insert into public.entitlement_grants (profile_id, capability, source, reason)
select
  mentor.user_id,
  'course.manage_students',
  'legacy_migration',
  'Preserve existing active trainer learner-management access after the membership foundation migration.'
from public.learning_mentors mentor
where mentor.status = 'active'
on conflict do nothing;
-- statement-breakpoint

insert into public.entitlement_grants (profile_id, capability, source, reason)
select distinct
  event.host_user_id,
  'event.manage_attendees',
  'legacy_migration',
  'Preserve existing event-host attendee-management access after the membership foundation migration.'
from public.events event
on conflict do nothing;
