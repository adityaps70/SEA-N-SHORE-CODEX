-- P6b (owner-approved 15 Nov): platform administrators add a missing rank to the master list (public.maritime_ranks)
-- and it appears everywhere at once: job validation, rank pickers, profiles, search and matching.
--
-- An added rank is a row in public.maritime_ranks with source 'admin', next to the seeded ones:
-- - position: its place on the ladder, between its neighbours (seeded ranks keep their level as their place);
-- - anchor_code / anchor_relation: the rank it was placed above, at the same level as, or below (for list order);
-- - added_by / added_at, and hidden_at / hidden_by when an administrator hides it from pickers. A hidden rank stays:
--   jobs and profiles that have it keep it and still match. Ranks are never deleted and their codes never reused.
--
-- public.maritime_rank_steps gives each rank its step on its ladder (1 = most senior, ranks at the same place share a
-- step). For the seeded ranks a step difference equals the ladder_level difference for every pair of ranks, so the feed
-- and people-you-may-know rank bands that move to it are unchanged until an administrator adds a rank.
--
-- Additive and safe to run more than once. Reversible: drop view public.maritime_rank_steps; delete from
-- public.maritime_ranks where source = 'admin'; alter table public.maritime_ranks drop column position, drop column
-- source, drop column anchor_code, drop column anchor_relation, drop column added_by, drop column added_at, drop
-- column hidden_at, drop column hidden_by (the app built before this release never reads them).
-- statement-breakpoint
alter table public.maritime_ranks
  add column if not exists position numeric(9, 4) null,
  add column if not exists source text not null default 'seed',
  add column if not exists anchor_code text null,
  add column if not exists anchor_relation text null,
  add column if not exists added_by uuid null references public.profiles(id) on delete set null,
  add column if not exists added_at timestamptz null,
  add column if not exists hidden_at timestamptz null,
  add column if not exists hidden_by uuid null references public.profiles(id) on delete set null;
-- statement-breakpoint
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'maritime_ranks_source_check') then
    alter table public.maritime_ranks add constraint maritime_ranks_source_check check (
      source in ('seed', 'admin')
      and (anchor_relation is null or anchor_relation in ('above', 'same', 'below'))
      and (source = 'seed' or (position is not null and anchor_code is not null and anchor_relation is not null and added_at is not null))
      and (hidden_at is null or source = 'admin')
    );
  end if;
end $$;
-- statement-breakpoint
create or replace view public.maritime_rank_steps as
select r.code, r.department_key, r.ladder,
       dense_rank() over (partition by r.department_key, r.ladder order by coalesce(r.position, r.ladder_level::numeric))::int as step
from public.maritime_ranks r;
