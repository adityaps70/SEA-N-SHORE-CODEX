-- Sea N Shore membership, persona, verification and paid-capability foundation.
-- Additive compatibility migration: legacy identity fields remain in place.

alter table public.profiles
  add column if not exists persona text,
  add column if not exists profile_intents text[] not null default '{}'::text[],
  add column if not exists community_relationship text,
  add column if not exists institution_name text,
  add column if not exists specialization text;
-- statement-breakpoint

alter table public.profiles
  drop constraint if exists profiles_persona_check,
  add constraint profiles_persona_check check (
    persona is null or persona in (
      'seafarer',
      'shore_professional',
      'recruiter_hr',
      'trainer_instructor',
      'student_cadet',
      'seafarer_family',
      'maritime_enthusiast',
      'other'
    )
  ),
  drop constraint if exists profiles_profile_intents_check,
  add constraint profiles_profile_intents_check check (
    cardinality(profile_intents) <= 8
    and profile_intents <@ array[
      'find_jobs',
      'hire',
      'learn',
      'teach',
      'attend_events',
      'host_events',
      'network',
      'community'
    ]::text[]
  ),
  drop constraint if exists profiles_community_relationship_check,
  add constraint profiles_community_relationship_check check (
    community_relationship is null
    or (
      community_relationship = btrim(community_relationship)
      and char_length(community_relationship) between 2 and 80
    )
  ),
  drop constraint if exists profiles_institution_name_check,
  add constraint profiles_institution_name_check check (
    institution_name is null
    or (
      institution_name = btrim(institution_name)
      and char_length(institution_name) between 2 and 160
    )
  ),
  drop constraint if exists profiles_specialization_check,
  add constraint profiles_specialization_check check (
    specialization is null
    or (
      specialization = btrim(specialization)
      and char_length(specialization) between 2 and 500
    )
  );
-- statement-breakpoint

-- Deterministic existing-user persona backfill.
-- Only completed legacy personal profiles with no explicit persona are touched.
-- Ambiguous legacy identities remain null so the member can choose through progressive prompting.
update public.profiles
set persona = case
  when profile_type::text = 'seafarer'
    and coalesce(identity_root::text, 'professional') <> 'organisation'
    then 'seafarer'
  when profile_type::text = 'trainer'
    and coalesce(identity_root::text, 'professional') <> 'organisation'
    then 'trainer_instructor'
  when profile_type::text = 'recruiter'
    and coalesce(identity_root::text, 'professional') <> 'organisation'
    then 'recruiter_hr'
  when identity_root::text = 'professional'
    and primary_identity in ('Maritime Recruiter', 'Crewing Recruiter', 'Maritime HR Professional')
    then 'recruiter_hr'
  when identity_root::text = 'professional'
    and primary_identity in ('Maritime Trainer', 'Nautical Instructor', 'Engineering Instructor', 'Simulator Instructor', 'STCW Assessor', 'Maritime Academy Faculty')
    then 'trainer_instructor'
  when identity_root::text = 'professional'
    and primary_identity_family in ('Sea-going · Deck', 'Sea-going · Engine', 'Sea-going · Electrical', 'Shipboard · Hotel & Medical')
    then 'seafarer'
  when identity_root::text = 'professional'
    and primary_identity_family in (
      'Ship Management & Operations',
      'Commercial Shipping',
      'Survey, Class & Assurance',
      'Ports & Terminals',
      'Legal, Insurance & Finance',
      'Training, Research & Human Factors',
      'Technology, Data & Logistics',
      'Recruitment, Welfare & Public Sector'
    )
    then 'shore_professional'
  else persona
end,
updated_at = now()
where persona is null
  and onboarding_completed_at is not null
  and coalesce(identity_root::text, 'professional') <> 'organisation'
  and (
    profile_type::text in ('seafarer', 'trainer', 'recruiter')
    or (
      identity_root::text = 'professional'
      and (
        primary_identity in (
          'Maritime Recruiter',
          'Crewing Recruiter',
          'Maritime HR Professional',
          'Maritime Trainer',
          'Nautical Instructor',
          'Engineering Instructor',
          'Simulator Instructor',
          'STCW Assessor',
          'Maritime Academy Faculty'
        )
        or primary_identity_family in (
          'Sea-going · Deck',
          'Sea-going · Engine',
          'Sea-going · Electrical',
          'Shipboard · Hotel & Medical',
          'Ship Management & Operations',
          'Commercial Shipping',
          'Survey, Class & Assurance',
          'Ports & Terminals',
          'Legal, Insurance & Finance',
          'Training, Research & Human Factors',
          'Technology, Data & Logistics',
          'Recruitment, Welfare & Public Sector'
        )
      )
    )
  );
-- statement-breakpoint

-- New persona onboarding is accepted alongside exact-identity and legacy-complete profiles.
alter table public.profiles
  drop constraint if exists profiles_completed_identity_check,
  add constraint profiles_completed_identity_check check (
    onboarding_completed_at is null
    or (
      profile_type is not null
      and slug is not null
      and (
        (
          persona is not null
          and headline is not null
          and char_length(headline) between 2 and 160
        )
        or (
          identity_root is not null
          and primary_identity is not null
          and primary_identity_family is not null
          and headline is not null
          and char_length(headline) between 2 and 160
        )
        or (
          headline is not null
          and char_length(headline) between 4 and 160
          and summary is not null
          and char_length(summary) between 20 and 2000
        )
      )
    )
  );
-- statement-breakpoint

-- Extend organization workspace roles without changing existing memberships.
alter type public.company_member_role add value if not exists 'lms_manager';
-- statement-breakpoint
alter type public.company_member_role add value if not exists 'event_manager';
-- statement-breakpoint
alter type public.company_member_role add value if not exists 'content_manager';
-- statement-breakpoint
alter type public.company_member_role add value if not exists 'analyst';
-- statement-breakpoint

-- Existing organization access requests support every non-owner workspace role.
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

-- Free members can follow organization workspaces without becoming organization members.
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

-- Events keep the responsible human host while optionally publishing under an organization workspace.
alter table public.events
  add column if not exists company_id uuid references public.companies(id) on delete set null;
-- statement-breakpoint

create index if not exists events_company_idx
  on public.events (company_id, status, start_at desc)
  where company_id is not null;
-- statement-breakpoint

-- Courses keep a responsible human creator while optionally publishing under an organization workspace.
alter table public.learning_courses
  add column if not exists created_by_user_id uuid references public.profiles(id) on delete restrict,
  add column if not exists company_id uuid references public.companies(id) on delete set null;
-- statement-breakpoint

update public.learning_courses course
set created_by_user_id = mentor.user_id
from public.learning_mentors mentor
where mentor.id = course.mentor_id
  and course.created_by_user_id is null;
-- statement-breakpoint

alter table public.learning_courses
  alter column created_by_user_id set not null,
  alter column mentor_id drop not null;
-- statement-breakpoint

alter table public.learning_courses
  drop constraint if exists learning_courses_publisher_shape_check,
  add constraint learning_courses_publisher_shape_check check (
    (company_id is null and mentor_id is not null)
    or (company_id is not null)
  );
-- statement-breakpoint

create index if not exists learning_courses_company_idx
  on public.learning_courses (company_id, status, updated_at desc, id desc)
  where company_id is not null;
-- statement-breakpoint

create table if not exists public.legacy_organization_conversions (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  strategy text,
  company_id uuid references public.companies(id) on delete set null,
  legacy_snapshot jsonb not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legacy_organization_conversions_status_check check (
    status in ('pending', 'completed')
  ),
  constraint legacy_organization_conversions_strategy_check check (
    strategy is null or strategy in ('existing', 'create')
  )
);
-- statement-breakpoint

insert into public.legacy_organization_conversions (
  profile_id,
  status,
  legacy_snapshot,
  created_at,
  updated_at
)
select
  p.id,
  'pending',
  jsonb_build_object(
    'organizationName', p.full_name,
    'headline', p.headline,
    'summary', p.summary,
    'location', p.location,
    'avatarPath', p.avatar_path,
    'primaryIdentity', p.primary_identity,
    'primaryIdentityFamily', p.primary_identity_family,
    'secondaryIdentities', p.secondary_identities
  ),
  now(),
  now()
from public.profiles p
where p.identity_root = 'organisation'
  and p.onboarding_completed_at is not null
on conflict (profile_id) do nothing;
-- statement-breakpoint

create index if not exists legacy_organization_conversions_status_idx
  on public.legacy_organization_conversions (status, updated_at asc, profile_id asc);
-- statement-breakpoint

create table if not exists public.plan_entitlements (
  plan_code text not null,
  capability text not null,
  created_at timestamptz not null default now(),
  primary key (plan_code, capability),
  constraint plan_entitlements_plan_check check (
    plan_code in ('free', 'creator_pro', 'organization_pro')
  ),
  constraint plan_entitlements_capability_check check (
    capability in (
      'job.apply',
      'event.attend',
      'course.enroll',
      'job.publish',
      'event.publish',
      'course.publish',
      'job.manage_applicants',
      'event.manage_attendees',
      'course.manage_students',
      'organization.manage',
      'organization.team',
      'organization.branding',
      'analytics.view',
      'billing.manage'
    )
  )
);
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

create table if not exists public.account_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  plan_code text not null,
  status text not null default 'active',
  billing_provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_subscriptions_subject_check check (
    (profile_id is not null and company_id is null)
    or (profile_id is null and company_id is not null)
  ),
  constraint account_subscriptions_plan_check check (
    (profile_id is not null and plan_code = 'creator_pro')
    or (company_id is not null and plan_code = 'organization_pro')
  ),
  constraint account_subscriptions_status_check check (
    status in ('pending', 'trialing', 'active', 'past_due', 'cancelled', 'expired')
  ),
  constraint account_subscriptions_provider_check check (
    billing_provider is null or char_length(billing_provider) between 2 and 80
  )
);
-- statement-breakpoint

create unique index if not exists account_subscriptions_profile_active_uq
  on public.account_subscriptions (profile_id)
  where profile_id is not null and status in ('trialing', 'active', 'past_due');
-- statement-breakpoint

create unique index if not exists account_subscriptions_company_active_uq
  on public.account_subscriptions (company_id)
  where company_id is not null and status in ('trialing', 'active', 'past_due');
-- statement-breakpoint

create unique index if not exists account_subscriptions_provider_subscription_uq
  on public.account_subscriptions (billing_provider, provider_subscription_id)
  where provider_subscription_id is not null;
-- statement-breakpoint

create table if not exists public.feature_verifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  verification_type text not null,
  status text not null default 'pending',
  source text not null default 'application',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_verifications_type_check check (
    verification_type in ('recruiter', 'trainer', 'event_host')
  ),
  constraint feature_verifications_status_check check (
    status in ('pending', 'approved', 'rejected', 'suspended')
  ),
  constraint feature_verifications_source_check check (
    source in ('application', 'company_membership', 'mentor_approval', 'legacy_event_host', 'admin')
  ),
  constraint feature_verifications_note_check check (
    review_note is null or char_length(review_note) <= 4000
  ),
  unique (profile_id, verification_type)
);
-- statement-breakpoint

alter table public.feature_verifications
  add column if not exists application_payload jsonb not null default '{}'::jsonb,
  add column if not exists submitted_at timestamptz;
-- statement-breakpoint

update public.feature_verifications
set submitted_at = coalesce(submitted_at, created_at)
where submitted_at is null;
-- statement-breakpoint

alter table public.feature_verifications
  drop constraint if exists feature_verifications_payload_object_check,
  add constraint feature_verifications_payload_object_check check (
    jsonb_typeof(application_payload) = 'object'
  );
-- statement-breakpoint

create index if not exists feature_verifications_admin_queue_idx
  on public.feature_verifications (verification_type, status, updated_at asc, id asc);
-- statement-breakpoint

create table if not exists public.entitlement_grants (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  capability text not null,
  source text not null,
  reason text,
  granted_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint entitlement_grants_subject_check check (
    (profile_id is not null and company_id is null)
    or (profile_id is null and company_id is not null)
  ),
  constraint entitlement_grants_capability_check check (
    capability in (
      'job.apply',
      'event.attend',
      'course.enroll',
      'job.publish',
      'event.publish',
      'course.publish',
      'job.manage_applicants',
      'event.manage_attendees',
      'course.manage_students',
      'organization.manage',
      'organization.team',
      'organization.branding',
      'analytics.view',
      'billing.manage'
    )
  ),
  constraint entitlement_grants_source_check check (
    source in ('legacy_migration', 'admin', 'promotion', 'support')
  ),
  constraint entitlement_grants_reason_check check (
    reason is null or char_length(reason) <= 1000
  )
);
-- statement-breakpoint

create unique index if not exists entitlement_grants_profile_active_uq
  on public.entitlement_grants (profile_id, capability)
  where profile_id is not null and revoked_at is null;
-- statement-breakpoint

create unique index if not exists entitlement_grants_company_active_uq
  on public.entitlement_grants (company_id, capability)
  where company_id is not null and revoked_at is null;
-- statement-breakpoint

-- Preserve existing approved recruiter trust as verification.
insert into public.feature_verifications (
  profile_id, verification_type, status, source, reviewed_at, created_at, updated_at
)
select distinct
  cm.user_id,
  'recruiter',
  'approved',
  'company_membership',
  coalesce(cm.approved_at, now()),
  now(),
  now()
from public.company_members cm
join public.companies c on c.id = cm.company_id
where cm.approved_at is not null
  and cm.role::text in ('owner', 'administrator', 'recruiter')
  and coalesce(c.is_verified, false) = true
on conflict (profile_id, verification_type) do nothing;
-- statement-breakpoint

-- Preserve existing active mentors as verified trainers.
insert into public.feature_verifications (
  profile_id, verification_type, status, source, reviewed_at, created_at, updated_at
)
select
  lm.user_id,
  'trainer',
  'approved',
  'mentor_approval',
  lm.approved_at,
  now(),
  now()
from public.learning_mentors lm
where lm.status = 'active'
on conflict (profile_id, verification_type) do nothing;
-- statement-breakpoint

-- Existing event hosts retain the event-host trust they already exercised.
insert into public.feature_verifications (
  profile_id, verification_type, status, source, reviewed_at, created_at, updated_at
)
select distinct
  e.host_user_id,
  'event_host',
  'approved',
  'legacy_event_host',
  now(),
  now(),
  now()
from public.events e
on conflict (profile_id, verification_type) do nothing;
-- statement-breakpoint

-- Narrow grandfather grants preserve only capabilities users already had before paid plans.
insert into public.entitlement_grants (company_id, capability, source, reason)
select distinct
  c.id,
  entitlement.capability,
  'legacy_migration',
  'Preserve existing verified organization hiring access during paid-plan migration.'
from public.companies c
join public.company_members cm on cm.company_id = c.id
cross join (
  values ('job.publish'::text), ('job.manage_applicants'::text)
) as entitlement(capability)
where c.is_verified = true
  and cm.approved_at is not null
  and cm.role::text in ('owner', 'administrator', 'recruiter')
on conflict do nothing;
-- statement-breakpoint

insert into public.entitlement_grants (profile_id, capability, source, reason)
select
  lm.user_id,
  'course.publish',
  'legacy_migration',
  'Preserve existing active mentor course-authoring access during paid-plan migration.'
from public.learning_mentors lm
where lm.status = 'active'
on conflict do nothing;
-- statement-breakpoint

insert into public.entitlement_grants (profile_id, capability, source, reason)
select distinct
  e.host_user_id,
  'event.publish',
  'legacy_migration',
  'Preserve existing event-host publishing access during paid-plan migration.'
from public.events e
on conflict do nothing;
