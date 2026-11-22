-- Round GP Part E (E1): which admin sections each country admin may use, set by a platform administrator in
-- Admin > Country admins.
--
-- 1. public.country_admin_permissions: one row per country admin and section. A row means the section is visible
--    (view); can_act also allows its decisions (approve, reject, hide and so on). Members by country and the
--    Overview are view only. Rows go when the country admin goes (on delete cascade).
-- 2. Backfill: every existing country admin keeps exactly what they had before (owner, 21 Nov): Organizations with
--    decisions, and Members by country. A new country admin starts with Organizations only (set by the app).
--
-- Every scope is still limited to the admin's own countries (public.country_admins.countries); this table only
-- chooses sections. Additive and safe to run more than once (the backfill skips rows that exist). No existing row is
-- rewritten. Reversible: drop table public.country_admin_permissions (the app then falls back to the two sections
-- above).
-- statement-breakpoint
create table if not exists public.country_admin_permissions (
  profile_id uuid not null references public.country_admins(profile_id) on delete cascade,
  section text not null,
  can_act boolean not null default false,
  granted_by uuid null references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (profile_id, section),
  constraint country_admin_permissions_section_check check (
    section in ('overview', 'organizations', 'members', 'learning', 'events', 'moderation', 'communities', 'verification', 'access')
  ),
  constraint country_admin_permissions_act_check check (
    not can_act or section not in ('overview', 'members')
  )
);
-- statement-breakpoint
insert into public.country_admin_permissions (profile_id, section, can_act, granted_by)
select ca.profile_id, s.section, s.can_act, ca.granted_by
from public.country_admins ca
cross join (values ('organizations', true), ('members', false)) as s(section, can_act)
on conflict (profile_id, section) do nothing;
