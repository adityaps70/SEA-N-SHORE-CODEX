-- Keep published/runnable learning content separate from public marketplace discovery.
-- New rows are hidden by default; the real administrator publication workflow opts them into discovery.
alter table public.learning_courses
  add column if not exists is_discoverable boolean not null default false;
-- statement-breakpoint

-- Preserve current legitimate catalogue visibility when introducing the new boundary.
update public.learning_courses
set is_discoverable = true
where status = 'published';
-- statement-breakpoint

create or replace function public.sync_learning_course_discoverability()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    new.is_discoverable := true;
  elsif new.status is distinct from 'published' then
    new.is_discoverable := false;
  end if;
  return new;
end;
$$;
-- statement-breakpoint

create or replace trigger learning_course_discoverability_sync
before update of status on public.learning_courses
for each row
execute function public.sync_learning_course_discoverability();
-- statement-breakpoint

create index if not exists learning_courses_discoverable_published_idx
  on public.learning_courses (published_at desc, id desc)
  where status = 'published' and is_discoverable = true;
