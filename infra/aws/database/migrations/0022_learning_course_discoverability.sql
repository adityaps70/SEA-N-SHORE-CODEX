-- Keep published/runnable learning content separate from public marketplace discovery.
alter table public.learning_courses
  add column if not exists is_discoverable boolean not null default true;
-- statement-breakpoint

create index if not exists learning_courses_discoverable_published_idx
  on public.learning_courses (published_at desc, id desc)
  where status = 'published' and is_discoverable = true;
