-- Sea N Shore site fixes round H, release 2 (H5 SEO). Additive and safe to run more than once. No row is rewritten.
--
-- member_preferences.allow_search_indexing: the member lets search engines list their public profile page
-- (Settings › Privacy). Off by default: until a member opts in, their profile page carries noindex, has no Person
-- structured data and is left out of the sitemap.
--
-- H3 email notifications (section "Round H release 2, H3 email notifications" at the end): four email switches on
-- member_preferences (on by default), member_message_digests (the hourly messages digest state), the
-- member_notification_emails send queue, and two indexes for the worker that fills it.
--
-- H3 account security (section "Round H release 2, H3 account security" at the end): auth_sessions (one row per
-- signed-in device, for Settings › Account › Active sessions and per-device sign-out), mfa_backup_codes (hashed 2FA
-- backup codes), account_security_attempts (rate limits) and the account_security_emails send queue, with their
-- indexes. New tables only.

alter table public.member_preferences
  add column if not exists allow_search_indexing boolean not null default false;
-- statement-breakpoint

create index if not exists member_preferences_allow_search_indexing_idx
  on public.member_preferences (profile_id)
  where allow_search_indexing;
-- statement-breakpoint

-- Round H release 2, H3 email notifications
--
-- 1. member_preferences: one switch per activity email type (Settings › Email notifications, and the signed
--    one-click unsubscribe link). On by default (no row means on too): these are service emails about the member's
--    own activity, like the learning and job alert emails that are already on by default.
-- 2. member_message_digests: per member, when the last unread messages digest was queued (at most one an hour) and
--    the end of the message window it covered. Workers lock the row (FOR UPDATE SKIP LOCKED) before queueing.
-- 3. member_notification_emails: the send queue (same pattern as ranking_emails). dedupe_key is unique:
--    'notification:<notification id>' for activity emails and 'messages:<member>:<window end>' for digests, so
--    nothing is queued twice. The unsubscribe link is a signed token, not the row id.
-- 4. Two indexes so the worker finds new activity notifications and recent messages without scanning all rows.

alter table public.member_preferences
  add column if not exists email_messages_digest boolean not null default true,
  add column if not exists email_connection_requests boolean not null default true,
  add column if not exists email_comments boolean not null default true,
  add column if not exists email_mentions boolean not null default true;
-- statement-breakpoint

create table if not exists public.member_message_digests (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  last_sent_at timestamptz null,
  covered_until timestamptz null,
  updated_at timestamptz not null default now()
);
-- statement-breakpoint

create table if not exists public.member_notification_emails (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('messages', 'connection_requests', 'comments', 'mentions')),
  notification_id uuid null references public.notifications(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  last_error text null,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz null
);
-- statement-breakpoint

create index if not exists member_notification_emails_due_idx
  on public.member_notification_emails (next_attempt_at, id)
  where status = 'pending';
-- statement-breakpoint

create index if not exists member_notification_emails_recipient_idx
  on public.member_notification_emails (recipient_id, kind, created_at desc);
-- statement-breakpoint

create index if not exists member_notification_emails_created_idx
  on public.member_notification_emails (created_at);
-- statement-breakpoint

create index if not exists member_notification_emails_notification_idx
  on public.member_notification_emails (notification_id)
  where notification_id is not null;
-- statement-breakpoint

create index if not exists notifications_email_candidates_idx
  on public.notifications (created_at)
  where notification_type in ('connection_request', 'post_comment', 'comment_reply', 'post_mention', 'comment_mention', 'photo_tag');
-- statement-breakpoint

create index if not exists messages_created_at_idx
  on public.messages (created_at)
  where deleted_at is null;
-- statement-breakpoint

-- Round H release 2, H3 account security
--
-- 1. auth_sessions: one row per signed-in device (Settings › Account › Active sessions). A row is keyed by the
--    Cognito sign-in it belongs to (token_origin_hash: a SHA-256 of the access token's origin_jti claim, which stays
--    the same across token refreshes), so a revoked row cannot be dodged by dropping a cookie. revoked_at set means
--    the app refuses that sign-in on its next request (checked at most every 30 seconds per server). Only a short
--    device and browser summary, an approximate city and country from CloudFront's viewer headers, and a keyed hash
--    of the IP address are kept; never the raw user agent, address or any token.
-- 2. mfa_backup_codes: 2FA backup codes, stored only as a per-code salted HMAC-SHA-256 with a server-held key.
--    One batch of 10 per member; generating a new batch deletes the old one. used_at is set once, atomically.
-- 3. account_security_attempts: counts password changes, email-change codes and verifications, backup code
--    generation and backup code sign-in attempts per member, for rate limits (old rows are pruned as new ones come).
-- 4. account_security_emails: the send queue for account security notices (the old address after an email change),
--    sent by the outbox worker through Resend. The recipient is cleared once the row is finished.

create table if not exists public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token_origin_hash text not null unique check (token_origin_hash ~ '^[0-9a-f]{64}$'),
  sign_in_method text not null default 'unknown' check (sign_in_method in ('password', 'google', 'unknown')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoke_reason text null check (
    revoke_reason is null
    or revoke_reason in ('signed_out', 'signed_out_remotely', 'signed_out_other_devices', 'password_changed', 'mfa_reset')
  ),
  user_agent_summary text null check (user_agent_summary is null or char_length(user_agent_summary) between 1 and 120),
  approx_city text null check (approx_city is null or char_length(approx_city) between 1 and 80),
  approx_country text null check (approx_country is null or approx_country ~ '^[A-Z]{2}$'),
  ip_hash text null check (ip_hash is null or ip_hash ~ '^[0-9a-f]{32}$'),
  constraint auth_sessions_revoked_reason_check check ((revoked_at is null) = (revoke_reason is null))
);
-- statement-breakpoint

create index if not exists auth_sessions_profile_active_idx
  on public.auth_sessions (profile_id, last_seen_at desc)
  where revoked_at is null;
-- statement-breakpoint

create index if not exists auth_sessions_created_idx
  on public.auth_sessions (created_at);
-- statement-breakpoint

create table if not exists public.mfa_backup_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  batch_id uuid not null,
  code_salt text not null check (code_salt ~ '^[0-9a-f]{32}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  used_at timestamptz null
);
-- statement-breakpoint

create index if not exists mfa_backup_codes_profile_unused_idx
  on public.mfa_backup_codes (profile_id)
  where used_at is null;
-- statement-breakpoint

create table if not exists public.account_security_attempts (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (
    action in ('password_change', 'email_change_code', 'email_change_verify', 'backup_codes_generate', 'backup_code_sign_in')
  ),
  created_at timestamptz not null default now()
);
-- statement-breakpoint

create index if not exists account_security_attempts_lookup_idx
  on public.account_security_attempts (profile_id, action, created_at desc);
-- statement-breakpoint

create table if not exists public.account_security_emails (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('email_changed')),
  recipient_email text null check (recipient_email is null or char_length(recipient_email) between 3 and 320),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  last_error text null,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz null
);
-- statement-breakpoint

create index if not exists account_security_emails_due_idx
  on public.account_security_emails (next_attempt_at, id)
  where status = 'pending';
