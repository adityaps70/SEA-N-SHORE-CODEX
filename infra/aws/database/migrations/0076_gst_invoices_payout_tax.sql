-- C4: GST tax invoices and credit notes for course sales, and seller invoices + TDS on course payouts.
-- Additive only: new tables, new nullable columns, indexes, check constraints on new columns, two triggers that keep
-- issued tax documents unchangeable, and one seeded settings row. No existing row or rule is changed.
--
-- Sea N Shore (Beaufort Marine Services LLP) is the supplier of every course. Course prices include GST; the GST is
-- worked out of the price when the invoice is issued. Invoices and credit notes are numbered per financial year from a
-- counter row locked in the issuing transaction, so numbers are never skipped or reused.

create table if not exists public.platform_tax_settings (
  id boolean primary key default true check (id),
  tds_section text not null default '194J' check (tds_section ~ '^[0-9]{3}[A-Z]{0,3}$'),
  tds_rate_basis_points integer check (tds_rate_basis_points is null or tds_rate_basis_points between 1 and 3000),
  tds_threshold_minor bigint check (tds_threshold_minor is null or tds_threshold_minor >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint

insert into public.platform_tax_settings (id) values (true) on conflict (id) do nothing;
-- statement-breakpoint

create table if not exists public.gst_lut_registrations (
  financial_year text primary key check (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  arn text not null check (arn = btrim(arn) and arn ~ '^[A-Z0-9]{10,20}$'),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint

create table if not exists public.tax_document_sequences (
  series text primary key check (series ~ '^(invoice|credit_note):[0-9]{4}-[0-9]{2}$'),
  last_number integer not null default 0 check (last_number between 0 and 999999),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint

alter table public.course_payment_orders
  add column if not exists billing_state_code text
    constraint course_payment_orders_billing_state_check check (billing_state_code is null or billing_state_code ~ '^[0-9]{2}$'),
  add column if not exists billing_country text
    constraint course_payment_orders_billing_country_check check (billing_country is null or billing_country ~ '^[A-Z]{2}$'),
  add column if not exists billing_company text
    constraint course_payment_orders_billing_company_check check (
      billing_company is null or (billing_company = btrim(billing_company) and char_length(billing_company) between 2 and 120)
    ),
  add column if not exists billing_gstin text
    constraint course_payment_orders_billing_gstin_check check (
      billing_gstin is null or billing_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
    );
-- statement-breakpoint

create table if not exists public.tax_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique check (invoice_number ~ '^SNS/[0-9]{2}-[0-9]{2}/[0-9]{6}$'),
  financial_year text not null check (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  sequence_number integer not null check (sequence_number between 1 and 999999),
  order_id uuid not null unique references public.course_payment_orders(id) on delete restrict,
  buyer_profile_id uuid references public.profiles(id) on delete restrict,
  invoice_date date not null,
  issued_at timestamptz not null default now(),
  supplier jsonb not null,
  buyer_name text not null check (char_length(buyer_name) between 1 and 180),
  buyer_company text check (buyer_company is null or char_length(buyer_company) between 2 and 120),
  buyer_gstin text check (buyer_gstin is null or buyer_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  place_of_supply_code text not null check (place_of_supply_code ~ '^[0-9]{2}$'),
  place_of_supply_name text not null check (char_length(place_of_supply_name) between 2 and 80),
  supply_type text not null check (supply_type in ('intra_state', 'inter_state', 'export_lut')),
  lut_arn text check (lut_arn is null or lut_arn ~ '^[A-Z0-9]{10,20}$'),
  sac text not null check (sac ~ '^[0-9]{6}$'),
  description text not null check (char_length(description) between 2 and 300),
  currency text not null check (currency in ('INR', 'USD')),
  gst_rate_basis_points integer not null check (gst_rate_basis_points in (0, 1800)),
  taxable_minor bigint not null check (taxable_minor > 0),
  cgst_minor bigint not null default 0 check (cgst_minor >= 0),
  sgst_minor bigint not null default 0 check (sgst_minor >= 0),
  igst_minor bigint not null default 0 check (igst_minor >= 0),
  total_minor bigint not null check (total_minor > 0),
  created_at timestamptz not null default now(),
  constraint tax_invoices_total_check check (total_minor = taxable_minor + cgst_minor + sgst_minor + igst_minor),
  constraint tax_invoices_supply_check check (
    (supply_type = 'intra_state' and igst_minor = 0 and lut_arn is null)
    or (supply_type = 'inter_state' and cgst_minor = 0 and sgst_minor = 0 and lut_arn is null)
    or (supply_type = 'export_lut' and cgst_minor = 0 and sgst_minor = 0 and igst_minor = 0 and lut_arn is not null
        and gst_rate_basis_points = 0)
  ),
  constraint tax_invoices_sequence_key unique (financial_year, sequence_number)
);
-- statement-breakpoint

create index if not exists tax_invoices_date_idx on public.tax_invoices (invoice_date, invoice_number);
-- statement-breakpoint

create index if not exists tax_invoices_buyer_idx on public.tax_invoices (buyer_profile_id, issued_at desc);
-- statement-breakpoint

create table if not exists public.tax_credit_notes (
  id uuid primary key default gen_random_uuid(),
  credit_note_number text not null unique check (credit_note_number ~ '^SNC/[0-9]{2}-[0-9]{2}/[0-9]{6}$'),
  financial_year text not null check (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  sequence_number integer not null check (sequence_number between 1 and 999999),
  invoice_id uuid not null unique references public.tax_invoices(id) on delete restrict,
  note_date date not null,
  issued_at timestamptz not null default now(),
  reason text not null check (char_length(reason) between 2 and 200),
  taxable_minor bigint not null check (taxable_minor > 0),
  cgst_minor bigint not null default 0 check (cgst_minor >= 0),
  sgst_minor bigint not null default 0 check (sgst_minor >= 0),
  igst_minor bigint not null default 0 check (igst_minor >= 0),
  total_minor bigint not null check (total_minor > 0),
  created_at timestamptz not null default now(),
  constraint tax_credit_notes_total_check check (total_minor = taxable_minor + cgst_minor + sgst_minor + igst_minor),
  constraint tax_credit_notes_sequence_key unique (financial_year, sequence_number)
);
-- statement-breakpoint

create index if not exists tax_credit_notes_date_idx on public.tax_credit_notes (note_date, credit_note_number);
-- statement-breakpoint

create or replace function public.tax_documents_are_final()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Issued tax documents cannot be changed or deleted (%).', tg_table_name
    using errcode = 'P0001';
end;
$$;
-- statement-breakpoint

create or replace trigger tax_invoices_final
before update or delete on public.tax_invoices
for each row execute function public.tax_documents_are_final();
-- statement-breakpoint

create or replace trigger tax_credit_notes_final
before update or delete on public.tax_credit_notes
for each row execute function public.tax_documents_are_final();
-- statement-breakpoint

create table if not exists public.tax_document_emails (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in ('invoice', 'credit_note')),
  document_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  resend_message_id text check (resend_message_id is null or char_length(resend_message_id) <= 200),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  constraint tax_document_emails_document_key unique (document_type, document_id)
);
-- statement-breakpoint

create index if not exists tax_document_emails_due_idx
  on public.tax_document_emails (next_attempt_at, id)
  where status = 'pending';
-- statement-breakpoint

create table if not exists public.payout_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  seller_profile_id uuid references public.profiles(id) on delete restrict,
  seller_company_id uuid references public.companies(id) on delete restrict,
  legal_name text not null check (legal_name = btrim(legal_name) and char_length(legal_name) between 2 and 180),
  pan text not null check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  gst_registered boolean not null default false,
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_tax_profiles_one_seller_check check ((seller_profile_id is null) <> (seller_company_id is null)),
  constraint payout_tax_profiles_registration_check check (gst_registered = (gstin is not null))
);
-- statement-breakpoint

create unique index if not exists payout_tax_profiles_profile_key
  on public.payout_tax_profiles (seller_profile_id) where seller_profile_id is not null;
-- statement-breakpoint

create unique index if not exists payout_tax_profiles_company_key
  on public.payout_tax_profiles (seller_company_id) where seller_company_id is not null;
-- statement-breakpoint

create table if not exists public.seller_payout_invoices (
  id uuid primary key default gen_random_uuid(),
  seller_profile_id uuid references public.profiles(id) on delete restrict,
  seller_company_id uuid references public.companies(id) on delete restrict,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  document_kind text not null check (document_kind in ('tax_invoice', 'bill_of_supply')),
  seller_document_number text not null check (char_length(seller_document_number) between 1 and 40),
  amount_minor bigint not null check (amount_minor > 0),
  expected_amount_minor bigint not null check (expected_amount_minor > 0),
  storage_path text not null unique check (storage_path ~ '^seller-invoices/'),
  file_name text not null check (char_length(file_name) between 1 and 200),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  review_note text check (review_note is null or char_length(review_note) <= 500),
  submitted_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_payout_invoices_one_seller_check check ((seller_profile_id is null) <> (seller_company_id is null)),
  constraint seller_payout_invoices_review_check check ((status = 'submitted') = (reviewed_at is null))
);
-- statement-breakpoint

create unique index if not exists seller_payout_invoices_profile_period_key
  on public.seller_payout_invoices (seller_profile_id, period)
  where seller_profile_id is not null and status in ('submitted', 'approved');
-- statement-breakpoint

create unique index if not exists seller_payout_invoices_company_period_key
  on public.seller_payout_invoices (seller_company_id, period)
  where seller_company_id is not null and status in ('submitted', 'approved');
-- statement-breakpoint

create index if not exists seller_payout_invoices_review_idx
  on public.seller_payout_invoices (status, created_at)
  where status = 'submitted';
-- statement-breakpoint

alter table public.payouts
  add column if not exists tds_base_minor bigint not null default 0
    constraint payouts_tds_base_check check (tds_base_minor >= 0),
  add column if not exists tds_minor bigint not null default 0
    constraint payouts_tds_check check (tds_minor >= 0),
  add column if not exists tds_section text
    constraint payouts_tds_section_check check (tds_section is null or tds_section ~ '^[0-9]{3}[A-Z]{0,3}$'),
  add column if not exists tds_rate_basis_points integer
    constraint payouts_tds_rate_check check (tds_rate_basis_points is null or tds_rate_basis_points between 1 and 3000),
  add column if not exists tds_financial_year text
    constraint payouts_tds_year_check check (tds_financial_year is null or tds_financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  add column if not exists seller_pan text
    constraint payouts_seller_pan_check check (seller_pan is null or seller_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');
-- statement-breakpoint

-- gross_minor is set on every payout created from now on: the earnings in the payout. amount_minor stays the amount
-- transferred, so it is the gross less any TDS. Existing payouts keep gross_minor null and are unchanged.
alter table public.payouts
  add column if not exists gross_minor bigint
    constraint payouts_gross_check check (
      gross_minor is null
      or (gross_minor > 0 and amount_minor = gross_minor - tds_minor and tds_minor <= tds_base_minor)
    );
-- statement-breakpoint

create index if not exists payouts_tds_year_idx
  on public.payouts (tds_financial_year, created_at)
  where tds_financial_year is not null;
