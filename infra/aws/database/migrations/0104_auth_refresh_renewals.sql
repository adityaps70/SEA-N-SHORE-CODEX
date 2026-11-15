-- Owner-approved 15 Nov: one renewal per refresh token. A device opened again after its access cookie expired sends
-- several requests at once, and each renewed the sign-in with the same refresh token. With rotation on, Cognito
-- answers each retry within its 60-second grace with a NEWER refresh token and refuses the one it issued before, so
-- the browser could keep a refused token and be signed out at its next renewal. Now the first request renews and
-- leaves the result here, sealed (AES-256-GCM, a key derived from the server secret), for the other requests that
-- carry the same refresh token, on any server, for 60 seconds at most.
--
-- token_hash is the SHA-256 of the refresh token, never the token. sealed holds the renewed tokens encrypted; it is
-- null while the renewal is in flight. Rows are deleted 60 seconds after they are claimed (by the server that claimed
-- them, and by every later claim for any rows a missed delete left behind). Nothing reads a row past expires_at.
--
-- Additive and safe to run more than once. Reversible: drop table public.auth_refresh_renewals (the app built before
-- this release never reads it, and the app with it renews as before when the table is missing).
-- statement-breakpoint
create table if not exists public.auth_refresh_renewals (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  sealed text null check (sealed is null or char_length(sealed) between 1 and 16384),
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null
);
-- statement-breakpoint
create index if not exists auth_refresh_renewals_expires_idx
  on public.auth_refresh_renewals (expires_at);
