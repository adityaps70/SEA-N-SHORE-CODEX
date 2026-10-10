export const COURSE_ORGANIZATION_MANAGER_ROLES = ['owner', 'administrator', 'lms_manager'] as const

export function courseManagerAccessSql(courseAlias: string, actorParam: string) {
  return `(
    exists (
      select 1
      from public.learning_mentors access_mentor
      where access_mentor.id = ${courseAlias}.mentor_id
        and access_mentor.user_id = ${actorParam}
        and access_mentor.status = 'active'
    )
    or (
      ${courseAlias}.company_id is not null
      and exists (
        select 1
        from public.company_members access_cm
        where access_cm.company_id = ${courseAlias}.company_id
          and access_cm.user_id = ${actorParam}
          and access_cm.approved_at is not null
          and access_cm.role::text in ('owner', 'administrator', 'lms_manager')
      )
    )
  )`
}

/**
 * Round C (C3): an enrolment whose access period has ended keeps its progress, results and certificate, but opens
 * no material and records nothing new until the learner renews. Null = lifetime access.
 */
export function enrollmentAccessOpenSql(enrollmentAlias = 'enrollment') {
  return `(${enrollmentAlias}.access_expires_at is null or ${enrollmentAlias}.access_expires_at > now())`
}

/**
 * Round D: who may run one batch (its learners, sessions, attendance and recordings): the course's managers (as
 * above), the batch's manager, or one of its instructors. `batchAlias` is a public.learning_course_batches row. Batch
 * staff do not get course editing, prices or other batches. Platform admins are allowed by the caller, as for courses.
 */
export function batchStaffAccessSql(batchAlias: string, actorParam: string) {
  return `(
    ${batchAlias}.manager_profile_id = ${actorParam}
    or exists (
      select 1
      from public.learning_batch_instructors access_bi
      where access_bi.batch_id = ${batchAlias}.id
        and access_bi.profile_id = ${actorParam}
    )
    or exists (
      select 1
      from public.learning_courses access_bc
      where access_bc.id = ${batchAlias}.course_id
        and ${courseManagerAccessSql('access_bc', actorParam)}
    )
  )`
}
