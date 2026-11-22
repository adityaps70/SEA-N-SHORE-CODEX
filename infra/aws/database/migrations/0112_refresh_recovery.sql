-- Owner (19 Nov, ₹0): recover a renewal the browser never received. The server renews a sign-in (Cognito rotates the
-- refresh token, 60-second grace), but the device closes the connection first (a sleeping laptop, a phone switching
-- apps, a background tab), keeps the old refresh token and, on its next use after the grace, is treated as token
-- reuse and signed out. Now each renewal leaves the NEW tokens sealed (AES-256-GCM, a key derived from the server
-- secret, bound to the old token's hash) on the OLD token's row. If the old token comes back while no request has
-- ever arrived with the new access token (so the device never got it), the app hands the sealed set back ONCE.
--
-- 1. auth_refresh_tokens.recovery_sealed: the renewed tokens, encrypted; only on the latest renewal of a sign-in
--    (cleared on every older row), and cleared when recovered. recovery_expires_at: 30 days after the renewal, the
--    refresh cookie's lifetime, so the kept set never outlives the refresh token it replaces. recovered_at: set once,
--    atomically, when the set is handed back; a row is never recoverable twice.
-- 2. auth_sessions.renewal_jti_hash: SHA-256 of the latest renewal's access-token id (never the token);
--    renewal_seen_at: set on the first request that carries that access token. Once set, nothing is recoverable.
--    The 0111 trigger on auth_sessions notifies only on revoked_at, reuse_detected_at and profile_id, so these
--    columns send no cache clears.
--
-- Additive only: five nullable columns. No existing row is read or rewritten. Safe to run more than once.
-- Reversible: drop the five columns (the app built before this release never reads them, and the app with it renews
-- as before when they are missing).
-- statement-breakpoint
alter table public.auth_refresh_tokens
  add column if not exists recovery_sealed text null
    check (recovery_sealed is null or char_length(recovery_sealed) between 1 and 16384);
-- statement-breakpoint
alter table public.auth_refresh_tokens
  add column if not exists recovery_expires_at timestamptz null;
-- statement-breakpoint
alter table public.auth_refresh_tokens
  add column if not exists recovered_at timestamptz null;
-- statement-breakpoint
alter table public.auth_sessions
  add column if not exists renewal_jti_hash text null
    check (renewal_jti_hash is null or renewal_jti_hash ~ '^[0-9a-f]{64}$');
-- statement-breakpoint
alter table public.auth_sessions
  add column if not exists renewal_seen_at timestamptz null;
