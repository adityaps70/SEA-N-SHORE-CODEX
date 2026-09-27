-- Sea N Shore payments: Cashfree gateway foundation and the seller earnings ledger.
-- Additive and safe to run more than once. No existing row is rewritten.
--
-- 1. Payment tables from 0035 accept provider 'cashfree' as well as 'razorpay'.
-- 2. public.event_payment_orders keeps the Cashfree checkout session (so a double
--    click reopens the same checkout) and tracks refunds requested through the site.
-- 3. public.payment_customer_contacts: the mobile number a buyer gave at checkout
--    (Cashfree requires one on every order), reused for their next payment.
-- 4. public.payment_audit_events: an append-only trail of every money state change.
-- 5. Seller earnings ledger: platform fee settings (one row), per-seller fee
--    overrides, and one earnings row per sale (event ticket, course purchase) or
--    refund adjustment. A seller is either a member profile or an organization.

alter table public.event_payment_orders
  drop constraint if exists event_payment_orders_provider_check,
  add constraint event_payment_orders_provider_check check (provider in ('razorpay', 'cashfree'));
-- statement-breakpoint

alter table public.payment_webhook_events
  drop constraint if exists payment_webhook_events_provider_check,
  add constraint payment_webhook_events_provider_check check (provider in ('razorpay', 'cashfree'));
-- statement-breakpoint

alter table public.event_payment_orders
  add column if not exists provider_session_id text,
  add column if not exists refund_status text,
  add column if not exists refund_attempts integer not null default 0,
  add column if not exists provider_refund_id text,
  add column if not exists refund_requested_at timestamptz,
  add column if not exists refund_requested_by uuid references public.profiles(id) on delete set null;
-- statement-breakpoint

alter table public.event_payment_orders
  drop constraint if exists event_payment_orders_refund_status_check,
  add constraint event_payment_orders_refund_status_check check (
    refund_status is null or refund_status in ('requested', 'pending', 'processed', 'failed')
  ),
  drop constraint if exists event_payment_orders_refund_attempts_check,
  add constraint event_payment_orders_refund_attempts_check check (refund_attempts between 0 and 20),
  drop constraint if exists event_payment_orders_provider_session_check,
  add constraint event_payment_orders_provider_session_check check (
    provider_session_id is null or char_length(provider_session_id) between 1 and 1000
  );
-- statement-breakpoint

create table if not exists public.payment_customer_contacts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint

create table if not exists public.payment_audit_events (
  id bigint generated always as identity primary key,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_type text not null check (actor_type in ('system', 'member', 'organizer', 'admin', 'provider')),
  subject_type text not null check (char_length(subject_type) between 1 and 60),
  subject_id text not null check (char_length(subject_id) between 1 and 200),
  action text not null check (char_length(action) between 1 and 80),
  from_status text,
  to_status text,
  amount_minor bigint,
  currency text,
  provider text,
  provider_reference text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- statement-breakpoint

create index if not exists payment_audit_events_subject_idx
  on public.payment_audit_events (subject_type, subject_id, created_at desc);
-- statement-breakpoint

create table if not exists public.platform_fee_settings (
  id boolean primary key default true check (id),
  default_percent numeric(5,2) not null default 10.00 check (default_percent between 0 and 100),
  hold_days integer not null default 7 check (hold_days between 0 and 365),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint

insert into public.platform_fee_settings (id, default_percent, hold_days)
values (true, 10.00, 7)
on conflict (id) do nothing;
-- statement-breakpoint

create table if not exists public.seller_fee_overrides (
  id uuid primary key default gen_random_uuid(),
  seller_profile_id uuid references public.profiles(id) on delete cascade,
  seller_company_id uuid references public.companies(id) on delete cascade,
  percent numeric(5,2) not null check (percent between 0 and 100),
  note text check (note is null or char_length(note) <= 500),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_fee_overrides_one_seller_check check (
    (seller_profile_id is null) <> (seller_company_id is null)
  )
);
-- statement-breakpoint

create unique index if not exists seller_fee_overrides_profile_key
  on public.seller_fee_overrides (seller_profile_id)
  where seller_profile_id is not null;
-- statement-breakpoint

create unique index if not exists seller_fee_overrides_company_key
  on public.seller_fee_overrides (seller_company_id)
  where seller_company_id is not null;
-- statement-breakpoint

create table if not exists public.seller_earnings (
  id uuid primary key default gen_random_uuid(),
  seller_profile_id uuid references public.profiles(id) on delete restrict,
  seller_company_id uuid references public.companies(id) on delete restrict,
  source_type text not null check (source_type in ('event_ticket', 'course_purchase', 'adjustment')),
  source_id text not null check (char_length(source_id) between 1 and 200),
  adjusts_earning_id uuid references public.seller_earnings(id) on delete restrict,
  currency text not null check (currency in ('INR', 'USD')),
  gross_minor bigint not null,
  platform_fee_percent numeric(5,2) not null check (platform_fee_percent between 0 and 100),
  platform_fee_minor bigint not null,
  net_minor bigint not null,
  status text not null default 'pending' check (status in ('pending', 'available', 'in_payout', 'paid', 'reversed')),
  available_at timestamptz not null,
  payout_id uuid,
  reversed_reason text check (reversed_reason is null or char_length(reversed_reason) <= 500),
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_earnings_one_seller_check check (
    (seller_profile_id is null) <> (seller_company_id is null)
  ),
  constraint seller_earnings_source_key unique (source_type, source_id),
  constraint seller_earnings_amounts_check check (
    net_minor = gross_minor - platform_fee_minor
    and (
      (source_type <> 'adjustment' and gross_minor > 0 and platform_fee_minor between 0 and gross_minor)
      or (source_type = 'adjustment' and adjusts_earning_id is not null and gross_minor < 0 and platform_fee_minor between gross_minor and 0)
    )
  )
);
-- statement-breakpoint

create index if not exists seller_earnings_profile_idx
  on public.seller_earnings (seller_profile_id, status, available_at)
  where seller_profile_id is not null;
-- statement-breakpoint

create index if not exists seller_earnings_company_idx
  on public.seller_earnings (seller_company_id, status, available_at)
  where seller_company_id is not null;
-- statement-breakpoint

create index if not exists seller_earnings_pending_due_idx
  on public.seller_earnings (available_at)
  where status = 'pending';
-- statement-breakpoint

create index if not exists seller_earnings_payout_idx
  on public.seller_earnings (payout_id)
  where payout_id is not null;
