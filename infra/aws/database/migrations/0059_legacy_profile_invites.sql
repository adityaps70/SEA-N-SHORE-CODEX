-- One-time account-reconnection invitations for imported legacy Sea N Shore profiles.
-- This is intentionally separate from newsletter subscriptions and marketing consent.

create table if not exists public.legacy_profile_invites (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  claim_token uuid not null default gen_random_uuid(),
  status text not null default 'queued',
  attempts integer not null default 0,
  resend_message_id text,
  last_error text,
  queued_by uuid references public.profiles(id) on delete set null,
  queued_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legacy_profile_invites_profile_unique unique (profile_id),
  constraint legacy_profile_invites_token_unique unique (claim_token),
  constraint legacy_profile_invites_email_check check (
    email = lower(btrim(email))
    and char_length(email) between 3 and 320
  ),
  constraint legacy_profile_invites_status_check check (
    status in ('queued', 'sending', 'sent', 'failed', 'skipped')
  ),
  constraint legacy_profile_invites_attempts_check check (attempts between 0 and 20)
);
-- statement-breakpoint

create unique index if not exists legacy_profile_invites_email_unique
  on public.legacy_profile_invites (lower(email));
-- statement-breakpoint

create index if not exists legacy_profile_invites_delivery_idx
  on public.legacy_profile_invites (status, next_attempt_at, queued_at);
-- statement-breakpoint

create index if not exists legacy_profile_invites_sent_idx
  on public.legacy_profile_invites (sent_at desc)
  where sent_at is not null;
