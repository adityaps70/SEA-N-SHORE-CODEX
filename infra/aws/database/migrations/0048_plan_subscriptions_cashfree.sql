-- Sea N Shore paid plans: auto-renewing Creator Pro and Organization Pro subscriptions
-- on Cashfree Subscriptions (UPI AutoPay, card and eNACH mandates).
-- Additive and safe to run more than once. No existing row is rewritten.
--
-- 1. public.plan_prices: the price list. Prices are immutable: a price change inserts a
--    new row and deactivates the old one, so existing subscribers keep the price (and the
--    Cashfree plan) they signed up for. One active price per plan and billing interval.
--    Seeded with Creator Pro Rs 100/month, Rs 1,000/year and Organization Pro
--    Rs 2,000/month, Rs 20,000/year (amounts in paise).
-- 2. public.subscription_checkouts: one row per Cashfree subscription (mandate) we
--    create, from the moment checkout starts until it ends. Access itself stays in
--    public.account_subscriptions (0032), linked by billing_provider 'cashfree' +
--    provider_subscription_id.
-- 3. public.subscription_payments: every mandate payment Cashfree reports (the
--    authorisation and each renewal charge), unique by Cashfree's payment ids.
-- account_subscriptions (0032) needs no change: its statuses and the unique "one current
-- subscription per member / organization" indexes already fit.

create table if not exists public.plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null,
  billing_interval text not null,
  amount_minor bigint not null,
  currency text not null default 'INR',
  active boolean not null default true,
  provider text not null default 'cashfree',
  provider_plan_id text,
  provider_environment text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_prices_plan_check check (plan_code in ('creator_pro', 'organization_pro')),
  constraint plan_prices_interval_check check (billing_interval in ('month', 'year')),
  constraint plan_prices_amount_check check (amount_minor between 100 and 100000000),
  constraint plan_prices_currency_check check (currency = 'INR'),
  constraint plan_prices_provider_check check (provider in ('cashfree')),
  constraint plan_prices_provider_plan_check check (
    provider_plan_id is null or provider_plan_id ~ '^[A-Za-z0-9._-]{1,40}$'
  ),
  constraint plan_prices_environment_check check (
    provider_environment is null or provider_environment in ('sandbox', 'production')
  )
);
-- statement-breakpoint

create unique index if not exists plan_prices_active_uq
  on public.plan_prices (plan_code, billing_interval)
  where active;
-- statement-breakpoint

create index if not exists plan_prices_history_idx
  on public.plan_prices (plan_code, billing_interval, created_at desc);
-- statement-breakpoint

insert into public.plan_prices (plan_code, billing_interval, amount_minor, currency, active, provider)
select seed.plan_code, seed.billing_interval, seed.amount_minor, 'INR', true, 'cashfree'
from (
  values
    ('creator_pro'::text, 'month'::text, 10000::bigint),
    ('creator_pro'::text, 'year'::text, 100000::bigint),
    ('organization_pro'::text, 'month'::text, 200000::bigint),
    ('organization_pro'::text, 'year'::text, 2000000::bigint)
) as seed(plan_code, billing_interval, amount_minor)
where not exists (
  select 1 from public.plan_prices existing
  where existing.plan_code = seed.plan_code
    and existing.billing_interval = seed.billing_interval
);
-- statement-breakpoint

create table if not exists public.subscription_checkouts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  plan_code text not null,
  plan_price_id uuid not null references public.plan_prices(id) on delete restrict,
  billing_interval text not null,
  amount_minor bigint not null,
  currency text not null default 'INR',
  provider text not null default 'cashfree',
  provider_environment text not null,
  provider_subscription_id text not null,
  cf_subscription_id text,
  subscription_session_id text,
  status text not null default 'created',
  provider_status text,
  payment_method text,
  starts_at timestamptz,
  next_charge_at timestamptz,
  paid_through_at timestamptz,
  replaces_checkout_id uuid references public.subscription_checkouts(id) on delete set null,
  failure_reason text,
  last_checked_at timestamptz,
  last_status_event_at timestamptz,
  activated_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_checkouts_subject_check check (
    (profile_id is not null and company_id is null and plan_code = 'creator_pro')
    or (profile_id is null and company_id is not null and plan_code = 'organization_pro')
  ),
  constraint subscription_checkouts_interval_check check (billing_interval in ('month', 'year')),
  constraint subscription_checkouts_amount_check check (amount_minor > 0),
  constraint subscription_checkouts_currency_check check (currency = 'INR'),
  constraint subscription_checkouts_provider_check check (provider in ('cashfree')),
  constraint subscription_checkouts_environment_check check (provider_environment in ('sandbox', 'production')),
  constraint subscription_checkouts_status_check check (
    status in ('created', 'pending_approval', 'active', 'on_hold', 'paused', 'failed', 'cancelled', 'ended', 'replaced')
  ),
  constraint subscription_checkouts_provider_subscription_check check (
    provider_subscription_id ~ '^[A-Za-z0-9._ -]{1,250}$'
  ),
  constraint subscription_checkouts_session_check check (
    subscription_session_id is null or char_length(subscription_session_id) between 1 and 1000
  ),
  constraint subscription_checkouts_text_check check (
    (provider_status is null or char_length(provider_status) <= 60)
    and (payment_method is null or char_length(payment_method) <= 40)
    and (failure_reason is null or char_length(failure_reason) <= 500)
  )
);
-- statement-breakpoint

create unique index if not exists subscription_checkouts_provider_subscription_uq
  on public.subscription_checkouts (provider, provider_subscription_id);
-- statement-breakpoint

create index if not exists subscription_checkouts_profile_idx
  on public.subscription_checkouts (profile_id, created_at desc)
  where profile_id is not null;
-- statement-breakpoint

create index if not exists subscription_checkouts_company_idx
  on public.subscription_checkouts (company_id, created_at desc)
  where company_id is not null;
-- statement-breakpoint

create index if not exists subscription_checkouts_open_idx
  on public.subscription_checkouts (status, updated_at)
  where status in ('created', 'pending_approval', 'active', 'on_hold', 'paused');
-- statement-breakpoint

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null references public.subscription_checkouts(id) on delete restrict,
  profile_id uuid references public.profiles(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  provider text not null default 'cashfree',
  provider_payment_id text,
  cf_payment_id text,
  payment_type text not null default 'CHARGE',
  amount_minor bigint not null,
  currency text not null default 'INR',
  status text not null,
  raw_status text,
  failure_reason text,
  period_start timestamptz,
  period_end timestamptz,
  scheduled_for timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_payments_provider_check check (provider in ('cashfree')),
  constraint subscription_payments_type_check check (payment_type in ('AUTH', 'CHARGE')),
  constraint subscription_payments_amount_check check (amount_minor >= 0),
  constraint subscription_payments_currency_check check (currency = 'INR'),
  constraint subscription_payments_status_check check (status in ('pending', 'success', 'failed', 'cancelled')),
  constraint subscription_payments_reference_check check (provider_payment_id is not null or cf_payment_id is not null),
  constraint subscription_payments_text_check check (
    (provider_payment_id is null or char_length(provider_payment_id) between 1 and 100)
    and (cf_payment_id is null or char_length(cf_payment_id) between 1 and 100)
    and (raw_status is null or char_length(raw_status) <= 60)
    and (failure_reason is null or char_length(failure_reason) <= 500)
  ),
  constraint subscription_payments_period_check check (
    period_start is null or period_end is null or period_end > period_start
  )
);
-- statement-breakpoint

create unique index if not exists subscription_payments_cf_payment_uq
  on public.subscription_payments (provider, cf_payment_id)
  where cf_payment_id is not null;
-- statement-breakpoint

create unique index if not exists subscription_payments_provider_payment_uq
  on public.subscription_payments (provider, provider_payment_id)
  where provider_payment_id is not null;
-- statement-breakpoint

create index if not exists subscription_payments_checkout_idx
  on public.subscription_payments (checkout_id, created_at desc);
-- statement-breakpoint

create index if not exists subscription_payments_profile_idx
  on public.subscription_payments (profile_id, created_at desc)
  where profile_id is not null;
-- statement-breakpoint

create index if not exists subscription_payments_company_idx
  on public.subscription_payments (company_id, created_at desc)
  where company_id is not null;
