create schema if not exists network_private;
revoke all on schema network_private from public, anon, authenticated, service_role;
grant usage on schema network_private to authenticated;

create or replace function network_private.follow_profile(p_target_id uuid)
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
    insert into public.notifications (recipient_id, actor_id, notification_type)
    values (p_target_id, v_actor, 'new_follower');
  end if;

  return coalesce(v_created, false);
end;
$$;

create or replace function network_private.unfollow_profile(p_target_id uuid)
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

create or replace function network_private.send_connection_request(p_target_id uuid)
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

  select c.status into v_existing_status
  from public.connections c
  where c.user_low_id = v_low and c.user_high_id = v_high;

  if found then
    if v_existing_status = 'accepted' then
      raise exception using message = 'network_already_connected';
    end if;
    raise exception using message = 'network_request_exists';
  end if;

  begin
    insert into public.connections (user_low_id, user_high_id, requested_by, status)
    values (v_low, v_high, v_actor, 'pending')
    returning id into v_connection_id;
  exception when unique_violation then
    select c.status into v_existing_status
    from public.connections c
    where c.user_low_id = v_low and c.user_high_id = v_high;

    if v_existing_status = 'accepted' then
      raise exception using message = 'network_already_connected';
    end if;
    raise exception using message = 'network_request_exists';
  end;

  insert into public.notifications (recipient_id, actor_id, notification_type, connection_id)
  values (p_target_id, v_actor, 'connection_request', v_connection_id);

  return v_connection_id;
end;
$$;

create or replace function network_private.cancel_connection_request(p_connection_id uuid)
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

create or replace function network_private.accept_connection_request(p_connection_id uuid)
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
  values (v_actor, v_other), (v_other, v_actor)
  on conflict do nothing;

  delete from public.notifications
  where connection_id = p_connection_id
    and notification_type = 'connection_request';

  insert into public.notifications (recipient_id, actor_id, notification_type, connection_id)
  values (v_connection.requested_by, v_actor, 'connection_accepted', p_connection_id);

  return true;
end;
$$;

create or replace function network_private.decline_connection_request(p_connection_id uuid)
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

create or replace function network_private.remove_connection(p_connection_id uuid)
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

create or replace function network_private.block_profile(p_target_id uuid)
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

create or replace function network_private.unblock_profile(p_target_id uuid)
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

revoke all on function network_private.follow_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function network_private.unfollow_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function network_private.send_connection_request(uuid) from public, anon, authenticated, service_role;
revoke all on function network_private.cancel_connection_request(uuid) from public, anon, authenticated, service_role;
revoke all on function network_private.accept_connection_request(uuid) from public, anon, authenticated, service_role;
revoke all on function network_private.decline_connection_request(uuid) from public, anon, authenticated, service_role;
revoke all on function network_private.remove_connection(uuid) from public, anon, authenticated, service_role;
revoke all on function network_private.block_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function network_private.unblock_profile(uuid) from public, anon, authenticated, service_role;

grant execute on function network_private.follow_profile(uuid) to authenticated;
grant execute on function network_private.unfollow_profile(uuid) to authenticated;
grant execute on function network_private.send_connection_request(uuid) to authenticated;
grant execute on function network_private.cancel_connection_request(uuid) to authenticated;
grant execute on function network_private.accept_connection_request(uuid) to authenticated;
grant execute on function network_private.decline_connection_request(uuid) to authenticated;
grant execute on function network_private.remove_connection(uuid) to authenticated;
grant execute on function network_private.block_profile(uuid) to authenticated;
grant execute on function network_private.unblock_profile(uuid) to authenticated;

create or replace function public.follow_profile(p_target_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select network_private.follow_profile(p_target_id); $$;
create or replace function public.unfollow_profile(p_target_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select network_private.unfollow_profile(p_target_id); $$;
create or replace function public.send_connection_request(p_target_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select network_private.send_connection_request(p_target_id); $$;
create or replace function public.cancel_connection_request(p_connection_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select network_private.cancel_connection_request(p_connection_id); $$;
create or replace function public.accept_connection_request(p_connection_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select network_private.accept_connection_request(p_connection_id); $$;
create or replace function public.decline_connection_request(p_connection_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select network_private.decline_connection_request(p_connection_id); $$;
create or replace function public.remove_connection(p_connection_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select network_private.remove_connection(p_connection_id); $$;
create or replace function public.block_profile(p_target_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select network_private.block_profile(p_target_id); $$;
create or replace function public.unblock_profile(p_target_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select network_private.unblock_profile(p_target_id); $$;

revoke all on function public.follow_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function public.unfollow_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function public.send_connection_request(uuid) from public, anon, authenticated, service_role;
revoke all on function public.cancel_connection_request(uuid) from public, anon, authenticated, service_role;
revoke all on function public.accept_connection_request(uuid) from public, anon, authenticated, service_role;
revoke all on function public.decline_connection_request(uuid) from public, anon, authenticated, service_role;
revoke all on function public.remove_connection(uuid) from public, anon, authenticated, service_role;
revoke all on function public.block_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function public.unblock_profile(uuid) from public, anon, authenticated, service_role;

grant execute on function public.follow_profile(uuid) to authenticated;
grant execute on function public.unfollow_profile(uuid) to authenticated;
grant execute on function public.send_connection_request(uuid) to authenticated;
grant execute on function public.cancel_connection_request(uuid) to authenticated;
grant execute on function public.accept_connection_request(uuid) to authenticated;
grant execute on function public.decline_connection_request(uuid) to authenticated;
grant execute on function public.remove_connection(uuid) to authenticated;
grant execute on function public.block_profile(uuid) to authenticated;
grant execute on function public.unblock_profile(uuid) to authenticated;
