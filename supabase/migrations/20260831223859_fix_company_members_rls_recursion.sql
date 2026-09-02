create or replace function private.company_has_approved_member(target_company_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members
    where company_id = target_company_id and approved_at is not null
  );
$$;

revoke all on function private.company_has_approved_member(uuid) from public;
grant execute on function private.company_has_approved_member(uuid) to anon, authenticated;

create or replace function private.is_approved_company_manager(target_company_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members
    where company_id = target_company_id
      and user_id = (select auth.uid())
      and approved_at is not null
      and role in ('owner', 'administrator')
  );
$$;

revoke all on function private.is_approved_company_manager(uuid) from public;
grant execute on function private.is_approved_company_manager(uuid) to authenticated;

alter policy "active companies are readable"
on public.companies
using (private.company_has_approved_member(companies.id));

alter policy "approved company members manage company"
on public.companies
using (private.is_approved_company_manager(companies.id));

alter policy "company memberships are visible to members"
on public.company_members
using (
  user_id = (select auth.uid())
  or private.is_approved_company_manager(company_members.company_id)
);
