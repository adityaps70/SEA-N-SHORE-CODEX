-- Sea N Shore learning round D, part 3: company training (seat packs for crew).
--   A verified company buys a pack of N seats of one course at the course's price per seat, less a volume discount
--   (10+ seats 10 %, 50+ seats 20 %), paid like any course and invoiced once per pack on a B2B GST invoice. Unassigned
--   seats can be assigned for 12 months from purchase; an assigned seat gives the learner the course's normal plan
--   access. Only Sea N Shore members who accepted the company's invitation, and so agreed to share their progress and
--   certificates for the courses the company assigns them, can be given a seat. Unassigned seats can be refunded
--   within 30 days of purchase (one refund per pack, with a credit note); an assigned seat can move to another crew
--   member while the first learner is at 10 % progress or less.
--
-- Additive and safe to run more than once: new tables, new nullable columns, indexes, checks on new columns only, and
-- one trigger that keeps the consent ledger append-only. No existing check is relaxed and no existing row is changed:
-- every existing order and enrolment keeps null in the new columns.

alter table public.course_payment_orders
  add column if not exists seat_company_id uuid references public.companies(id) on delete restrict,
  add column if not exists seat_quantity integer,
  add column if not exists seat_unit_price_minor bigint,
  add column if not exists seat_volume_discount_basis_points integer;
-- statement-breakpoint

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'course_payment_orders_seat_pack_check') then
    alter table public.course_payment_orders
      add constraint course_payment_orders_seat_pack_check check (
        (seat_company_id is null and seat_quantity is null and seat_unit_price_minor is null
          and seat_volume_discount_basis_points is null)
        or (seat_company_id is not null and seat_quantity between 1 and 1000 and seat_unit_price_minor > 0
          and seat_volume_discount_basis_points in (0, 1000, 2000)
          and amount_minor = seat_unit_price_minor * seat_quantity)
      );
  end if;
end $$;
-- statement-breakpoint

create index if not exists course_payment_orders_seat_company_idx
  on public.course_payment_orders (seat_company_id, created_at desc)
  where seat_company_id is not null;
-- statement-breakpoint

create table if not exists public.company_training_seats (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  order_id uuid not null references public.course_payment_orders(id) on delete restrict,
  course_id uuid not null references public.learning_courses(id) on delete restrict,
  status text not null default 'available',
  valid_until timestamptz not null,
  learner_id uuid references public.profiles(id) on delete set null,
  enrollment_id uuid references public.learning_enrollments(id) on delete set null,
  assigned_at timestamptz,
  assigned_by uuid references public.profiles(id) on delete set null,
  times_assigned integer not null default 0,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_training_seats_status_check check (status in ('available', 'assigned', 'refund_pending', 'refunded')),
  constraint company_training_seats_assignment_check check (
    (status = 'assigned' and assigned_at is not null) or (status <> 'assigned' and learner_id is null and enrollment_id is null)
  ),
  constraint company_training_seats_times_check check (times_assigned between 0 and 1000)
);
-- statement-breakpoint

create index if not exists company_training_seats_company_idx
  on public.company_training_seats (company_id, course_id, status, valid_until);
-- statement-breakpoint

create index if not exists company_training_seats_order_idx on public.company_training_seats (order_id, status);
-- statement-breakpoint

create unique index if not exists company_training_seats_enrollment_key
  on public.company_training_seats (enrollment_id)
  where enrollment_id is not null;
-- statement-breakpoint

alter table public.learning_enrollments
  add column if not exists company_seat_id uuid references public.company_training_seats(id) on delete set null;
-- statement-breakpoint

create index if not exists learning_enrollments_company_seat_idx
  on public.learning_enrollments (company_seat_id)
  where company_seat_id is not null;
-- statement-breakpoint

create table if not exists public.company_training_seat_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.course_payment_orders(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  seat_count integer not null,
  amount_minor bigint not null,
  currency text not null,
  status text not null default 'requested',
  attempts integer not null default 1,
  provider_refund_id text,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  credit_note_id uuid references public.tax_credit_notes(id) on delete restrict,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_training_seat_refunds_count_check check (seat_count between 1 and 1000),
  constraint company_training_seat_refunds_amount_check check (amount_minor > 0),
  constraint company_training_seat_refunds_currency_check check (currency in ('INR', 'USD')),
  constraint company_training_seat_refunds_status_check check (status in ('requested', 'pending', 'processed', 'failed')),
  constraint company_training_seat_refunds_attempts_check check (attempts between 1 and 20),
  constraint company_training_seat_refunds_error_check check (last_error is null or char_length(last_error) <= 300)
);
-- statement-breakpoint

create table if not exists public.company_training_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  vessel text,
  rank text,
  invited_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending',
  email_status text not null default 'pending',
  email_attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  resend_message_id text,
  accepted_profile_id uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_training_invitations_email_check check (
    email = lower(btrim(email)) and char_length(email) between 3 and 254 and position('@' in email) > 1
  ),
  constraint company_training_invitations_vessel_check check (vessel is null or (vessel = btrim(vessel) and char_length(vessel) between 1 and 80)),
  constraint company_training_invitations_rank_check check (rank is null or (rank = btrim(rank) and char_length(rank) between 1 and 80)),
  constraint company_training_invitations_status_check check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  constraint company_training_invitations_email_status_check check (email_status in ('pending', 'sent', 'failed')),
  constraint company_training_invitations_attempts_check check (email_attempts between 0 and 20)
);
-- statement-breakpoint

create unique index if not exists company_training_invitations_pending_key
  on public.company_training_invitations (company_id, email)
  where status = 'pending';
-- statement-breakpoint

create index if not exists company_training_invitations_email_idx
  on public.company_training_invitations (email)
  where status = 'pending';
-- statement-breakpoint

create index if not exists company_training_invitations_sending_idx
  on public.company_training_invitations (next_attempt_at, id)
  where status = 'pending' and email_status = 'pending';
-- statement-breakpoint

create table if not exists public.company_training_learners (
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active',
  vessel text,
  rank text,
  invitation_id uuid references public.company_training_invitations(id) on delete set null,
  consent_version text not null,
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, profile_id),
  constraint company_training_learners_status_check check (status in ('active', 'withdrawn', 'removed')),
  constraint company_training_learners_vessel_check check (vessel is null or (vessel = btrim(vessel) and char_length(vessel) between 1 and 80)),
  constraint company_training_learners_rank_check check (rank is null or (rank = btrim(rank) and char_length(rank) between 1 and 80)),
  constraint company_training_learners_consent_version_check check (consent_version ~ '^[a-z0-9-]{1,40}$')
);
-- statement-breakpoint

create index if not exists company_training_learners_profile_idx on public.company_training_learners (profile_id, status);
-- statement-breakpoint

create table if not exists public.company_training_consent_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event text not null,
  consent_version text not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint company_training_consent_events_event_check check (event in ('granted', 'withdrawn')),
  constraint company_training_consent_events_version_check check (consent_version ~ '^[a-z0-9-]{1,40}$'),
  constraint company_training_consent_events_source_check check (source in ('invitation', 'my_learning', 'company_removed'))
);
-- statement-breakpoint

create index if not exists company_training_consent_events_member_idx
  on public.company_training_consent_events (profile_id, company_id, created_at desc);
-- statement-breakpoint

create or replace function public.company_training_consent_is_append_only()
returns trigger
language plpgsql
as $$
begin
  -- A member or company being erased removes the rows by cascade; every other change is refused.
  if tg_op = 'DELETE' and not exists (select 1 from public.profiles where id = old.profile_id) then
    return old;
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.companies where id = old.company_id) then
    return old;
  end if;
  raise exception 'Consent events cannot be changed or removed.' using errcode = 'P0001';
end;
$$;
-- statement-breakpoint

create or replace trigger company_training_consent_events_append_only
before update or delete on public.company_training_consent_events
for each row execute function public.company_training_consent_is_append_only();
