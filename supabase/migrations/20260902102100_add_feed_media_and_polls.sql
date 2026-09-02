create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  alt_text text,
  created_at timestamptz not null default now(),
  constraint post_media_mime_check check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint post_media_alt_check check (alt_text is null or char_length(alt_text) <= 300)
);

create table public.post_polls (
  post_id uuid primary key references public.posts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.post_poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.post_polls(post_id) on delete cascade,
  label text not null,
  position smallint not null,
  constraint post_poll_options_label_check check (
    label = btrim(label) and char_length(label) between 1 and 120
  ),
  constraint post_poll_options_position_check check (position between 0 and 5),
  unique (post_id, position),
  unique (post_id, id)
);

create table public.post_poll_votes (
  post_id uuid not null,
  option_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id),
  foreign key (post_id, option_id)
    references public.post_poll_options(post_id, id)
    on delete cascade
);

create index post_poll_options_post_idx on public.post_poll_options (post_id, position);
create index post_poll_votes_option_idx on public.post_poll_votes (option_id);

create or replace function private.enforce_poll_option_count()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_post_id uuid;
  v_count integer;
begin
  if tg_op = 'DELETE' then
    v_post_id := old.post_id;
  else
    v_post_id := new.post_id;
  end if;

  if not exists (
    select 1 from public.post_polls poll
    where poll.post_id = v_post_id
  ) then
    return null;
  end if;

  select count(*)::integer
  into v_count
  from public.post_poll_options option_row
  where option_row.post_id = v_post_id;

  if v_count not between 2 and 6 then
    raise check_violation using message = 'polls require 2 to 6 options';
  end if;

  return null;
end;
$$;

revoke all on function private.enforce_poll_option_count()
from public, anon, authenticated, service_role;

create constraint trigger post_polls_require_options
after insert on public.post_polls
deferrable initially deferred
for each row execute procedure private.enforce_poll_option_count();

create constraint trigger post_poll_options_enforce_count
after insert or delete or update of post_id on public.post_poll_options
deferrable initially deferred
for each row execute procedure private.enforce_poll_option_count();

alter table public.post_media enable row level security;
alter table public.post_polls enable row level security;
alter table public.post_poll_options enable row level security;
alter table public.post_poll_votes enable row level security;

revoke all on public.post_media, public.post_polls, public.post_poll_options, public.post_poll_votes
from anon, authenticated;

grant select, delete on public.post_media to authenticated;
grant insert (post_id, storage_path, mime_type, alt_text) on public.post_media to authenticated;

grant select, delete on public.post_polls to authenticated;
grant insert (post_id) on public.post_polls to authenticated;

grant select, delete on public.post_poll_options to authenticated;
grant insert (post_id, label, position) on public.post_poll_options to authenticated;

grant select, delete on public.post_poll_votes to authenticated;
grant insert (post_id, option_id, user_id) on public.post_poll_votes to authenticated;
grant update (option_id) on public.post_poll_votes to authenticated;

create policy "active members read post media"
on public.post_media for select to authenticated
using (
  exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and exists (
    select 1 from public.posts p
    where p.id = post_media.post_id
      and p.deleted_at is null
  )
);

create policy "authors attach own post media"
on public.post_media for insert to authenticated
with check (
  storage_path like (select auth.uid())::text || '/%'
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and exists (
    select 1 from public.posts p
    where p.id = post_media.post_id
      and p.author_id = (select auth.uid())
      and p.deleted_at is null
      and p.post_type = 'standard'
  )
);

create policy "authors remove own post media"
on public.post_media for delete to authenticated
using (
  exists (
    select 1 from public.posts p
    where p.id = post_media.post_id
      and p.author_id = (select auth.uid())
  )
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create policy "active members read polls"
on public.post_polls for select to authenticated
using (
  exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and exists (
    select 1 from public.posts p
    where p.id = post_polls.post_id
      and p.deleted_at is null
      and p.post_type = 'poll'
  )
);

create policy "authors create poll definitions"
on public.post_polls for insert to authenticated
with check (
  exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and exists (
    select 1 from public.posts p
    where p.id = post_polls.post_id
      and p.author_id = (select auth.uid())
      and p.deleted_at is null
      and p.post_type = 'poll'
  )
);

create policy "authors remove own poll definitions"
on public.post_polls for delete to authenticated
using (
  exists (
    select 1 from public.posts p
    where p.id = post_polls.post_id
      and p.author_id = (select auth.uid())
  )
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create policy "active members read poll options"
on public.post_poll_options for select to authenticated
using (
  exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and exists (
    select 1 from public.posts p
    where p.id = post_poll_options.post_id
      and p.deleted_at is null
      and p.post_type = 'poll'
  )
);

create policy "authors create poll options"
on public.post_poll_options for insert to authenticated
with check (
  exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and exists (
    select 1 from public.posts p
    where p.id = post_poll_options.post_id
      and p.author_id = (select auth.uid())
      and p.deleted_at is null
      and p.post_type = 'poll'
  )
);

create policy "authors remove own poll options"
on public.post_poll_options for delete to authenticated
using (
  exists (
    select 1 from public.posts p
    where p.id = post_poll_options.post_id
      and p.author_id = (select auth.uid())
  )
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create policy "active members read poll votes"
on public.post_poll_votes for select to authenticated
using (
  exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and exists (
    select 1 from public.posts p
    where p.id = post_poll_votes.post_id
      and p.deleted_at is null
      and p.post_type = 'poll'
  )
);

create policy "active members vote as themselves"
on public.post_poll_votes for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and exists (
    select 1 from public.posts p
    where p.id = post_poll_votes.post_id
      and p.deleted_at is null
      and p.post_type = 'poll'
  )
);

create policy "active members change own poll vote"
on public.post_poll_votes for update to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.posts p
    where p.id = post_poll_votes.post_id
      and p.deleted_at is null
      and p.post_type = 'poll'
  )
);

create policy "active members remove own poll vote"
on public.post_poll_votes for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-media',
  'post-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "active members read post media objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'post-media'
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create policy "members upload own post media objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create policy "members delete own post media objects"
on storage.objects for delete to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create or replace function public.create_poll_post(
  p_category public.post_category,
  p_body text,
  p_options text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_post_id uuid := gen_random_uuid();
  v_options text[];
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  select array_agg(option_text order by first_position)
  into v_options
  from (
    select distinct on (lower(btrim(value)))
      btrim(value) as option_text,
      position as first_position
    from unnest(coalesce(p_options, '{}'::text[])) with ordinality as entry(value, position)
    where char_length(btrim(value)) between 1 and 120
    order by lower(btrim(value)), position
  ) normalized;

  if coalesce(cardinality(v_options), 0) not between 2 and 6 then
    raise exception using errcode = '22023', message = 'polls require 2 to 6 distinct options';
  end if;

  insert into public.posts (id, author_id, category, body, post_type)
  values (v_post_id, v_user_id, p_category, btrim(p_body), 'poll');

  insert into public.post_polls (post_id) values (v_post_id);

  insert into public.post_poll_options (post_id, label, position)
  select v_post_id, option_text, (ordinality - 1)::smallint
  from unnest(v_options) with ordinality as option_row(option_text, ordinality);

  return v_post_id;
end;
$$;

revoke all on function public.create_poll_post(public.post_category, text, text[])
from public, anon, authenticated, service_role;
grant execute on function public.create_poll_post(public.post_category, text, text[])
to authenticated;
