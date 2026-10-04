-- Round 14 (2.6): per-IP and per-email limits for the three email flows (sign-up, resend
-- confirmation code, password reset). One row per attempt the app let through. The email and the
-- IP are stored only as keyed (HMAC) hashes, never in clear. The app counts rows in a rolling
-- one-hour window under advisory locks and prunes each key's rows older than 2 days as it goes.
-- Additive only: a new table and two indexes; nothing existing is changed or deleted.
create table if not exists public.auth_email_events (
  id bigserial primary key,
  action text not null check (action in ('sign_up', 'resend_code', 'password_reset')),
  email_hash text not null,
  ip_hash text null,
  created_at timestamptz not null default now()
);
-- statement-breakpoint
create index if not exists auth_email_events_action_email_created_idx
  on public.auth_email_events (action, email_hash, created_at desc);
-- statement-breakpoint
create index if not exists auth_email_events_action_ip_created_idx
  on public.auth_email_events (action, ip_hash, created_at desc)
  where ip_hash is not null;
