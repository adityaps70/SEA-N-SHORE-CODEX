-- Sea N Shore organization types and organization-led access decisions.
-- Additive and safe to run more than once.
--
-- 1. Organizations are no longer only maritime companies. companies.organization_type
--    holds a type code (for example ship_manager, mental_health_provider, union);
--    companies.company_type keeps its free-text label, which search and older
--    screens read. Rows created before this migration keep organization_type null
--    and are mapped from company_type by the application, so no existing value is
--    rewritten here.
-- 2. companies.organization_details holds type-specific answers (fleet size,
--    recruitment licence, wellbeing services, languages, 24/7 helpline,
--    accreditation) as a JSON object.
-- 3. Access requests are decided by the organization's owner and administrators.
--    Sea N Shore acts only as a fallback. New columns record the granted role,
--    who decided (organization or platform) and requester escalations.

alter table public.companies
  add column if not exists organization_type text,
  add column if not exists organization_details jsonb not null default '{}'::jsonb;
-- statement-breakpoint

alter table public.companies
  drop constraint if exists companies_organization_type_check,
  add constraint companies_organization_type_check check (
    organization_type is null
    or organization_type ~ '^[a-z][a-z0-9_]{1,59}$'
  ),
  drop constraint if exists companies_organization_details_check,
  add constraint companies_organization_details_check check (
    jsonb_typeof(organization_details) = 'object'
    and pg_column_size(organization_details) <= 16384
  );
-- statement-breakpoint

create index if not exists companies_organization_type_idx
  on public.companies (organization_type)
  where organization_type is not null;
-- statement-breakpoint

alter table public.company_access_requests
  add column if not exists granted_role public.company_member_role,
  add column if not exists decided_via text,
  add column if not exists escalated_at timestamptz,
  add column if not exists escalation_note text;
-- statement-breakpoint

alter table public.company_access_requests
  drop constraint if exists company_access_requests_decided_via_check,
  add constraint company_access_requests_decided_via_check check (
    decided_via is null or decided_via in ('organization', 'platform')
  ),
  drop constraint if exists company_access_requests_escalation_note_check,
  add constraint company_access_requests_escalation_note_check check (
    escalation_note is null or char_length(escalation_note) <= 2000
  );
-- statement-breakpoint

-- Every request reviewed before this migration was decided by a Sea N Shore
-- platform administrator. Record that so requesters cannot escalate a platform
-- decision back to the platform.
update public.company_access_requests
set decided_via = 'platform'
where decided_via is null
  and reviewed_by is not null
  and status in ('approved', 'rejected');
-- statement-breakpoint

update public.company_access_requests
set granted_role = requested_role
where granted_role is null
  and status = 'approved';
-- statement-breakpoint

create index if not exists company_access_requests_escalated_idx
  on public.company_access_requests (escalated_at asc, id asc)
  where status = 'pending' and escalated_at is not null;
