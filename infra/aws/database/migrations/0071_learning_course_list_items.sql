-- Course lists (learning outcomes, requirements, target audience) hold one item per entry, exactly as typed.
-- Until 26 September 2026 the Studio editor split these lists on commas, so an outcome such as
-- "Navigate the CVIQ and identify Core, Rotational 1 and Rotational 2 questions" was saved as two items. This repair
-- rejoins such fragments with the ", " the old editor removed, so every item reads exactly as its trainer typed it.
--
-- A fragment is rejoined to the item before it when it starts with a lowercase letter (no item the old editor kept
-- whole starts lowercase after a comma split) or when the pair is one of the known splits listed below. Every course
-- this changes keeps its original lists in learning_course_list_items_backup, and a course is only rewritten while
-- its lists still equal that backup, so the repair is idempotent and never overwrites a later edit.

create table if not exists public.learning_course_list_items_backup (
  course_id uuid primary key references public.learning_courses(id) on delete cascade,
  learning_outcomes text[] not null,
  requirements text[] not null,
  target_audience text[] not null,
  repaired_learning_outcomes text[] not null,
  repaired_requirements text[] not null,
  repaired_target_audience text[] not null,
  backed_up_at timestamptz not null default now()
);
-- statement-breakpoint

insert into public.learning_course_list_items_backup (
  course_id, learning_outcomes, requirements, target_audience,
  repaired_learning_outcomes, repaired_requirements, repaired_target_audience
)
select listed.id, listed.learning_outcomes, listed.requirements, listed.target_audience,
       listed.repaired_learning_outcomes, listed.repaired_requirements, listed.repaired_target_audience
from (
  select course.id, course.learning_outcomes, course.requirements, course.target_audience, repaired.*
  from public.learning_courses course
  cross join lateral (
    select
      max(case when lists.field = 'learning_outcomes' then lists.items end) as repaired_learning_outcomes,
      max(case when lists.field = 'requirements' then lists.items end) as repaired_requirements,
      max(case when lists.field = 'target_audience' then lists.items end) as repaired_target_audience
    from (
      select source.field, coalesce((
        select array_agg(merged.item order by merged.grp)
        from (
          select grouped.grp, string_agg(grouped.item, ', ' order by grouped.ord) as item
          from (
            select flagged.item, flagged.ord,
                   sum(case when flagged.continues then 0 else 1 end) over (order by flagged.ord) as grp
            from (
              select part.item, part.ord,
                     part.ord > 1 and (
                       part.item ~ '^[a-z]'
                       or (lag(part.item) over (order by part.ord), part.item) in (
                         ('Navigate the CVIQ and identify Core', 'Rotational 1 and Rotational 2 questions'),
                         ('Distinguish Human', 'Process and Hardware factors and answer each type correctly')
                       )
                     ) as continues
              from unnest(source.items) with ordinality as part(item, ord)
            ) flagged
          ) grouped
          group by grouped.grp
        ) merged
      ), '{}'::text[]) as items
      from (values
        ('learning_outcomes', course.learning_outcomes),
        ('requirements', course.requirements),
        ('target_audience', course.target_audience)
      ) as source(field, items)
    ) lists
  ) repaired
) listed
where (listed.repaired_learning_outcomes, listed.repaired_requirements, listed.repaired_target_audience)
  is distinct from (listed.learning_outcomes, listed.requirements, listed.target_audience)
on conflict (course_id) do nothing;
-- statement-breakpoint

update public.learning_courses course
set learning_outcomes = backup.repaired_learning_outcomes,
    requirements = backup.repaired_requirements,
    target_audience = backup.repaired_target_audience
from public.learning_course_list_items_backup backup
where backup.course_id = course.id
  and course.learning_outcomes = backup.learning_outcomes
  and course.requirements = backup.requirements
  and course.target_audience = backup.target_audience;
