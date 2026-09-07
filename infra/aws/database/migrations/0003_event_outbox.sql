create table if not exists public.event_outbox (
  id uuid primary key,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  schema_version integer not null default 1 check (schema_version > 0),
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  published_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text
);

create index if not exists event_outbox_unpublished_idx
  on public.event_outbox (occurred_at, id)
  where published_at is null;

create table if not exists public.notification_event_receipts (
  event_id uuid primary key,
  notification_id uuid,
  processed_at timestamptz not null default now()
);
