begin;

alter table public.profiles
  add column if not exists username_change_count smallint not null default 0;

alter table public.profiles
  drop constraint if exists profiles_username_change_count_check;

alter table public.profiles
  add constraint profiles_username_change_count_check
  check (username_change_count between 0 and 2);

alter table public.profiles
  drop constraint if exists profiles_slug_check;

alter table public.profiles
  add constraint profiles_slug_check
  check (
    slug is null
    or (
      slug ~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$'
      and slug !~ '[._-]{2}'
    )
  );

commit;
