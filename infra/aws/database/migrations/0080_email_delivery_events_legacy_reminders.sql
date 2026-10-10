-- Resend delivery events, the do-not-email list and the legacy invitation second reminder.
--   1. public.email_delivery_events: the general email log. One row per Resend delivery event received by the signed
--      webhook (deduplicated by the svix-id), plus one row per email whose final status was fetched by the backfill.
--   2. public.email_suppressions: addresses Sea N Shore never emails again (hard bounce, complaint, on Resend's
--      suppression list, or unsubscribed from the legacy reminder). Every Resend and SES sender checks it.
--   3. public.legacy_profile_invites gets the latest delivery event of the first invitation (the admin page's
--      "Last event"), when it was delivered, and when the backfill fetched its status.
--   4. public.legacy_profile_invite_reminders: at most one second reminder per first invitation and per email, ever,
--      with its own send state and one-click unsubscribe token.
--
-- Additive and safe to run more than once: new tables, new nullable columns, indexes and checks on new columns only.
-- No existing check is relaxed and no existing row is changed.

create table if not exists public.email_delivery_events (
  id bigserial primary key,
  provider text not null default 'resend',
  provider_event_id text,
  source text not null,
  event_type text not null,
  resend_email_id text not null,
  recipient text,
  category text,
  bounce_type text,
  bounce_sub_type text,
  detail text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint email_delivery_events_provider_check check (provider = 'resend'),
  constraint email_delivery_events_source_check check (source in ('webhook', 'backfill')),
  constraint email_delivery_events_event_id_check check (
    provider_event_id is null or char_length(provider_event_id) between 1 and 200
  ),
  constraint email_delivery_events_type_check check (
    event_type in (
      'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed',
      'opened', 'clicked', 'queued', 'scheduled', 'canceled'
    )
  ),
  constraint email_delivery_events_email_id_check check (char_length(resend_email_id) between 1 and 100),
  constraint email_delivery_events_recipient_check check (
    recipient is null or (recipient = lower(btrim(recipient)) and char_length(recipient) between 3 and 320)
  ),
  constraint email_delivery_events_category_check check (category is null or char_length(category) <= 80),
  constraint email_delivery_events_bounce_check check (
    (bounce_type is null or char_length(bounce_type) <= 80)
    and (bounce_sub_type is null or char_length(bounce_sub_type) <= 80)
  ),
  constraint email_delivery_events_detail_check check (detail is null or char_length(detail) <= 500)
);
-- statement-breakpoint

create unique index if not exists email_delivery_events_provider_event_unique
  on public.email_delivery_events (provider_event_id)
  where provider_event_id is not null;
-- statement-breakpoint

create unique index if not exists email_delivery_events_backfill_unique
  on public.email_delivery_events (resend_email_id)
  where source = 'backfill';
-- statement-breakpoint

create index if not exists email_delivery_events_email_idx
  on public.email_delivery_events (resend_email_id, occurred_at desc);
-- statement-breakpoint

create index if not exists email_delivery_events_recipient_idx
  on public.email_delivery_events (recipient, occurred_at desc)
  where recipient is not null;
-- statement-breakpoint

create table if not exists public.email_suppressions (
  email text primary key,
  reason text not null,
  source text not null,
  resend_email_id text,
  created_at timestamptz not null default now(),
  constraint email_suppressions_email_check check (
    email = lower(btrim(email)) and char_length(email) between 3 and 320
  ),
  constraint email_suppressions_reason_check check (
    reason in ('hard_bounce', 'complaint', 'provider_suppressed', 'unsubscribed')
  ),
  constraint email_suppressions_source_check check (
    source in ('resend_webhook', 'resend_backfill', 'resend_suppression_list', 'legacy_reminder_unsubscribe')
  ),
  constraint email_suppressions_email_id_check check (
    resend_email_id is null or char_length(resend_email_id) between 1 and 100
  )
);
-- statement-breakpoint

alter table public.legacy_profile_invites
  add column if not exists last_event text,
  add column if not exists last_event_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_checked_at timestamptz;
-- statement-breakpoint

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'legacy_profile_invites_last_event_check') then
    alter table public.legacy_profile_invites
      add constraint legacy_profile_invites_last_event_check check (
        last_event is null or last_event in (
          'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed',
          'opened', 'clicked', 'queued', 'scheduled', 'canceled'
        )
      );
  end if;
end
$$;
-- statement-breakpoint

create index if not exists legacy_profile_invites_message_idx
  on public.legacy_profile_invites (resend_message_id)
  where resend_message_id is not null;
-- statement-breakpoint

create index if not exists legacy_profile_invites_status_check_idx
  on public.legacy_profile_invites (sent_at, id)
  where status = 'sent' and resend_message_id is not null and delivery_checked_at is null;
-- statement-breakpoint

create table if not exists public.legacy_profile_invite_reminders (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.legacy_profile_invites(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  unsubscribe_token uuid not null default gen_random_uuid(),
  status text not null default 'prepared',
  attempts integer not null default 0,
  resend_message_id text,
  last_error text,
  last_event text,
  last_event_at timestamptz,
  queued_by uuid references public.profiles(id) on delete set null,
  queued_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legacy_profile_invite_reminders_invite_unique unique (invite_id),
  constraint legacy_profile_invite_reminders_token_unique unique (unsubscribe_token),
  constraint legacy_profile_invite_reminders_email_check check (
    email = lower(btrim(email)) and char_length(email) between 3 and 320
  ),
  constraint legacy_profile_invite_reminders_status_check check (
    status in ('prepared', 'queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled')
  ),
  constraint legacy_profile_invite_reminders_attempts_check check (attempts between 0 and 20),
  constraint legacy_profile_invite_reminders_last_event_check check (
    last_event is null or last_event in (
      'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed',
      'opened', 'clicked', 'queued', 'scheduled', 'canceled'
    )
  )
);
-- statement-breakpoint

create unique index if not exists legacy_profile_invite_reminders_email_unique
  on public.legacy_profile_invite_reminders (lower(email));
-- statement-breakpoint

create index if not exists legacy_profile_invite_reminders_delivery_idx
  on public.legacy_profile_invite_reminders (status, next_attempt_at, queued_at);
-- statement-breakpoint

create index if not exists legacy_profile_invite_reminders_message_idx
  on public.legacy_profile_invite_reminders (resend_message_id)
  where resend_message_id is not null;
