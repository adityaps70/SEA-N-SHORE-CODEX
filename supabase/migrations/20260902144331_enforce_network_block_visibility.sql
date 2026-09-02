create or replace function network_private.profile_visible(p_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when p_target_id = auth.uid() then true
    else private.network_member_ready(p_target_id)
      and not private.network_pair_blocked(auth.uid(), p_target_id)
  end;
$$;

revoke all on function network_private.profile_visible(uuid)
from public, anon, authenticated, service_role;
grant execute on function network_private.profile_visible(uuid) to authenticated;

create or replace function public.network_profile_visible(p_target_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select network_private.profile_visible(p_target_id);
$$;

revoke all on function public.network_profile_visible(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.network_profile_visible(uuid) to authenticated;

alter policy "members read their own profile"
on public.profiles
to authenticated
using (
  id = (select auth.uid())
  or public.network_profile_visible(id)
);

alter policy "active members read posts"
on public.posts
to authenticated
using (
  deleted_at is null
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
  and public.network_profile_visible(author_id)
);
