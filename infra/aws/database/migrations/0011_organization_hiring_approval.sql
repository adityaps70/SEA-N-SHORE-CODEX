-- Sea N Shore Organization Hiring Approval: additive employer verification workflow.

create table if not exists public.organization_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  official_email text not null,
  registration_reference text,
  applicant_role text not null,
  supporting_notes text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  admin_review_note text,
  constraint organization_applications_status_check check (
    status in ('pending', 'changes_requested', 'approved', 'rejected', 'suspended')
  ),
  constraint organization_applications_email_check check (
    official_email = lower(btrim(official_email)) and char_length(official_email) between 3 and 320
  ),
  constraint organization_applications_reference_check check (
    registration_reference is null or char_length(registration_reference) <= 160
  ),
  constraint organization_applications_role_check check (
    applicant_role = btrim(applicant_role) and char_length(applicant_role) between 2 and 160
  ),
  constraint organization_applications_supporting_notes_check check (
    supporting_notes is null or char_length(supporting_notes) <= 4000
  ),
  constraint organization_applications_admin_note_check check (
    admin_review_note is null or char_length(admin_review_note) <= 4000
  )
);
-- statement-breakpoint

create table if not exists public.company_access_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_role public.company_member_role not null,
  request_type text not null,
  message text,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewer_note text,
  constraint company_access_requests_type_check check (
    request_type in ('join_company', 'recruiter_access')
  ),
  constraint company_access_requests_status_check check (
    status in ('pending', 'approved', 'rejected', 'cancelled')
  ),
  constraint company_access_requests_role_check check (
    requested_role::text in ('member', 'recruiter', 'administrator')
  ),
  constraint company_access_requests_type_role_check check (
    (request_type = 'join_company' and requested_role::text = 'member')
    or (request_type = 'recruiter_access' and requested_role::text in ('recruiter', 'administrator'))
  ),
  constraint company_access_requests_message_check check (
    message is null or char_length(message) <= 2000
  ),
  constraint company_access_requests_reviewer_note_check check (
    reviewer_note is null or char_length(reviewer_note) <= 4000
  )
);
-- statement-breakpoint

create unique index if not exists company_access_requests_pending_unique
  on public.company_access_requests (company_id, user_id, requested_role)
  where status = 'pending';
-- statement-breakpoint

create index if not exists organization_applications_admin_queue_idx
  on public.organization_applications (status, submitted_at asc, id asc);
-- statement-breakpoint

create index if not exists organization_applications_user_idx
  on public.organization_applications (submitted_by, updated_at desc, id desc);
-- statement-breakpoint

create index if not exists company_access_requests_admin_queue_idx
  on public.company_access_requests (status, requested_at asc, id asc);
-- statement-breakpoint

create index if not exists company_access_requests_user_idx
  on public.company_access_requests (user_id, requested_at desc, id desc);
-- statement-breakpoint

create index if not exists company_access_requests_company_idx
  on public.company_access_requests (company_id, status, requested_at asc, id asc);
-- statement-breakpoint

-- Compatibility backfill: before verified-company authorization is enforced,
-- preserve every employer that already has an approved hiring-capable membership.
update public.companies c
set is_verified = true,
    verified_at = coalesce(c.verified_at, now()),
    updated_at = now()
from public.company_members cm
where c.id = cm.company_id
  and cm.approved_at is not null
  and cm.role::text in ('owner', 'administrator', 'recruiter')
  and c.is_verified = false;
