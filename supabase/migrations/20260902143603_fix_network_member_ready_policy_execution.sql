create or replace function private.network_member_ready(p_user_id uuid)
returns boolean
language sql
stable
security invoker
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

revoke all on function private.network_member_ready(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.network_member_ready(uuid) to authenticated;
