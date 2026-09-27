-- Sea N Shore events: explicit Free / Paid pricing and in-platform event payments.
-- Additive and safe to run more than once. Existing events stay free and keep
-- their data; published events keep the same access rules they already met.
--
-- 1. Pricing columns on public.events (is_paid, price_minor, currency).
-- 2. Drafts may be saved before the joining link / venue / summary are known.
--    The "access details required" rule now applies to published events only.
-- 3. public.event_payment_orders: one row per checkout attempt, provider agnostic,
--    with unique keys that make checkout callbacks and webhooks idempotent.
-- 4. public.payment_webhook_events: provider delivery ids already processed.
-- 5. public.event_attendees.payment_order_id links a paid seat to its order.

alter table public.events
  add column if not exists is_paid boolean not null default false,
  add column if not exists price_minor bigint,
  add column if not exists currency text;
-- statement-breakpoint

alter table public.events
  drop constraint if exists events_price_minor_check,
  add constraint events_price_minor_check check (
    price_minor is null or price_minor between 1 and 100000000
  ),
  drop constraint if exists events_currency_check,
  add constraint events_currency_check check (
    currency is null or currency in ('INR', 'USD')
  ),
  drop constraint if exists events_published_pricing_check,
  add constraint events_published_pricing_check check (
    is_paid = false
    or status <> 'published'
    or (price_minor is not null and currency is not null)
  );
-- statement-breakpoint

-- The original 0012 table-level check required a meeting URL / venue even for
-- drafts. It was created without a name, so find it by definition and replace it
-- with a named rule that only applies once an event is published.
do $$
declare
  legacy_constraint record;
begin
  for legacy_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.events'::regclass
      and contype = 'c'
      and conname <> 'events_published_access_check'
      and pg_get_constraintdef(oid) ilike '%meeting_url IS NOT NULL%'
      and pg_get_constraintdef(oid) ilike '%location_name IS NOT NULL%'
  loop
    execute format('alter table public.events drop constraint %I', legacy_constraint.conname);
  end loop;
end
$$;
-- statement-breakpoint

alter table public.events
  drop constraint if exists events_published_access_check,
  add constraint events_published_access_check check (
    status <> 'published'
    or (format = 'online' and meeting_url is not null)
    or (format = 'in_person' and location_name is not null)
    or (format = 'hybrid' and meeting_url is not null and location_name is not null)
  );
-- statement-breakpoint

-- Allow a draft to be saved before its short summary is written. Published
-- events still need one (checked in the application and here).
alter table public.events
  drop constraint if exists events_summary_check,
  drop constraint if exists events_summary_length_check,
  add constraint events_summary_length_check check (char_length(btrim(summary)) <= 600),
  drop constraint if exists events_published_summary_check,
  add constraint events_published_summary_check check (
    status <> 'published' or char_length(btrim(summary)) >= 1
  );
-- statement-breakpoint

create table if not exists public.event_payment_orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  event_title text not null default '',
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('INR', 'USD')),
  provider text not null default 'razorpay' check (provider in ('razorpay')),
  provider_order_id text,
  provider_payment_id text,
  status text not null default 'created' check (status in ('created', 'paid', 'failed', 'refunded', 'cancelled')),
  registration_confirmed_at timestamptz,
  refund_due_reason text,
  failure_reason text,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint

create unique index if not exists event_payment_orders_provider_order_key
  on public.event_payment_orders (provider, provider_order_id)
  where provider_order_id is not null;
-- statement-breakpoint

create unique index if not exists event_payment_orders_provider_payment_key
  on public.event_payment_orders (provider, provider_payment_id)
  where provider_payment_id is not null;
-- statement-breakpoint

-- At most one open checkout per attendee and event (double clicks reuse it).
create unique index if not exists event_payment_orders_open_checkout_key
  on public.event_payment_orders (event_id, profile_id)
  where status = 'created';
-- statement-breakpoint

create index if not exists event_payment_orders_event_idx
  on public.event_payment_orders (event_id, status, created_at desc);
-- statement-breakpoint

create index if not exists event_payment_orders_profile_idx
  on public.event_payment_orders (profile_id, created_at desc);
-- statement-breakpoint

create table if not exists public.payment_webhook_events (
  provider text not null check (provider in ('razorpay')),
  provider_event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  primary key (provider, provider_event_id)
);
-- statement-breakpoint

alter table public.event_attendees
  add column if not exists payment_order_id uuid references public.event_payment_orders(id) on delete set null;
-- statement-breakpoint

create unique index if not exists event_attendees_payment_order_key
  on public.event_attendees (payment_order_id)
  where payment_order_id is not null;
