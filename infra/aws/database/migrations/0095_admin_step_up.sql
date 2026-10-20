-- Hotfix P1: admins signed in with Google open admin pages after a step-up, and the minimum payout default.
--
-- 1. auth_sessions.admin_step_up_at: set when a platform administrator signed in with Google confirms it is them
--    (account password plus their authenticator app code, or a backup code). Admin pages then open for that sign-in
--    only, for as long as it lasts (the 30-day sliding session); signing out ends it. Null on every existing row.
-- 2. admin_step_up_attempts: one row per step-up attempt (success or not), for the rate limit (5 failed attempts in
--    15 minutes). No code, password or address is stored. Rows older than 30 days are pruned by the app.
-- 3. payout_settings.min_payout_minor default: 10000000 paise (Rs 1,00,000), the owner's choice. Only the default
--    for a missing row changes; the live row is not read or rewritten (it already holds 10000000).
--
-- Additive only: one nullable column, one new table and its index, and a column default.
-- Reversible: drop table public.admin_step_up_attempts; alter table public.auth_sessions drop column admin_step_up_at;
-- alter table public.payout_settings alter column min_payout_minor set default 10000 (the app built before this
-- release never reads the new column or table).

alter table public.auth_sessions
  add column if not exists admin_step_up_at timestamptz null;
-- statement-breakpoint

create table if not exists public.admin_step_up_attempts (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
-- statement-breakpoint

create index if not exists admin_step_up_attempts_profile_created_idx
  on public.admin_step_up_attempts (profile_id, created_at desc);
-- statement-breakpoint

alter table public.payout_settings
  alter column min_payout_minor set default 10000000;
