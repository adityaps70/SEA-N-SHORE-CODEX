-- P4: the final legacy reminder, the last email about an old seaandshore.in account. After it, no more legacy emails.
--   1. public.legacy_profile_invite_final_reminders: at most one final reminder per first invitation, per second
--      reminder and per email, ever, with its own send state, one-click unsubscribe token, click-tracking token
--      (our own redirect, no open pixel), click counts and the latest delivery event.
--   2. public.legacy_final_reminder_controls: one row (id = 1) holding the mode's pause state. The worker pauses it
--      by itself when the complaint or bounce rate of final reminders is too high; an administrator resumes it.
--
-- Additive and safe to run more than once: two new tables, their indexes and checks, and the controls row. No
-- existing check is relaxed and no existing row is changed.

create table if not exists public.legacy_profile_invite_final_reminders (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.legacy_profile_invites(id) on delete cascade,
  reminder_id uuid not null references public.legacy_profile_invite_reminders(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  unsubscribe_token uuid not null default gen_random_uuid(),
  click_token uuid not null default gen_random_uuid(),
  status text not null default 'prepared',
  attempts integer not null default 0,
  resend_message_id text,
  last_error text,
  last_event text,
  last_event_at timestamptz,
  delivered_at timestamptz,
  first_clicked_at timestamptz,
  click_count integer not null default 0,
  queued_by uuid references public.profiles(id) on delete set null,
  queued_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legacy_profile_invite_final_reminders_invite_unique unique (invite_id),
  constraint legacy_profile_invite_final_reminders_reminder_unique unique (reminder_id),
  constraint legacy_profile_invite_final_reminders_token_unique unique (unsubscribe_token),
  constraint legacy_profile_invite_final_reminders_click_token_unique unique (click_token),
  constraint legacy_profile_invite_final_reminders_email_check check (
    email = lower(btrim(email)) and char_length(email) between 3 and 320
  ),
  constraint legacy_profile_invite_final_reminders_status_check check (
    status in ('prepared', 'queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled')
  ),
  constraint legacy_profile_invite_final_reminders_attempts_check check (attempts between 0 and 20),
  constraint legacy_profile_invite_final_reminders_clicks_check check (click_count >= 0),
  constraint legacy_profile_invite_final_reminders_last_event_check check (
    last_event is null or last_event in (
      'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed',
      'opened', 'clicked', 'queued', 'scheduled', 'canceled'
    )
  )
);
-- statement-breakpoint

create unique index if not exists legacy_profile_invite_final_reminders_email_unique
  on public.legacy_profile_invite_final_reminders (lower(email));
-- statement-breakpoint

create index if not exists legacy_profile_invite_final_reminders_delivery_idx
  on public.legacy_profile_invite_final_reminders (status, next_attempt_at, queued_at);
-- statement-breakpoint

create index if not exists legacy_profile_invite_final_reminders_message_idx
  on public.legacy_profile_invite_final_reminders (resend_message_id)
  where resend_message_id is not null;
-- statement-breakpoint

create index if not exists legacy_profile_invite_final_reminders_batch_idx
  on public.legacy_profile_invite_final_reminders (created_at, id);
-- statement-breakpoint

create table if not exists public.legacy_final_reminder_controls (
  id smallint primary key default 1,
  paused boolean not null default false,
  paused_reason text,
  paused_at timestamptz,
  resumed_by uuid references public.profiles(id) on delete set null,
  resumed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint legacy_final_reminder_controls_single_row check (id = 1),
  constraint legacy_final_reminder_controls_reason_check check (
    paused_reason is null or char_length(paused_reason) between 1 and 300
  )
);
-- statement-breakpoint

insert into public.legacy_final_reminder_controls (id) values (1)
on conflict (id) do nothing;
