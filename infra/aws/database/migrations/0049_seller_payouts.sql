-- Sea N Shore payments: seller payouts through Cashfree Payouts.
-- Additive and safe to run more than once. No existing row is rewritten.
--
-- 1. public.payout_accounts: where a seller (member profile or organization) is paid.
--    The bank account number goes straight to Cashfree as a beneficiary; we keep only
--    the IFSC and the last 4 digits (never the full number). One active account per seller.
-- 2. public.payout_settings: one row, the smallest amount Sea N Shore pays out (default ₹100).
-- 3. public.payouts: one transfer to one seller, approved by a platform administrator.
--    transfer_id is derived from the payout id, so a retry can never send twice.
-- 4. public.payout_items: the earnings (seller_earnings rows) included in a payout.
--    An earning belongs to at most one active payout.
-- 5. seller_earnings.payout_id now references public.payouts (not validated against
--    old rows; nothing wrote payout_id before this migration).

create table if not exists public.payout_accounts (
  id uuid primary key default gen_random_uuid(),
  seller_profile_id uuid references public.profiles(id) on delete restrict,
  seller_company_id uuid references public.companies(id) on delete restrict,
  method text not null check (method in ('bank', 'upi')),
  account_holder_name text not null check (char_length(account_holder_name) between 3 and 100),
  bank_ifsc text check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_account_last4 text check (bank_account_last4 is null or bank_account_last4 ~ '^[0-9]{4}$'),
  upi_vpa text check (upi_vpa is null or char_length(upi_vpa) between 3 and 100),
  provider text not null default 'cashfree' check (provider in ('cashfree')),
  provider_beneficiary_id text not null check (provider_beneficiary_id ~ '^[A-Za-z0-9_]{3,50}$'),
  provider_status text check (provider_status is null or char_length(provider_status) <= 40),
  provider_verified boolean not null default false,
  status text not null default 'active' check (status in ('active', 'removed')),
  created_by uuid references public.profiles(id) on delete set null,
  removed_by uuid references public.profiles(id) on delete set null,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_accounts_one_seller_check check (
    (seller_profile_id is null) <> (seller_company_id is null)
  ),
  constraint payout_accounts_method_details_check check (
    (method = 'bank' and bank_ifsc is not null and bank_account_last4 is not null and upi_vpa is null)
    or (method = 'upi' and upi_vpa is not null and bank_ifsc is null and bank_account_last4 is null)
  ),
  constraint payout_accounts_removed_check check (
    (status = 'removed') = (removed_at is not null)
  )
);
-- statement-breakpoint

create unique index if not exists payout_accounts_active_profile_key
  on public.payout_accounts (seller_profile_id)
  where status = 'active' and seller_profile_id is not null;
-- statement-breakpoint

create unique index if not exists payout_accounts_active_company_key
  on public.payout_accounts (seller_company_id)
  where status = 'active' and seller_company_id is not null;
-- statement-breakpoint

create index if not exists payout_accounts_beneficiary_idx
  on public.payout_accounts (provider, provider_beneficiary_id);
-- statement-breakpoint

create table if not exists public.payout_settings (
  id boolean primary key default true check (id),
  min_payout_minor bigint not null default 10000 check (min_payout_minor between 100 and 100000000),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint

insert into public.payout_settings (id, min_payout_minor)
values (true, 10000)
on conflict (id) do nothing;
-- statement-breakpoint

create table if not exists public.payouts (
  id uuid primary key,
  seller_profile_id uuid references public.profiles(id) on delete restrict,
  seller_company_id uuid references public.companies(id) on delete restrict,
  payout_account_id uuid not null references public.payout_accounts(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'INR' check (currency in ('INR')),
  status text not null default 'draft' check (status in ('draft', 'processing', 'success', 'failed', 'reversed', 'cancelled')),
  provider text not null default 'cashfree' check (provider in ('cashfree')),
  transfer_id text not null check (transfer_id ~ '^[A-Za-z0-9_]{3,40}$'),
  transfer_mode text check (transfer_mode is null or transfer_mode in ('banktransfer', 'imps', 'neft', 'rtgs', 'upi')),
  cf_transfer_id text check (cf_transfer_id is null or char_length(cf_transfer_id) <= 100),
  provider_status text check (provider_status is null or char_length(provider_status) <= 40),
  provider_status_code text check (provider_status_code is null or char_length(provider_status_code) <= 80),
  utr text check (utr is null or char_length(utr) <= 100),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  dispatch_attempts integer not null default 0 check (dispatch_attempts between 0 and 100),
  last_dispatch_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payouts_one_seller_check check (
    (seller_profile_id is null) <> (seller_company_id is null)
  ),
  constraint payouts_approved_check check (
    status in ('draft', 'cancelled') or approved_at is not null
  )
);
-- statement-breakpoint

create unique index if not exists payouts_transfer_key
  on public.payouts (provider, transfer_id);
-- statement-breakpoint

create unique index if not exists payouts_open_profile_key
  on public.payouts (seller_profile_id)
  where status in ('draft', 'processing') and seller_profile_id is not null;
-- statement-breakpoint

create unique index if not exists payouts_open_company_key
  on public.payouts (seller_company_id)
  where status in ('draft', 'processing') and seller_company_id is not null;
-- statement-breakpoint

create index if not exists payouts_status_idx
  on public.payouts (status, created_at desc);
-- statement-breakpoint

create index if not exists payouts_profile_idx
  on public.payouts (seller_profile_id, created_at desc)
  where seller_profile_id is not null;
-- statement-breakpoint

create index if not exists payouts_company_idx
  on public.payouts (seller_company_id, created_at desc)
  where seller_company_id is not null;
-- statement-breakpoint

create table if not exists public.payout_items (
  id bigint generated always as identity primary key,
  payout_id uuid not null references public.payouts(id) on delete restrict,
  earning_id uuid not null references public.seller_earnings(id) on delete restrict,
  amount_minor bigint not null,
  active boolean not null default true,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payout_items_released_check check (active = (released_at is null))
);
-- statement-breakpoint

create unique index if not exists payout_items_active_earning_key
  on public.payout_items (earning_id)
  where active;
-- statement-breakpoint

create unique index if not exists payout_items_payout_earning_key
  on public.payout_items (payout_id, earning_id);
-- statement-breakpoint

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'seller_earnings_payout_id_fkey'
      and conrelid = 'public.seller_earnings'::regclass
  ) then
    alter table public.seller_earnings
      add constraint seller_earnings_payout_id_fkey
      foreign key (payout_id) references public.payouts(id) on delete restrict
      not valid;
  end if;
end
$$;
