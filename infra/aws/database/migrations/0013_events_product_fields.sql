alter table public.events
  add column if not exists category text not null default 'community' check (category in ('training','safety','technical','regulatory','careers','leadership','networking','community')),
  add column if not exists event_type text not null default 'community' check (event_type in ('webinar','masterclass','conference','workshop','meetup','networking','community')),
  add column if not exists city text,
  add column if not exists country text,
  add column if not exists agenda jsonb not null default '[]'::jsonb,
  add column if not exists speaker_details jsonb not null default '[]'::jsonb,
  add column if not exists registration_mode text not null default 'open' check (registration_mode in ('open','closed')),
  add column if not exists registration_closes_at timestamptz;
-- statement-breakpoint
create index if not exists events_product_filter_idx on public.events (status, category, event_type, format, start_at);
-- statement-breakpoint
create index if not exists events_location_filter_idx on public.events (lower(city), lower(country));
