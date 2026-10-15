-- Sea N Shore one-off data fix T1: the SIRE 2.0 course moves from its trainer's personal profile to the
-- organization BEAUFORT MARINE SERVICES LLP, as if the organization had published it.
--
-- Rows changed (nothing is deleted, no id or slug changes):
-- 1. learning_courses: the live course f046e907-b42d-4a19-a47e-4e435ad582d2 and every draft copy of it
--    (revision_of_course_id = the live course, including the open draft 23c5171e-adde-4515-b90a-77ac94e635c5) get
--    company_id = the organization and mentor_id = null, the shape createCourse gives an organization course.
--    created_by_user_id stays the member who created the course.
-- 2. learning_promo_codes owned by the trainer and limited to this course move to the organization, so they keep
--    applying (the checkout matches an organization course's codes by company_id).
--
-- Left as they are on purpose: orders, seller earnings and payouts (paid sales stay with the trainer; the seller
-- of a new sale is read from the course when the payment is confirmed), certificates (issuer name, signatory and
-- logo are copied onto each certificate when it is issued), enrolments, progress, attempts, reviews,
-- announcements, the course community, batches and training seats.
--
-- Safe to run more than once: once the rows are moved nothing matches. On a database without this course (local
-- and test databases) every statement does nothing. Before anything changes, statement 1 refuses unless the
-- organization is the expected, claimed and verified page, may publish courses, and the trainer is one of its
-- owners, administrators or LMS managers, so the trainer keeps editing the course and its draft.
-- The previous values are kept in one audit_events row (action learning.course.publisher_transferred) so the move
-- can be reversed.

do $$
declare
  live_id constant uuid := 'f046e907-b42d-4a19-a47e-4e435ad582d2';
  draft_id constant uuid := '23c5171e-adde-4515-b90a-77ac94e635c5';
  org_id constant uuid := '8283e58e-8fd6-4d3a-9271-a7e7abb3549f';
  live record;
  org record;
begin
  select id, mentor_id, company_id, revision_of_course_id into live
  from public.learning_courses where id = live_id;
  if not found then
    return;
  end if;
  if not exists (
    select 1 from public.learning_courses c
    where (c.id = live_id or c.revision_of_course_id = live_id)
      and (c.company_id is distinct from org_id or c.mentor_id is not null)
  ) then
    return;
  end if;

  if live.revision_of_course_id is not null then
    raise exception 'T1 refused: the course id is a draft copy, not the live course';
  end if;
  if exists (
    select 1 from public.learning_courses c
    where (c.id = live_id or c.revision_of_course_id = live_id)
      and c.company_id is not null and c.company_id <> org_id
  ) then
    raise exception 'T1 refused: the course or a draft copy already belongs to another organization';
  end if;
  if exists (select 1 from public.learning_courses where id = draft_id and revision_of_course_id is distinct from live_id) then
    raise exception 'T1 refused: the draft id is not a draft copy of this course';
  end if;

  select id, slug, claim_status, coalesce(is_verified, false) as verified into org
  from public.companies where id = org_id;
  if not found then
    raise exception 'T1 refused: the organization does not exist';
  end if;
  if org.slug <> 'beaufort-marine-services-llp-eddf5d86' then
    raise exception 'T1 refused: the organization id and page slug do not match';
  end if;
  if org.claim_status <> 'claimed' or not org.verified then
    raise exception 'T1 refused: the organization is not a claimed, verified page (learners would lose the course)';
  end if;
  if not (
    exists (
      select 1 from public.account_subscriptions s
      join public.plan_entitlements pe on pe.plan_code = s.plan_code and pe.capability = 'course.publish'
      where s.company_id = org_id
        and s.status in ('trialing', 'active', 'past_due')
        and (s.current_period_ends_at is null or s.current_period_ends_at > now())
    )
    or exists (
      select 1 from public.entitlement_grants g
      where g.company_id = org_id and g.capability = 'course.publish' and g.revoked_at is null
        and (g.expires_at is null or g.expires_at > now())
    )
  ) then
    raise exception 'T1 refused: the organization may not publish courses (no current plan or grant with course.publish)';
  end if;

  if live.mentor_id is not null and not exists (
    select 1
    from public.learning_mentors m
    join public.company_members cm on cm.user_id = m.user_id
    where m.id = live.mentor_id
      and cm.company_id = org_id
      and cm.approved_at is not null
      and cm.role::text in ('owner', 'administrator', 'lms_manager')
  ) then
    raise exception 'T1 refused: the trainer is not an owner, administrator or LMS manager of the organization';
  end if;

  if exists (
    select 1
    from public.learning_promo_codes moving
    join public.learning_promo_codes existing on existing.company_id = org_id and existing.code = moving.code
    where moving.course_id = live_id and moving.mentor_id is not null
  ) then
    raise exception 'T1 refused: a promo code of this course has the same code as one of the organization''s codes';
  end if;
end
$$;
-- statement-breakpoint

insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
select
  null,
  'learning.course.publisher_transferred',
  'learning_course',
  'f046e907-b42d-4a19-a47e-4e435ad582d2',
  jsonb_build_object(
    'fix', 'T1',
    'to_company_id', '8283e58e-8fd6-4d3a-9271-a7e7abb3549f',
    'courses', (
      select jsonb_agg(jsonb_build_object('id', c.id, 'mentor_id', c.mentor_id, 'company_id', c.company_id) order by c.created_at, c.id)
      from public.learning_courses c
      where c.id = 'f046e907-b42d-4a19-a47e-4e435ad582d2'
         or c.revision_of_course_id = 'f046e907-b42d-4a19-a47e-4e435ad582d2'
    ),
    'promo_codes', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'mentor_id', p.mentor_id, 'company_id', p.company_id) order by p.created_at, p.id)
      from public.learning_promo_codes p
      where p.course_id = 'f046e907-b42d-4a19-a47e-4e435ad582d2' and p.mentor_id is not null
    ), '[]'::jsonb)
  )
where exists (
  select 1 from public.learning_courses c
  where (c.id = 'f046e907-b42d-4a19-a47e-4e435ad582d2' or c.revision_of_course_id = 'f046e907-b42d-4a19-a47e-4e435ad582d2')
    and (c.company_id is distinct from '8283e58e-8fd6-4d3a-9271-a7e7abb3549f' or c.mentor_id is not null)
);
-- statement-breakpoint

update public.learning_promo_codes
set company_id = '8283e58e-8fd6-4d3a-9271-a7e7abb3549f', mentor_id = null, updated_at = now()
where course_id = 'f046e907-b42d-4a19-a47e-4e435ad582d2' and mentor_id is not null;
-- statement-breakpoint

update public.learning_courses
set company_id = '8283e58e-8fd6-4d3a-9271-a7e7abb3549f', mentor_id = null, updated_at = now()
where (id = 'f046e907-b42d-4a19-a47e-4e435ad582d2' or revision_of_course_id = 'f046e907-b42d-4a19-a47e-4e435ad582d2')
  and (company_id is distinct from '8283e58e-8fd6-4d3a-9271-a7e7abb3549f' or mentor_id is not null);
