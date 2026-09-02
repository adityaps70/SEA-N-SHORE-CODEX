create type public.connection_status as enum ('pending', 'accepted');
create type public.network_notification_type as enum (
  'connection_request',
  'connection_accepted',
  'new_follower'
);

create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_not_self check (follower_id <> following_id)
);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_low_id uuid not null references public.profiles(id) on delete cascade,
  user_high_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status public.connection_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_low_id, user_high_id),
  constraint connections_canonical_pair check (user_low_id < user_high_id),
  constraint connections_requester_in_pair check (
    requested_by = user_low_id or requested_by = user_high_id
  )
);

create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  notification_type public.network_notification_type not null,
  connection_id uuid references public.connections(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index follows_following_created_idx
  on public.follows (following_id, created_at desc);
create index follows_follower_created_idx
  on public.follows (follower_id, created_at desc);
create index connections_low_status_updated_idx
  on public.connections (user_low_id, status, updated_at desc);
create index connections_high_status_updated_idx
  on public.connections (user_high_id, status, updated_at desc);
create index connections_requested_by_status_idx
  on public.connections (requested_by, status, created_at desc);
create index user_blocks_blocked_blocker_idx
  on public.user_blocks (blocked_id, blocker_id);
create index notifications_recipient_read_created_idx
  on public.notifications (recipient_id, read_at, created_at desc);
create index notifications_connection_idx
  on public.notifications (connection_id)
  where connection_id is not null;

create or replace function private.set_network_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_network_updated_at()
from public, anon, authenticated, service_role;

create trigger connections_set_updated_at
before update on public.connections
for each row execute procedure private.set_network_updated_at();

create or replace function private.network_member_ready(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.account_status = 'active'
      and p.onboarding_completed_at is not null
  );
$$;

create or replace function private.network_pair_blocked(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = p_user_a and b.blocked_id = p_user_b)
       or (b.blocker_id = p_user_b and b.blocked_id = p_user_a)
  );
$$;

revoke all on function private.network_member_ready(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.network_pair_blocked(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function public.follow_profile(p_target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_created boolean := false;
begin
  if v_actor is null then
    raise exception using message = 'network_action_not_allowed';
  end if;
  if v_actor = p_target_id then
    raise exception using message = 'network_self_interaction';
  end if;
  if not private.network_member_ready(v_actor)
     or not private.network_member_ready(p_target_id)
     or private.network_pair_blocked(v_actor, p_target_id) then
    raise exception using message = 'network_interaction_unavailable';
  end if;

  insert into public.follows (follower_id, following_id)
  values (v_actor, p_target_id)
  on conflict do nothing
  returning true into v_created;

  if coalesce(v_created, false) then
    insert into public.notifications (
      recipient_id, actor_id, notification_type
    ) values (
      p_target_id, v_actor, 'new_follower'
    );
  end if;

  return coalesce(v_created, false);
end;
$$;

create or replace function public.unfollow_profile(p_target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_deleted boolean := false;
begin
  if v_actor is null then
    raise exception using message = 'network_action_not_allowed';
  end if;
  if v_actor = p_target_id then
    raise exception using message = 'network_self_interaction';
  end if;

  delete from public.follows
  where follower_id = v_actor
    and following_id = p_target_id
  returning true into v_deleted;

  return coalesce(v_deleted, false);
end;
$$;

create or replace function public.send_connection_request(p_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_low uuid;
  v_high uuid;
  v_connection_id uuid;
  v_existing_status public.connection_status;
begin
  if v_actor is null then
    raise exception using message = 'network_action_not_allowed';
  end if;
  if v_actor = p_target_id then
    raise exception using message = 'network_self_interaction';
  end if;
  if not private.network_member_ready(v_actor)
     or not private.network_member_ready(p_target_id)
     or private.network_pair_blocked(v_actor, p_target_id) then
    raise exception using message = 'network_interaction_unavailable';
  end if;

  v_low := least(v_actor, p_target_id);
  v_high := greatest(v_actor, p_target_id);

  select c.status
  into v_existing_status
  from public.connections c
  where c.user_low_id = v_low and c.user_high_id = v_high;

  if found then
    if v_existing_status = 'accepted' then
      raise exception using message = 'network_already_connected';
    end if;
    raise exception using message = 'network_request_exists';
  end if;

  begin
    insert into public.connections (
      user_low_id, user_high_id, requested_by, status
    ) values (
      v_low, v_high, v_actor, 'pending'
    )
    returning id into v_connection_id;
  exception when unique_violation then
    select c.status
    into v_existing_status
    from public.connections c
    where c.user_low_id = v_low and c.user_high_id = v_high;

    if v_existing_status = 'accepted' then
      raise exception using message = 'network_already_connected';
    end if;
    raise exception using message = 'network_request_exists';
  end;

  insert into public.notifications (
    recipient_id, actor_id, notification_type, connection_id
  ) values (
    p_target_id, v_actor, 'connection_request', v_connection_id
  );

  return v_connection_id;
end;
$$;

create or replace function public.cancel_connection_request(p_connection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_connection public.connections%rowtype;
begin
  if v_actor is null then
    raise exception using message = 'network_action_not_allowed';
  end if;

  select * into v_connection
  from public.connections
  where id = p_connection_id
  for update;

  if not found
     or v_connection.status <> 'pending'
     or v_connection.requested_by <> v_actor then
    raise exception using message = 'network_action_not_allowed';
  end if;

  delete from public.notifications
  where connection_id = p_connection_id
    and notification_type = 'connection_request';

  delete from public.connections where id = p_connection_id;
  return true;
end;
$$;

create or replace function public.accept_connection_request(p_connection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_connection public.connections%rowtype;
  v_other uuid;
begin
  if v_actor is null then
    raise exception using message = 'network_action_not_allowed';
  end if;

  select * into v_connection
  from public.connections
  where id = p_connection_id
  for update;

  if not found
     or v_connection.status <> 'pending'
     or v_actor not in (v_connection.user_low_id, v_connection.user_high_id)
     or v_connection.requested_by = v_actor then
    raise exception using message = 'network_action_not_allowed';
  end if;

  v_other := case
    when v_actor = v_connection.user_low_id then v_connection.user_high_id
    else v_connection.user_low_id
  end;

  if not private.network_member_ready(v_actor)
     or not private.network_member_ready(v_other)
     or private.network_pair_blocked(v_actor, v_other) then
    raise exception using message = 'network_interaction_unavailable';
  end if;

  update public.connections
  set status = 'accepted', responded_at = now()
  where id = p_connection_id;

  insert into public.follows (follower_id, following_id)
  values
    (v_actor, v_other),
    (v_other, v_actor)
  on conflict do nothing;

  delete from public.notifications
  where connection_id = p_connection_id
    and notification_type = 'connection_request';

  insert into public.notifications (
    recipient_id, actor_id, notification_type, connection_id
  ) values (
    v_connection.requested_by, v_actor, 'connection_accepted', p_connection_id
  );

  return true;
end;
$$;

create or replace function public.decline_connection_request(p_connection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_connection public.connections%rowtype;
begin
  if v_actor is null then
    raise exception using message = 'network_action_not_allowed';
  end if;

  select * into v_connection
  from public.connections
  where id = p_connection_id
  for update;

  if not found
     or v_connection.status <> 'pending'
     or v_actor not in (v_connection.user_low_id, v_connection.user_high_id)
     or v_connection.requested_by = v_actor then
    raise exception using message = 'network_action_not_allowed';
  end if;

  delete from public.notifications
  where connection_id = p_connection_id
    and notification_type = 'connection_request';

  delete from public.connections where id = p_connection_id;
  return true;
end;
$$;

create or replace function public.remove_connection(p_connection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_connection public.connections%rowtype;
begin
  if v_actor is null then
    raise exception using message = 'network_action_not_allowed';
  end if;

  select * into v_connection
  from public.connections
  where id = p_connection_id
  for update;

  if not found
     or v_connection.status <> 'accepted'
     or v_actor not in (v_connection.user_low_id, v_connection.user_high_id) then
    raise exception using message = 'network_action_not_allowed';
  end if;

  delete from public.connections where id = p_connection_id;
  return true;
end;
$$;

create or replace function public.block_profile(p_target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_created boolean := false;
begin
  if v_actor is null then
    raise exception using message = 'network_action_not_allowed';
  end if;
  if v_actor = p_target_id then
    raise exception using message = 'network_self_interaction';
  end if;
  if not private.network_member_ready(v_actor)
     or not private.network_member_ready(p_target_id) then
    raise exception using message = 'network_interaction_unavailable';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_actor, p_target_id)
  on conflict do nothing
  returning true into v_created;

  delete from public.follows
  where (follower_id = v_actor and following_id = p_target_id)
     or (follower_id = p_target_id and following_id = v_actor);

  delete from public.notifications n
  using public.connections c
  where n.connection_id = c.id
    and n.notification_type = 'connection_request'
    and c.user_low_id = least(v_actor, p_target_id)
    and c.user_high_id = greatest(v_actor, p_target_id);

  delete from public.connections
  where user_low_id = least(v_actor, p_target_id)
    and user_high_id = greatest(v_actor, p_target_id);

  return coalesce(v_created, false);
end;
$$;

create or replace function public.unblock_profile(p_target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_deleted boolean := false;
begin
  if v_actor is null then
    raise exception using message = 'network_action_not_allowed';
  end if;
  if v_actor = p_target_id then
    raise exception using message = 'network_self_interaction';
  end if;

  delete from public.user_blocks
  where blocker_id = v_actor
    and blocked_id = p_target_id
  returning true into v_deleted;

  return coalesce(v_deleted, false);
end;
$$;

alter table public.follows enable row level security;
alter table public.connections enable row level security;
alter table public.user_blocks enable row level security;
alter table public.notifications enable row level security;

revoke all on public.follows, public.connections, public.user_blocks, public.notifications
from anon, authenticated;

grant select on public.follows to authenticated;
grant select on public.connections to authenticated;
grant select on public.user_blocks to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "active members read follows"
on public.follows for select to authenticated
using (
  private.network_member_ready((select auth.uid()))
);

create policy "members read own connections"
on public.connections for select to authenticated
using (
  (select auth.uid()) is not null
  and ((select auth.uid()) = user_low_id or (select auth.uid()) = user_high_id)
  and private.network_member_ready((select auth.uid()))
);

create policy "members read own blocks"
on public.user_blocks for select to authenticated
using (
  blocker_id = (select auth.uid())
  and private.network_member_ready((select auth.uid()))
);

create policy "members read own notifications"
on public.notifications for select to authenticated
using (
  recipient_id = (select auth.uid())
  and private.network_member_ready((select auth.uid()))
);

create policy "members update own notification read state"
on public.notifications for update to authenticated
using (
  recipient_id = (select auth.uid())
  and private.network_member_ready((select auth.uid()))
)
with check (
  recipient_id = (select auth.uid())
  and private.network_member_ready((select auth.uid()))
);

revoke all on function public.follow_profile(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.unfollow_profile(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.send_connection_request(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.cancel_connection_request(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.accept_connection_request(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.decline_connection_request(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.remove_connection(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.block_profile(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.unblock_profile(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.follow_profile(uuid) to authenticated;
grant execute on function public.unfollow_profile(uuid) to authenticated;
grant execute on function public.send_connection_request(uuid) to authenticated;
grant execute on function public.cancel_connection_request(uuid) to authenticated;
grant execute on function public.accept_connection_request(uuid) to authenticated;
grant execute on function public.decline_connection_request(uuid) to authenticated;
grant execute on function public.remove_connection(uuid) to authenticated;
grant execute on function public.block_profile(uuid) to authenticated;
grant execute on function public.unblock_profile(uuid) to authenticated;
