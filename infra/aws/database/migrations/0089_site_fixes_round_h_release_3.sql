-- Sea N Shore site fixes round H, release 3 (H7). Additive and safe to run more than once.
--
-- Schema:
-- 1. site_settings: one row per admin-edited site setting (Admin › Site settings), such as the Grievance Officer on
--    the Contact page and the About page sections. The app validates each value with its own schema.
-- 2. support_tickets: one row per message sent from the Contact page form. A signed-in member's ticket is linked to
--    their profile (they follow it under Help › My requests); a visitor's ticket is answered by email only.
-- 3. support_ticket_messages: the thread of a ticket (the first message, member replies, admin answers).
-- 4. support_ticket_emails: the send queue for ticket emails (new ticket and member reply to operations, admin answer
--    to the sender), sent by the outbox worker through Resend. Nothing is emailed from a request.
-- 5. jobs.urgent_since: when a job was last marked urgent. Urgent shows for 14 days from then; a company may have at
--    most 2 live urgent jobs at a time (both enforced in the app). A check keeps urgent_since empty on jobs that are
--    not urgent.
--
-- Data, approved by the owner in the round H brief (H7):
-- 6. Jobs already marked urgent get urgent_since = their publish date (or creation date for a draft). Only rows with
--    urgent = true and no urgent_since change, so a second run changes nothing.
--
-- New tables are covered by the sea_n_shore_app default privileges (migration 0066); no table here uses RLS, like
-- every other application table.

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint site_settings_key_check check (key ~ '^[a-z][a-z0-9_]{1,63}$')
);
-- statement-breakpoint

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  sender_profile_id uuid references public.profiles(id) on delete set null,
  sender_name text not null,
  sender_email text not null,
  -- Keyed hash of the sender's IP for rate limiting only (the IP itself is never stored).
  sender_ip_hash text,
  topic text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  last_message_at timestamptz not null default now(),
  constraint support_tickets_topic_check check (topic in ('account', 'payments', 'jobs', 'learning', 'events', 'organizations', 'privacy', 'grievance', 'partnership', 'technical', 'other')),
  constraint support_tickets_status_check check (status in ('open', 'answered', 'closed')),
  constraint support_tickets_closed_check check ((status = 'closed') = (closed_at is not null)),
  constraint support_tickets_sender_name_check check (char_length(btrim(sender_name)) between 1 and 120),
  constraint support_tickets_sender_email_check check (char_length(sender_email) between 3 and 254 and position('@' in sender_email) > 1),
  constraint support_tickets_ip_hash_check check (sender_ip_hash is null or char_length(sender_ip_hash) between 16 and 64)
);
-- statement-breakpoint

create index if not exists support_tickets_status_idx on public.support_tickets (status, last_message_at desc, id);
-- statement-breakpoint

create index if not exists support_tickets_sender_idx
  on public.support_tickets (sender_profile_id, last_message_at desc)
  where sender_profile_id is not null;
-- statement-breakpoint

create index if not exists support_tickets_email_recent_idx on public.support_tickets (lower(sender_email), created_at desc);
-- statement-breakpoint

create index if not exists support_tickets_ip_recent_idx
  on public.support_tickets (sender_ip_hash, created_at desc)
  where sender_ip_hash is not null;
-- statement-breakpoint

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_profile_id uuid references public.profiles(id) on delete set null,
  author_role text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint support_ticket_messages_author_role_check check (author_role in ('member', 'visitor', 'admin')),
  constraint support_ticket_messages_body_check check (char_length(btrim(body)) between 1 and 5000)
);
-- statement-breakpoint

create index if not exists support_ticket_messages_ticket_idx on public.support_ticket_messages (ticket_id, created_at, id);
-- statement-breakpoint

create index if not exists support_ticket_messages_author_idx
  on public.support_ticket_messages (author_profile_id, created_at desc)
  where author_profile_id is not null;
-- statement-breakpoint

create table if not exists public.support_ticket_emails (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  message_id uuid references public.support_ticket_messages(id) on delete cascade,
  kind text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint support_ticket_emails_kind_check check (kind in ('operations_new_ticket', 'operations_member_reply', 'sender_admin_reply')),
  constraint support_ticket_emails_status_check check (status in ('pending', 'sent', 'skipped', 'failed')),
  constraint support_ticket_emails_attempts_check check (attempts between 0 and 100)
);
-- statement-breakpoint

create index if not exists support_ticket_emails_due_idx on public.support_ticket_emails (next_attempt_at, id) where status = 'pending';
-- statement-breakpoint

create index if not exists support_ticket_emails_ticket_idx on public.support_ticket_emails (ticket_id, created_at desc);
-- statement-breakpoint

alter table public.jobs
  add column if not exists urgent_since timestamptz;
-- statement-breakpoint

update public.jobs
set urgent_since = coalesce(published_at, created_at)
where urgent and urgent_since is null;
-- statement-breakpoint

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_urgent_since_check'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_urgent_since_check check (urgent or urgent_since is null);
  end if;
end
$$;
-- statement-breakpoint

create index if not exists jobs_company_urgent_idx
  on public.jobs (company_id)
  where urgent;
