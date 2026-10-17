-- Sea N Shore site fixes round H, release 1. Additive schema plus one idempotent data step.
--
-- Schema (H2):
-- 1. learning_certificates.issuer_relation: 'independent' (the default, every certificate so far) or 'self_issued'
--    (the learner was the course's own mentor, or a member of the publishing organization's team). A self-issued
--    certificate is a completion record, not one Sea N Shore verifies.
-- 2. member_preferences.message_permission: who may start a conversation with the member: 'everyone',
--    'connections' (the default, today's rule) or 'nobody'.
-- 3. member_preferences.connections_visibility: who may see the member's connections, followers and following
--    lists: 'everyone', 'connections' (the default, today's rule) or 'only_me'.
--
-- Data (H2, H9), approved by the owner in the round H brief:
-- 4. Existing certificates whose holder is the course's own mentor or a member of the publishing organization's
--    team become 'self_issued'.
-- 5. The keyboard-mash test course "iktyujdhrgsefawd" (and any draft copy of it) is archived and removed from every
--    listing (removed_at), and its certificates are hidden from profiles. Enrolled learners keep their access, as
--    for any removed course. Nothing is deleted.
-- 6. The cancelled internal event "Sea N shore portal — discussion and brainstorming as how to market" leaves every
--    public list (removed_at). Admin lists still show removed events.
--
-- Safe to run more than once: each data statement matches only rows not yet changed. On a database without these
-- rows (local and test databases) every data statement does nothing. Statement 4 refuses before anything changes
-- if a title matches more than one live course or event, so nothing unexpected is hidden.
-- The previous values are kept in one audit_events row (action site_fixes.round_h.release_1) so every change can be
-- reversed: issuer_relation back to 'independent', removed_at / status / hidden_from_profile back to the saved values.

alter table public.learning_certificates
  add column if not exists issuer_relation text not null default 'independent';
-- statement-breakpoint

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'learning_certificates_issuer_relation_check'
      and conrelid = 'public.learning_certificates'::regclass
  ) then
    alter table public.learning_certificates
      add constraint learning_certificates_issuer_relation_check check (issuer_relation in ('independent', 'self_issued'));
  end if;
end
$$;
-- statement-breakpoint

alter table public.member_preferences
  add column if not exists message_permission text not null default 'connections',
  add column if not exists connections_visibility text not null default 'connections';
-- statement-breakpoint

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'member_preferences_message_permission_check'
      and conrelid = 'public.member_preferences'::regclass
  ) then
    alter table public.member_preferences
      add constraint member_preferences_message_permission_check check (message_permission in ('everyone', 'connections', 'nobody'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'member_preferences_connections_visibility_check'
      and conrelid = 'public.member_preferences'::regclass
  ) then
    alter table public.member_preferences
      add constraint member_preferences_connections_visibility_check check (connections_visibility in ('everyone', 'connections', 'only_me'));
  end if;
end
$$;
-- statement-breakpoint

do $$
begin
  if (
    select count(*) from public.learning_courses
    where lower(title) = 'iktyujdhrgsefawd' and revision_of_course_id is null and removed_at is null
  ) > 1 then
    raise exception 'Round H refused: more than one live course is titled iktyujdhrgsefawd';
  end if;
  if (
    select count(*) from public.events
    where lower(title) like 'sea n shore portal%brainstorming%market%' and removed_at is null
  ) > 1 then
    raise exception 'Round H refused: more than one event matches the internal brainstorming event';
  end if;
  if exists (
    select 1 from public.events
    where lower(title) like 'sea n shore portal%brainstorming%market%' and removed_at is null and status <> 'cancelled'
  ) then
    raise exception 'Round H refused: the internal brainstorming event is not cancelled';
  end if;
end
$$;
-- statement-breakpoint

insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
select
  null,
  'site_fixes.round_h.release_1',
  'data_fix',
  'round_h_release_1',
  jsonb_build_object(
    'fix', 'round H release 1',
    'self_issued_certificates', coalesce((
      select jsonb_agg(jsonb_build_object('id', certificate.id, 'issuer_relation', certificate.issuer_relation) order by certificate.id)
      from public.learning_certificates certificate
      join public.learning_courses course on course.id = certificate.course_id
      where certificate.issuer_relation = 'independent'
        and (
          exists (select 1 from public.learning_mentors own_mentor where own_mentor.id = course.mentor_id and own_mentor.user_id = certificate.learner_id)
          or exists (select 1 from public.company_members own_team where own_team.company_id = course.company_id and own_team.user_id = certificate.learner_id and own_team.approved_at is not null)
        )
    ), '[]'::jsonb),
    'test_courses', coalesce((
      select jsonb_agg(jsonb_build_object('id', course.id, 'status', course.status, 'removed_at', course.removed_at) order by course.id)
      from public.learning_courses course
      where course.removed_at is null
        and (lower(course.title) = 'iktyujdhrgsefawd'
          or course.revision_of_course_id in (select live.id from public.learning_courses live where lower(live.title) = 'iktyujdhrgsefawd'))
    ), '[]'::jsonb),
    'test_course_certificates', coalesce((
      select jsonb_agg(jsonb_build_object('id', certificate.id, 'hidden_from_profile', certificate.hidden_from_profile) order by certificate.id)
      from public.learning_certificates certificate
      join public.learning_courses course on course.id = certificate.course_id
      where lower(course.title) = 'iktyujdhrgsefawd' and certificate.hidden_from_profile = false
    ), '[]'::jsonb),
    'internal_events', coalesce((
      select jsonb_agg(jsonb_build_object('id', event.id, 'removed_at', event.removed_at) order by event.id)
      from public.events event
      where lower(event.title) like 'sea n shore portal%brainstorming%market%' and event.status = 'cancelled' and event.removed_at is null
    ), '[]'::jsonb)
  )
where exists (
  select 1
  from public.learning_certificates certificate
  join public.learning_courses course on course.id = certificate.course_id
  where certificate.issuer_relation = 'independent'
    and (
      exists (select 1 from public.learning_mentors own_mentor where own_mentor.id = course.mentor_id and own_mentor.user_id = certificate.learner_id)
      or exists (select 1 from public.company_members own_team where own_team.company_id = course.company_id and own_team.user_id = certificate.learner_id and own_team.approved_at is not null)
    )
)
or exists (select 1 from public.learning_courses course where lower(course.title) = 'iktyujdhrgsefawd' and course.removed_at is null)
or exists (
  select 1 from public.learning_certificates certificate
  join public.learning_courses course on course.id = certificate.course_id
  where lower(course.title) = 'iktyujdhrgsefawd' and certificate.hidden_from_profile = false
)
or exists (
  select 1 from public.events event
  where lower(event.title) like 'sea n shore portal%brainstorming%market%' and event.status = 'cancelled' and event.removed_at is null
);
-- statement-breakpoint

update public.learning_certificates certificate set issuer_relation = 'self_issued' from public.learning_courses course where course.id = certificate.course_id and certificate.issuer_relation = 'independent' and (exists (select 1 from public.learning_mentors own_mentor where own_mentor.id = course.mentor_id and own_mentor.user_id = certificate.learner_id) or exists (select 1 from public.company_members own_team where own_team.company_id = course.company_id and own_team.user_id = certificate.learner_id and own_team.approved_at is not null));
-- statement-breakpoint

update public.learning_certificates certificate set hidden_from_profile = true from public.learning_courses course where course.id = certificate.course_id and lower(course.title) = 'iktyujdhrgsefawd' and certificate.hidden_from_profile = false;
-- statement-breakpoint

update public.learning_courses set status = 'archived', removed_at = now(), updated_at = now() where removed_at is null and (lower(title) = 'iktyujdhrgsefawd' or revision_of_course_id in (select live.id from public.learning_courses live where lower(live.title) = 'iktyujdhrgsefawd'));
-- statement-breakpoint

update public.events set removed_at = now(), updated_at = now() where lower(title) like 'sea n shore portal%brainstorming%market%' and status = 'cancelled' and removed_at is null;
