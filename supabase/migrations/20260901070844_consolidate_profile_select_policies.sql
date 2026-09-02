alter policy "public profiles are readable"
on public.profiles
to anon
using (account_status = 'active' and onboarding_completed_at is not null);

alter policy "members read their own profile"
on public.profiles
to authenticated
using (
  id = (select auth.uid())
  or (account_status = 'active' and onboarding_completed_at is not null)
);
