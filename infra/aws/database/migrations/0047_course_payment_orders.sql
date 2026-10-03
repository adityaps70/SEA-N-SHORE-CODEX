-- Sea N Shore paid courses: one row per course checkout, bought through Cashfree or Razorpay.
-- Additive and safe to run more than once. No existing row is rewritten.
--
-- 1. public.course_payment_orders mirrors public.event_payment_orders: the learner,
--    the course, a snapshot of the price the learner was shown (list price and
--    discount price) and the amount charged, the gateway ids, the order status and
--    the refund columns. Unique keys make checkout callbacks and webhooks idempotent,
--    and a learner has at most one open checkout per course.
-- 2. public.learning_enrollments.payment_order_id links a purchased enrollment to the
--    order that paid for it, so a refund ends exactly that access.

create table if not exists public.course_payment_orders (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.learning_courses(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  course_title text not null default '',
  list_price_minor bigint not null check (list_price_minor > 0),
  discount_price_minor bigint,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('INR', 'USD')),
  provider text not null check (provider in ('razorpay', 'cashfree')),
  provider_order_id text,
  provider_payment_id text,
  provider_session_id text,
  status text not null default 'created' check (status in ('created', 'paid', 'failed', 'refunded', 'cancelled')),
  enrollment_id uuid references public.learning_enrollments(id) on delete set null,
  enrollment_confirmed_at timestamptz,
  refund_due_reason text,
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  paid_at timestamptz,
  refunded_at timestamptz,
  refund_status text,
  refund_attempts integer not null default 0,
  provider_refund_id text,
  refund_reason text check (refund_reason is null or char_length(refund_reason) <= 200),
  refund_requested_at timestamptz,
  refund_requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_payment_orders_discount_check check (
    discount_price_minor is null or (discount_price_minor > 0 and discount_price_minor < list_price_minor)
  ),
  constraint course_payment_orders_amount_check check (
    amount_minor = coalesce(discount_price_minor, list_price_minor)
  ),
  constraint course_payment_orders_refund_status_check check (
    refund_status is null or refund_status in ('requested', 'pending', 'processed', 'failed')
  ),
  constraint course_payment_orders_refund_attempts_check check (refund_attempts between 0 and 20),
  constraint course_payment_orders_provider_session_check check (
    provider_session_id is null or char_length(provider_session_id) between 1 and 1000
  )
);
-- statement-breakpoint

create unique index if not exists course_payment_orders_provider_order_key
  on public.course_payment_orders (provider_order_id)
  where provider_order_id is not null;
-- statement-breakpoint

create unique index if not exists course_payment_orders_provider_payment_key
  on public.course_payment_orders (provider, provider_payment_id)
  where provider_payment_id is not null;
-- statement-breakpoint

-- At most one open checkout per learner and course (double clicks reuse it).
create unique index if not exists course_payment_orders_open_checkout_key
  on public.course_payment_orders (course_id, profile_id)
  where status = 'created';
-- statement-breakpoint

create index if not exists course_payment_orders_course_idx
  on public.course_payment_orders (course_id, status, created_at desc);
-- statement-breakpoint

create index if not exists course_payment_orders_profile_idx
  on public.course_payment_orders (profile_id, created_at desc);
-- statement-breakpoint

alter table public.learning_enrollments
  add column if not exists payment_order_id uuid references public.course_payment_orders(id) on delete set null;
-- statement-breakpoint

create index if not exists learning_enrollments_payment_order_idx
  on public.learning_enrollments (payment_order_id)
  where payment_order_id is not null;
