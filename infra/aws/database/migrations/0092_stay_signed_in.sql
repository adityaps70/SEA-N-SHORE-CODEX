-- Round I (I3): stay signed in on the iPhone Home Screen app.
--
-- 1. auth_sessions.reuse_detected_at: set when a refresh token of that sign-in comes back after it was already
--    exchanged for a newer one (refresh token rotation). The session check then refuses every token of the sign-in.
--    Null on every existing row; nothing else in auth_sessions changes.
-- 2. auth_refresh_tokens: a SHA-256 of each refresh token the app has seen (never the token itself), with the sign-in
--    it belongs to (the same token_origin_hash as auth_sessions) and when it was exchanged for a newer one. Rows
--    retired more than 30 days ago are pruned by the app.
-- 3. auth_app_handoffs: Google sign-in started in the iPhone Home Screen app and finished in a Safari window. Holds
--    hashes of the app's secret, the OAuth state, the 6-digit code and the Safari window's secret, plus the Cognito
--    authorization code for at most 10 minutes (useless without the PKCE verifier, which only the app has; cleared
--    when the app claims it). Rows are deleted an hour after they expire.
--
-- Additive only: one nullable column, two new tables and their indexes. No existing row is read or rewritten.
-- Reversible: drop table public.auth_app_handoffs; drop table public.auth_refresh_tokens;
-- alter table public.auth_sessions drop column reuse_detected_at (the app built before this release never reads them).
alter table public.auth_sessions
  add column if not exists reuse_detected_at timestamptz null;
-- statement-breakpoint

create table if not exists public.auth_refresh_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  origin_hash text not null check (origin_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  superseded_at timestamptz null
);
-- statement-breakpoint

create index if not exists auth_refresh_tokens_origin_idx
  on public.auth_refresh_tokens (origin_hash, superseded_at);
-- statement-breakpoint

create table if not exists public.auth_app_handoffs (
  id uuid primary key,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  pair_code_hash text not null check (pair_code_hash ~ '^[0-9a-f]{64}$'),
  intent text not null default 'sign-in' check (intent in ('sign-in', 'sign-up')),
  status text not null default 'pending' check (status in ('pending', 'awaiting_code', 'ready', 'claimed', 'refused')),
  auth_code text null check (auth_code is null or char_length(auth_code) between 1 and 512),
  confirm_hash text null check (confirm_hash is null or confirm_hash ~ '^[0-9a-f]{64}$'),
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 10),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
-- statement-breakpoint

create index if not exists auth_app_handoffs_expires_idx
  on public.auth_app_handoffs (expires_at);
