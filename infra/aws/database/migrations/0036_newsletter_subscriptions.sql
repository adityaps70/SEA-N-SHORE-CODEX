-- Sea N Shore newsletter: consented subscribers, append-only consent history,
-- Amazon SES contact-list sync state and resumable campaign sending.
-- Additive and idempotent: safe to run more than once. No existing data is changed.
-- The Sea N Shore database is the source of truth; Amazon SES holds a synced copy.

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending',
  topics text[] not null default '{}'::text[],
  source text not null default 'newsletter_page',
  consent_text_version text,
  consented_at timestamptz,
  confirmed_at timestamptz,
  confirmation_sent_at timestamptz,
  unsubscribed_at timestamptz,
  ses_sync_status text not null default 'not_required',
  ses_sync_attempts integer not null default 0,
  ses_sync_error text,
  ses_synced_at timestamptz,
  ses_next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint

create unique index if not exists newsletter_subscribers_email_key
  on public.newsletter_subscribers (email);
-- statement-breakpoint

alter table public.newsletter_subscribers
  drop constraint if exists newsletter_subscribers_email_check,
  add constraint newsletter_subscribers_email_check check (
    email = lower(btrim(email)) and char_length(email) between 3 and 320 and position('@' in email) > 1
  ),
  drop constraint if exists newsletter_subscribers_status_check,
  add constraint newsletter_subscribers_status_check check (
    status in ('pending', 'subscribed', 'unsubscribed')
  ),
  drop constraint if exists newsletter_subscribers_topics_check,
  add constraint newsletter_subscribers_topics_check check (
    cardinality(topics) <= 8
    and topics <@ array['product_updates', 'jobs_digest', 'learning_events']::text[]
  ),
  drop constraint if exists newsletter_subscribers_source_check,
  add constraint newsletter_subscribers_source_check check (
    source ~ '^[a-z_]{2,40}$'
  ),
  drop constraint if exists newsletter_subscribers_ses_sync_status_check,
  add constraint newsletter_subscribers_ses_sync_status_check check (
    ses_sync_status in ('not_required', 'pending', 'synced', 'failed')
  ),
  drop constraint if exists newsletter_subscribers_ses_sync_error_check,
  add constraint newsletter_subscribers_ses_sync_error_check check (
    ses_sync_error is null or char_length(ses_sync_error) <= 500
  );
-- statement-breakpoint

create index if not exists newsletter_subscribers_status_created_idx
  on public.newsletter_subscribers (status, created_at desc, id);
-- statement-breakpoint

create index if not exists newsletter_subscribers_profile_idx
  on public.newsletter_subscribers (profile_id)
  where profile_id is not null;
-- statement-breakpoint

create index if not exists newsletter_subscribers_sync_due_idx
  on public.newsletter_subscribers (ses_next_attempt_at, id)
  where ses_sync_status in ('pending', 'failed');
-- statement-breakpoint

create table if not exists public.newsletter_consent_events (
  id bigint generated always as identity primary key,
  subscriber_id uuid not null references public.newsletter_subscribers(id) on delete cascade,
  event_type text not null,
  topics text[] not null default '{}'::text[],
  consent_text_version text,
  source text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  -- Keyed HMAC of the client IP, truncated. Never the IP itself.
  ip_hash text,
  -- Coarse browser/OS family only (e.g. "Chrome on Android"). Never the raw header.
  user_agent_summary text,
  created_at timestamptz not null default now()
);
-- statement-breakpoint

alter table public.newsletter_consent_events
  drop constraint if exists newsletter_consent_events_type_check,
  add constraint newsletter_consent_events_type_check check (
    event_type in (
      'subscribe_requested',
      'subscribe_confirmed',
      'topics_changed',
      'unsubscribed',
      'duplicate_signup'
    )
  ),
  drop constraint if exists newsletter_consent_events_ip_hash_check,
  add constraint newsletter_consent_events_ip_hash_check check (
    ip_hash is null or ip_hash ~ '^[0-9a-f]{16,64}$'
  ),
  drop constraint if exists newsletter_consent_events_user_agent_check,
  add constraint newsletter_consent_events_user_agent_check check (
    user_agent_summary is null or char_length(user_agent_summary) <= 60
  ),
  drop constraint if exists newsletter_consent_events_source_check,
  add constraint newsletter_consent_events_source_check check (
    source ~ '^[a-z_]{2,40}$'
  );
-- statement-breakpoint

create index if not exists newsletter_consent_events_subscriber_idx
  on public.newsletter_consent_events (subscriber_id, created_at desc, id desc);
-- statement-breakpoint

create index if not exists newsletter_consent_events_ip_recent_idx
  on public.newsletter_consent_events (ip_hash, created_at desc)
  where ip_hash is not null;
-- statement-breakpoint

-- Consent history is append-only: rows may be added, never rewritten.
-- (Rows are removed only together with their subscriber, for erasure requests.)
create or replace function public.newsletter_consent_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'newsletter_consent_events is append-only';
end;
$$;
-- statement-breakpoint

drop trigger if exists newsletter_consent_events_no_update on public.newsletter_consent_events;
-- statement-breakpoint

create trigger newsletter_consent_events_no_update
  before update on public.newsletter_consent_events
  for each row execute function public.newsletter_consent_events_append_only();
-- statement-breakpoint

create table if not exists public.newsletter_campaigns (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  subject text not null,
  body_text text not null,
  status text not null default 'queued',
  created_by uuid references public.profiles(id) on delete set null,
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
-- statement-breakpoint

alter table public.newsletter_campaigns
  drop constraint if exists newsletter_campaigns_topic_check,
  add constraint newsletter_campaigns_topic_check check (
    topic in ('product_updates', 'jobs_digest', 'learning_events')
  ),
  drop constraint if exists newsletter_campaigns_status_check,
  add constraint newsletter_campaigns_status_check check (
    status in ('queued', 'sending', 'sent', 'failed', 'cancelled')
  ),
  drop constraint if exists newsletter_campaigns_subject_check,
  add constraint newsletter_campaigns_subject_check check (
    subject = btrim(subject) and char_length(subject) between 3 and 150
  ),
  drop constraint if exists newsletter_campaigns_body_check,
  add constraint newsletter_campaigns_body_check check (
    char_length(body_text) between 10 and 20000
  ),
  drop constraint if exists newsletter_campaigns_last_error_check,
  add constraint newsletter_campaigns_last_error_check check (
    last_error is null or char_length(last_error) <= 500
  );
-- statement-breakpoint

create index if not exists newsletter_campaigns_status_created_idx
  on public.newsletter_campaigns (status, created_at);
-- statement-breakpoint

create table if not exists public.newsletter_campaign_deliveries (
  campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade,
  subscriber_id uuid not null references public.newsletter_subscribers(id) on delete cascade,
  status text not null default 'queued',
  ses_message_id text,
  error text,
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, subscriber_id)
);
-- statement-breakpoint

alter table public.newsletter_campaign_deliveries
  drop constraint if exists newsletter_campaign_deliveries_status_check,
  add constraint newsletter_campaign_deliveries_status_check check (
    status in ('queued', 'sent', 'failed', 'skipped')
  ),
  drop constraint if exists newsletter_campaign_deliveries_error_check,
  add constraint newsletter_campaign_deliveries_error_check check (
    error is null or char_length(error) <= 500
  );
-- statement-breakpoint

create index if not exists newsletter_campaign_deliveries_queue_idx
  on public.newsletter_campaign_deliveries (campaign_id, status);
