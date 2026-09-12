create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 180),
  summary text not null check (char_length(btrim(summary)) between 1 and 600),
  description text not null default '',
  format text not null check (format in ('online', 'in_person', 'hybrid')),
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null,
  location_name text,
  location_address text,
  meeting_url text,
  topics text[] not null default '{}'::text[],
  speakers text[] not null default '{}'::text[],
  capacity integer check (capacity is null or capacity > 0),
  banner_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  check (
    (format = 'online' and meeting_url is not null) or
    (format = 'in_person' and location_name is not null) or
    (format = 'hybrid' and meeting_url is not null and location_name is not null)
  )
);
-- statement-breakpoint
create table if not exists public.event_attendees (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
-- statement-breakpoint
create index if not exists events_discovery_idx on public.events (status, start_at, end_at);
-- statement-breakpoint
create index if not exists events_host_idx on public.events (host_user_id, start_at desc);
-- statement-breakpoint
create index if not exists event_attendees_user_idx on public.event_attendees (user_id, created_at desc);
