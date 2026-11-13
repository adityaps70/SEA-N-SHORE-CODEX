-- P6 (owner-approved 13 Nov): ranks from other departments on a job, shared for everyone per department.
-- A job's accepted ranks may now include existing ranks of other departments (jobs.accepted_role_keys already allows
-- any rank key). The first time a job under a department saves with such a rank, the department remembers it here:
-- every poster then sees it as a tick box in that department's list (not ticked), the department's own ranks first,
-- then these, most used first. times_used is the number of live jobs under the department that accept the rank,
-- recounted on every save. An admin can hide a link from future forms; jobs already posted keep their ranks.
--
-- jobs.role_other_text_original keeps a typed "Other" rank word for word when the owner later approves converting
-- the clear ones to structured ranks (a separate, reversible runner action), so nothing typed is ever lost.
--
-- Additive and safe to run more than once: one new table, one new nullable column, and a backfill that only inserts
-- links that do not exist yet (none are expected: until now the form allowed only the department's own ranks).
-- Reversible: drop table public.job_department_extra_ranks; alter table public.jobs drop column role_other_text_original.
-- statement-breakpoint
create table if not exists public.job_department_extra_ranks (
  department_key text not null check (department_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  role_key text not null check (role_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  first_added_at timestamptz not null default now(),
  times_used integer not null default 0 check (times_used >= 0),
  updated_at timestamptz not null default now(),
  hidden_at timestamptz null,
  hidden_by uuid null references public.profiles(id) on delete set null,
  primary key (department_key, role_key)
);
-- statement-breakpoint
create index if not exists job_department_extra_ranks_shown_idx
  on public.job_department_extra_ranks (department_key, times_used desc)
  where hidden_at is null;
-- statement-breakpoint
alter table public.jobs add column if not exists role_other_text_original text null
  check (role_other_text_original is null or char_length(role_other_text_original) between 1 and 100);
-- statement-breakpoint
-- Links for any existing job that already accepts a rank of another department (counts only; expected none).
insert into public.job_department_extra_ranks (department_key, role_key, times_used)
select j.department_key, key, count(*)::int
from public.jobs j
cross join lateral unnest(j.accepted_role_keys) as key
join public.maritime_ranks r on r.code = key
where j.deleted_at is null and j.department_key is not null and r.department_key <> j.department_key
group by j.department_key, key
on conflict (department_key, role_key) do nothing;
