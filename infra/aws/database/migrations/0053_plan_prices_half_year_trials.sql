-- Sea N Shore round 9A: new plan prices, a half-yearly Organization Pro option and free trials.
-- Additive and safe to run more than once. No subscriber's own rows are rewritten.
--
-- 1. billing_interval gains 'half_year' (six months) on plan_prices and subscription_checkouts.
-- 2. The launch prices are retired for NEW subscribers and the owner-approved prices are
--    inserted (amounts in paise, matching PLAN_PRICES in src/features/billing/plans.ts):
--      Creator Pro       Rs 99 / month, Rs 999 / year
--      Organization Pro  Rs 1,999 / month, Rs 10,000 / 6 months, Rs 14,999 / year
--    Prices are immutable: a retired row keeps its id, so existing checkouts and Cashfree
--    plans keep the price they were signed up with.
-- 3. public.plan_trials: one free trial per member (Creator Pro) or organization
--    (Organization Pro), ever. Access itself is an account_subscriptions row with
--    status 'trialing' and billing_provider 'trial' (statuses and the "one current
--    subscription per subject" indexes from 0032 already fit), so entitlements, plan
--    visibility and the hourly expiry sweep need no change.

alter table public.plan_prices
  drop constraint if exists plan_prices_interval_check,
  add constraint plan_prices_interval_check check (billing_interval in ('month', 'half_year', 'year'));
-- statement-breakpoint

alter table public.subscription_checkouts
  drop constraint if exists subscription_checkouts_interval_check,
  add constraint subscription_checkouts_interval_check check (billing_interval in ('month', 'half_year', 'year'));
-- statement-breakpoint

-- Retire every active price that is not in the round 9A list (existing subscribers keep their rows).
update public.plan_prices
set active = false, updated_at = now()
where active
  and (plan_code, billing_interval, amount_minor) not in (
    ('creator_pro', 'month', 9900::bigint),
    ('creator_pro', 'year', 99900::bigint),
    ('organization_pro', 'month', 199900::bigint),
    ('organization_pro', 'half_year', 1000000::bigint),
    ('organization_pro', 'year', 1499900::bigint)
  );
-- statement-breakpoint

insert into public.plan_prices (plan_code, billing_interval, amount_minor, currency, active, provider)
select seed.plan_code, seed.billing_interval, seed.amount_minor, 'INR', true, 'cashfree'
from (
  values
    ('creator_pro'::text, 'month'::text, 9900::bigint),
    ('creator_pro'::text, 'year'::text, 99900::bigint),
    ('organization_pro'::text, 'month'::text, 199900::bigint),
    ('organization_pro'::text, 'half_year'::text, 1000000::bigint),
    ('organization_pro'::text, 'year'::text, 1499900::bigint)
) as seed(plan_code, billing_interval, amount_minor)
where not exists (
  select 1 from public.plan_prices existing
  where existing.plan_code = seed.plan_code
    and existing.billing_interval = seed.billing_interval
    and existing.active
);
-- statement-breakpoint

create table if not exists public.plan_trials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  plan_code text not null,
  started_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  ended_at timestamptz,
  ended_reason text,
  extended_by uuid references public.profiles(id) on delete set null,
  extended_at timestamptz,
  reminder_7d_sent_at timestamptz,
  reminder_1d_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_trials_subject_check check (
    (profile_id is not null and company_id is null and plan_code = 'creator_pro')
    or (profile_id is null and company_id is not null and plan_code = 'organization_pro')
  ),
  constraint plan_trials_period_check check (ends_at > started_at),
  constraint plan_trials_ended_reason_check check (
    ended_reason is null or ended_reason in ('expired', 'converted', 'admin_ended')
  )
);
-- statement-breakpoint

-- One trial per member, ever.
create unique index if not exists plan_trials_profile_uq
  on public.plan_trials (profile_id)
  where profile_id is not null;
-- statement-breakpoint

-- One trial per organization, ever.
create unique index if not exists plan_trials_company_uq
  on public.plan_trials (company_id)
  where company_id is not null;
-- statement-breakpoint

-- The reminder and expiry sweeps read open trials by end date.
create index if not exists plan_trials_open_idx
  on public.plan_trials (ends_at)
  where ended_at is null;
-- statement-breakpoint
