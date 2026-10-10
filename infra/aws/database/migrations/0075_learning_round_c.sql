-- Sea N Shore learning round C: trainer operations and selling.
--   C1 learner roster: trainers can enrol members ('trainer' enrolments) and invite people who are not members yet.
--   C2 promo codes: per course or for all of a trainer's courses, with atomic usage limits.
--   C3 pricing plans and access expiry: a course can have several plans, each with its own price and access period.
--   C5 ratings, reviews (moderated) and course announcements.
--   C7 a course can link to one community.
--   C0 the trainer digest also counts written quiz answers awaiting grading.
--
-- Additive and safe to run more than once. It relaxes exactly five existing checks, as approved for round C:
--   1. course_payment_orders.amount_minor = sale-or-list price minus the promo discount (the discount is 0 for
--      every existing order, so they still satisfy it);
--   2. learning_enrollments.enrollment_source also allows 'trainer';
--   3. content_reports.target_type also allows 'course_review';
--   4. moderation_actions.target_type also allows 'course_review';
--   5. learning_notification_emails.kind also allows 'announcement'.
-- The backfill only inserts: every paid course (and each open draft revision of one) gets a "Standard" plan with
-- lifetime access at its current price. Existing enrolments and orders keep plan_id null, which means lifetime
-- access exactly as today; no existing row is changed.

create table if not exists public.learning_course_plans (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  name text not null,
  price_minor bigint not null,
  discount_price_minor bigint,
  currency varchar(3) not null default 'INR',
  access_months integer,
  position integer not null default 0,
  source_plan_id uuid references public.learning_course_plans(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_course_plans_name_check check (char_length(btrim(name)) between 1 and 60),
  constraint learning_course_plans_price_check check (price_minor > 0),
  constraint learning_course_plans_discount_check check (
    discount_price_minor is null or (discount_price_minor > 0 and discount_price_minor < price_minor)
  ),
  constraint learning_course_plans_currency_check check (currency in ('INR', 'USD')),
  constraint learning_course_plans_access_check check (access_months is null or access_months in (6, 12)),
  constraint learning_course_plans_position_check check (position between 0 and 20)
);
-- statement-breakpoint

create index if not exists learning_course_plans_course_idx
  on public.learning_course_plans (course_id, position, id)
  where archived_at is null;
-- statement-breakpoint

create unique index if not exists learning_course_plans_name_uq
  on public.learning_course_plans (course_id, lower(btrim(name)))
  where archived_at is null;
-- statement-breakpoint

alter table public.learning_enrollments
  add column if not exists plan_id uuid references public.learning_course_plans(id) on delete set null,
  add column if not exists access_expires_at timestamptz,
  add column if not exists enrolled_by uuid references public.profiles(id) on delete set null;
-- statement-breakpoint

-- Relaxation 2: a trainer can enrol a member.
alter table public.learning_enrollments
  drop constraint if exists learning_enrollments_source_check,
  add constraint learning_enrollments_source_check check (enrollment_source in ('free', 'purchase', 'admin', 'trainer'));
-- statement-breakpoint

create index if not exists learning_enrollments_course_enrolled_idx
  on public.learning_enrollments (course_id, enrolled_at);
-- statement-breakpoint

create table if not exists public.learning_course_invitations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  email text not null,
  invited_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending',
  email_status text not null default 'pending',
  email_attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  resend_message_id text,
  accepted_profile_id uuid references public.profiles(id) on delete set null,
  enrollment_id uuid references public.learning_enrollments(id) on delete set null,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz not null default (now() + interval '60 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_course_invitations_email_check check (
    email = lower(btrim(email)) and char_length(email) between 3 and 254 and position('@' in email) > 1
  ),
  constraint learning_course_invitations_status_check check (status in ('pending', 'accepted', 'cancelled')),
  constraint learning_course_invitations_email_status_check check (email_status in ('pending', 'sent', 'failed')),
  constraint learning_course_invitations_attempts_check check (email_attempts between 0 and 20)
);
-- statement-breakpoint

create unique index if not exists learning_course_invitations_pending_uq
  on public.learning_course_invitations (course_id, email)
  where status = 'pending';
-- statement-breakpoint

create index if not exists learning_course_invitations_email_idx
  on public.learning_course_invitations (email)
  where status = 'pending';
-- statement-breakpoint

create index if not exists learning_course_invitations_sending_idx
  on public.learning_course_invitations (next_attempt_at, id)
  where status = 'pending' and email_status = 'pending';
-- statement-breakpoint

create table if not exists public.learning_promo_codes (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid references public.learning_mentors(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  course_id uuid references public.learning_courses(id) on delete cascade,
  code text not null,
  discount_type text not null,
  percent_off numeric(5,2),
  amount_off_minor bigint,
  currency varchar(3),
  max_discount_minor bigint,
  usage_limit integer,
  per_member_limit integer,
  used_count integer not null default 0,
  valid_from timestamptz,
  valid_until timestamptz,
  disabled_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_promo_codes_owner_check check (num_nonnulls(mentor_id, company_id) = 1),
  constraint learning_promo_codes_code_check check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  constraint learning_promo_codes_type_check check (discount_type in ('percent', 'fixed')),
  constraint learning_promo_codes_value_check check (
    (discount_type = 'percent' and percent_off > 0 and percent_off <= 100 and amount_off_minor is null)
    or (discount_type = 'fixed' and amount_off_minor > 0 and percent_off is null and currency is not null)
  ),
  constraint learning_promo_codes_currency_check check (currency is null or currency in ('INR', 'USD')),
  constraint learning_promo_codes_max_check check (
    max_discount_minor is null or (max_discount_minor > 0 and currency is not null)
  ),
  constraint learning_promo_codes_usage_check check (usage_limit is null or usage_limit between 1 and 1000000),
  constraint learning_promo_codes_member_check check (per_member_limit is null or per_member_limit between 1 and 1000),
  constraint learning_promo_codes_used_check check (used_count >= 0),
  constraint learning_promo_codes_window_check check (
    valid_from is null or valid_until is null or valid_until > valid_from
  )
);
-- statement-breakpoint

create unique index if not exists learning_promo_codes_mentor_code_uq
  on public.learning_promo_codes (mentor_id, code)
  where mentor_id is not null;
-- statement-breakpoint

create unique index if not exists learning_promo_codes_company_code_uq
  on public.learning_promo_codes (company_id, code)
  where company_id is not null;
-- statement-breakpoint

alter table public.course_payment_orders
  add column if not exists plan_id uuid references public.learning_course_plans(id) on delete set null,
  add column if not exists plan_name text check (plan_name is null or char_length(plan_name) <= 60),
  add column if not exists access_months integer check (access_months is null or access_months in (6, 12)),
  add column if not exists promo_code_id uuid references public.learning_promo_codes(id) on delete set null,
  add column if not exists promo_code text check (promo_code is null or char_length(promo_code) <= 32),
  add column if not exists promo_discount_minor bigint not null default 0 check (promo_discount_minor >= 0);
-- statement-breakpoint

-- Relaxation 1: the order amount is the sale-or-list price minus the promo discount (0 for every existing order).
alter table public.course_payment_orders
  drop constraint if exists course_payment_orders_amount_check,
  add constraint course_payment_orders_amount_check check (amount_minor = coalesce(discount_price_minor, list_price_minor) - promo_discount_minor);
-- statement-breakpoint

create index if not exists course_payment_orders_course_paid_idx
  on public.course_payment_orders (course_id, paid_at)
  where status in ('paid', 'refunded');
-- statement-breakpoint

create table if not exists public.learning_promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.learning_promo_codes(id) on delete cascade,
  order_id uuid not null references public.course_payment_orders(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  course_id uuid references public.learning_courses(id) on delete set null,
  discount_minor bigint not null,
  currency varchar(3) not null,
  status text not null default 'reserved',
  reserved_until timestamptz not null,
  redeemed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_promo_redemptions_discount_check check (discount_minor > 0),
  constraint learning_promo_redemptions_currency_check check (currency in ('INR', 'USD')),
  constraint learning_promo_redemptions_status_check check (status in ('reserved', 'redeemed', 'released'))
);
-- statement-breakpoint

create unique index if not exists learning_promo_redemptions_order_uq
  on public.learning_promo_redemptions (order_id);
-- statement-breakpoint

create index if not exists learning_promo_redemptions_code_idx
  on public.learning_promo_redemptions (code_id, status, profile_id);
-- statement-breakpoint

create table if not exists public.learning_course_reviews (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  enrollment_id uuid references public.learning_enrollments(id) on delete set null,
  rating smallint not null,
  body text not null default '',
  status text not null default 'pending',
  moderated_by uuid references public.profiles(id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_course_reviews_rating_check check (rating between 1 and 5),
  constraint learning_course_reviews_body_check check (char_length(body) <= 2000),
  constraint learning_course_reviews_status_check check (status in ('pending', 'approved', 'rejected', 'removed'))
);
-- statement-breakpoint

create unique index if not exists learning_course_reviews_course_learner_uq
  on public.learning_course_reviews (course_id, learner_id);
-- statement-breakpoint

create index if not exists learning_course_reviews_course_idx
  on public.learning_course_reviews (course_id, status, updated_at desc, id desc);
-- statement-breakpoint

create index if not exists learning_course_reviews_pending_idx
  on public.learning_course_reviews (updated_at, id)
  where status = 'pending';
-- statement-breakpoint

-- Relaxation 3: a course review can be reported.
alter table public.content_reports
  drop constraint if exists content_reports_target_type_check,
  add constraint content_reports_target_type_check check (target_type in ('post', 'comment', 'job', 'event', 'profile', 'group', 'course_review'));
-- statement-breakpoint

-- Relaxation 4: a course review can be moderated.
alter table public.moderation_actions
  drop constraint if exists moderation_actions_target_type_check,
  add constraint moderation_actions_target_type_check check (target_type in ('post', 'comment', 'job', 'event', 'profile', 'group', 'course_review'));
-- statement-breakpoint

create table if not exists public.learning_course_announcements (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  title text not null,
  body text not null,
  recipient_count integer not null default 0,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint learning_course_announcements_title_check check (char_length(btrim(title)) between 1 and 140),
  constraint learning_course_announcements_body_check check (char_length(btrim(body)) between 1 and 5000),
  constraint learning_course_announcements_recipients_check check (recipient_count >= 0)
);
-- statement-breakpoint

create index if not exists learning_course_announcements_course_idx
  on public.learning_course_announcements (course_id, created_at desc, id desc)
  where removed_at is null;
-- statement-breakpoint

-- Relaxation 5: course announcements are Learning emails.
alter table public.learning_notification_emails
  drop constraint if exists learning_notification_emails_kind_check,
  add constraint learning_notification_emails_kind_check check (kind in ('enrolled', 'lessons_released', 'assignment_graded', 'certificate_issued', 'course_approved', 'course_changes_requested', 'submissions_to_grade', 'quiz_graded', 'certificate_expiring', 'announcement'));
-- statement-breakpoint

alter table public.learning_courses
  add column if not exists community_group_id uuid references public.community_groups(id) on delete set null;
-- statement-breakpoint

alter table public.learning_quiz_attempts
  add column if not exists trainer_digest_at timestamptz;
-- statement-breakpoint

create index if not exists learning_quiz_attempts_digest_idx
  on public.learning_quiz_attempts (quiz_id, id)
  where status = 'awaiting_grading' and trainer_digest_at is null;
-- statement-breakpoint

-- Backfill 1: every paid live course gets a "Standard" plan with lifetime access at its current price.
insert into public.learning_course_plans (course_id, name, price_minor, discount_price_minor, currency, access_months, position)
select
  course.id,
  'Standard',
  course.price_minor,
  case when course.discount_price_minor > 0 and course.discount_price_minor < course.price_minor then course.discount_price_minor end,
  course.currency,
  null,
  0
from public.learning_courses course
where course.revision_of_course_id is null
  and course.access_type = 'paid'
  and course.price_minor > 0
  and course.currency in ('INR', 'USD')
  and not exists (select 1 from public.learning_course_plans plan where plan.course_id = course.id);
-- statement-breakpoint

-- Backfill 2: each open draft revision of a paid course gets its own "Standard" plan, linked to the live plan.
insert into public.learning_course_plans (course_id, name, price_minor, discount_price_minor, currency, access_months, position, source_plan_id)
select
  revision.id,
  'Standard',
  revision.price_minor,
  case when revision.discount_price_minor > 0 and revision.discount_price_minor < revision.price_minor then revision.discount_price_minor end,
  revision.currency,
  null,
  0,
  (
    select live_plan.id
    from public.learning_course_plans live_plan
    where live_plan.course_id = revision.revision_of_course_id
      and live_plan.archived_at is null
    order by live_plan.position, live_plan.id
    limit 1
  )
from public.learning_courses revision
where revision.revision_of_course_id is not null
  and revision.access_type = 'paid'
  and revision.price_minor > 0
  and revision.currency in ('INR', 'USD')
  and not exists (select 1 from public.learning_course_plans plan where plan.course_id = revision.id);
