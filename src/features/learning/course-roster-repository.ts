import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { roleDisplayLabel } from '@/features/roles/taxonomy'
import { courseManagerAccessSql } from './course-access'
import { courseOpenToNewLearnersSql, liveCourseSql } from './course-publication'
import { ROSTER_ENROL_LIMITS, type RosterEnrolOutcome, type RosterInvitation, type RosterLearner, type RosterQuizScore } from './course-roster'
import { notifyEnrolled } from './learning-notifications'

/**
 * The learner roster (learning round C, C1): who is on a course and how far they are, adding a learner by email,
 * invitations for people who are not members yet, and the audited CSV export.
 *
 * Every call checks that the actor manages the course (or is a platform administrator, `allCourses`). Audit rows
 * record who did what to which course and how many rows; never a learner's name or email.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

export type RosterAccess = { actorId: string; courseId: string; allCourses?: boolean }

export type RosterCourse = { id: string; title: string; slug: string; openToNewLearners: boolean }

function clientQuery(client: DatabaseQueryClient): Query {
  return async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows
}

function iso(value: unknown) {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function count(value: unknown) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return value as T
}

const COURSE_SQL = `
  select course.id, course.title, course.slug,
         (${courseOpenToNewLearnersSql('course', 'mentor', 'application', 'company')}) as open_to_new_learners
  from public.learning_courses course
  left join public.learning_mentors mentor on mentor.id = course.mentor_id
  left join public.learning_mentor_applications application
    on application.id = mentor.application_id and application.user_id = mentor.user_id
  left join public.companies company on company.id = course.company_id
  where course.id = $2::uuid
    and ${liveCourseSql('course')}
    and ($3::boolean or ${courseManagerAccessSql('course', '$1::uuid')})`

async function loadCourse(query: Query, access: RosterAccess, lock = false): Promise<RosterCourse> {
  const rows = await query(`${COURSE_SQL}${lock ? ' for update of course' : ''}`, [access.actorId, access.courseId, Boolean(access.allCourses)])
  const row = rows[0]
  if (!row) throw new Error('course_not_found')
  return { id: String(row.id), title: String(row.title), slug: String(row.slug), openToNewLearners: row.open_to_new_learners === true }
}

const ROSTER_SQL = `
  with course_lessons as (
    select lesson.id
    from public.learning_course_sections section
    inner join public.learning_lessons lesson
      on lesson.section_id = section.id and lesson.is_published = true and lesson.removed_at is null
    where section.course_id = $1::uuid and section.removed_at is null
  ),
  lesson_total as (select count(*)::int as total from course_lessons)
  select
    enrollment.id as enrollment_id,
    enrollment.learner_id,
    enrollment.enrollment_source,
    enrollment.status,
    enrollment.enrolled_at,
    enrollment.access_expires_at,
    profile.full_name,
    profile.slug,
    profile.role_key,
    profile.role_other_text,
    maritime.rank as legacy_rank,
    lesson_total.total as total_lessons,
    (select count(*)::int
       from public.learning_progress progress
       inner join course_lessons lesson on lesson.id = progress.lesson_id
       where progress.enrollment_id = enrollment.id and progress.completed = true) as completed_lessons,
    greatest(
      enrollment.enrolled_at,
      (select max(progress.updated_at) from public.learning_progress progress where progress.enrollment_id = enrollment.id),
      (select max(attempt.submitted_at) from public.learning_quiz_attempts attempt where attempt.enrollment_id = enrollment.id)
    ) as last_active_at,
    (select coalesce(jsonb_agg(jsonb_build_object('lessonTitle', best.lesson_title, 'bestPercentage', best.percentage, 'passed', best.passed)
                                order by best.section_position, best.lesson_position), '[]'::jsonb)
       from (
         select distinct on (attempt.quiz_id)
                lesson.title as lesson_title, attempt.percentage, attempt.passed,
                section.position as section_position, lesson.position as lesson_position
         from public.learning_quiz_attempts attempt
         inner join public.learning_quizzes quiz on quiz.id = attempt.quiz_id
         inner join public.learning_lessons lesson on lesson.id = quiz.lesson_id
         inner join public.learning_course_sections section on section.id = lesson.section_id
         where attempt.enrollment_id = enrollment.id and attempt.status = 'completed'
         order by attempt.quiz_id, attempt.percentage desc, attempt.submitted_at desc
       ) best) as quiz_scores,
    case
      when certificate.id is null then 'none'
      when certificate.expires_at is not null and certificate.expires_at <= now() then 'expired'
      else 'issued'
    end as certificate_status
  from public.learning_enrollments enrollment
  cross join lesson_total
  inner join public.profiles profile on profile.id = enrollment.learner_id
  left join public.maritime_profiles maritime on maritime.user_id = enrollment.learner_id
  left join public.learning_certificates certificate on certificate.enrollment_id = enrollment.id
  where enrollment.course_id = $1::uuid
  order by enrollment.enrolled_at desc, enrollment.id desc
  limit 5000`

function mapLearner(row: QueryResultRow): RosterLearner {
  const total = count(row.total_lessons)
  const completed = Math.min(count(row.completed_lessons), total)
  const source = String(row.enrollment_source)
  const status = String(row.status)
  return {
    enrollmentId: String(row.enrollment_id),
    learnerId: String(row.learner_id),
    name: String(row.full_name ?? '').trim() || 'Sea N Shore member',
    slug: row.slug ? String(row.slug) : null,
    rank: roleDisplayLabel({ roleKey: row.role_key, otherText: row.role_other_text, legacyText: row.legacy_rank }),
    enrolledAt: iso(row.enrolled_at) ?? new Date(0).toISOString(),
    source: source === 'purchase' || source === 'admin' || source === 'trainer' ? source : 'free',
    status: status === 'completed' || status === 'revoked' ? status : 'active',
    accessExpiresAt: iso(row.access_expires_at),
    completedLessons: completed,
    totalLessons: total,
    progressPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
    lastActiveAt: iso(row.last_active_at) ?? iso(row.enrolled_at) ?? new Date(0).toISOString(),
    quizScores: parseJson<RosterQuizScore[]>(row.quiz_scores, []).map((score) => ({
      lessonTitle: String(score.lessonTitle ?? ''),
      bestPercentage: count(score.bestPercentage),
      passed: score.passed === true,
    })),
    certificate: row.certificate_status === 'issued' || row.certificate_status === 'expired' ? row.certificate_status : 'none',
  }
}

async function audit(query: Query, actorId: string, action: string, courseId: string, metadata: Record<string, unknown>) {
  await query(
    `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
     values ($1::uuid, $2, 'learning_course', $3, $4::jsonb)`,
    [actorId, action, courseId, JSON.stringify(metadata)],
  )
}

/** Enrolments and invitations this person added by email recently, counted from their own audit rows. */
async function assertUnderEnrolLimit(query: Query, actorId: string) {
  await query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`learning-roster-enrol:${actorId}`])
  const rows = await query(
    `select count(*) filter (where created_at > now() - interval '1 hour')::int as last_hour,
            count(*)::int as last_day
     from public.audit_events
     where actor_id = $1::uuid and action = 'learning.roster_enrolled' and created_at > now() - interval '24 hours'`,
    [actorId],
  )
  const row = rows[0] ?? {}
  if (count(row.last_hour) >= ROSTER_ENROL_LIMITS.perHour || count(row.last_day) >= ROSTER_ENROL_LIMITS.perDay) {
    throw new Error('roster_enrol_rate_limited')
  }
}

/** The member a verified email address belongs to, when exactly one does. */
async function memberByVerifiedEmail(query: Query, email: string) {
  const rows = await query(
    `select distinct account.profile_id, profile.full_name
     from public.identity_accounts account
     inner join public.profiles profile on profile.id = account.profile_id
     where account.email_verified = true and account.email = $1
     limit 2`,
    [email],
  )
  return rows.length === 1 ? { profileId: String(rows[0]!.profile_id), name: String(rows[0]!.full_name ?? '').trim() || 'This member' } : null
}

/**
 * Gives a member access as a trainer enrolment. A new enrolment is created; one that was revoked (after a refund)
 * or whose access period ended is reopened with lifetime access. An open enrolment is left exactly as it is.
 */
async function enrolMember(query: Query, input: { courseId: string; learnerId: string; enrolledBy: string | null }) {
  const rows = await query(
    `insert into public.learning_enrollments (course_id, learner_id, enrollment_source, status, enrolled_at, enrolled_by, created_at, updated_at)
     values ($1::uuid, $2::uuid, 'trainer', 'active', now(), $3::uuid, now(), now())
     on conflict (course_id, learner_id) do update
       set enrollment_source = 'trainer',
           status = case when learning_enrollments.status = 'revoked' then 'active' else learning_enrollments.status end,
           revoked_at = null,
           payment_order_id = null,
           plan_id = null,
           access_expires_at = null,
           enrolled_by = excluded.enrolled_by,
           updated_at = now()
       where learning_enrollments.status = 'revoked'
          or (learning_enrollments.access_expires_at is not null and learning_enrollments.access_expires_at <= now())
     returning id, extract(epoch from updated_at)::bigint as version`,
    [input.courseId, input.learnerId, input.enrolledBy],
  )
  const row = rows[0]
  if (!row) return null
  const enrollmentId = String(row.id)
  await notifyEnrolled(query, { learnerId: input.learnerId, courseId: input.courseId, enrollmentId, occasion: `trainer-${String(row.version)}` }, { inTransaction: true })
  return enrollmentId
}

export function createCourseRosterRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction: Transaction = input.transaction ?? (<T>(work: (query: Query) => Promise<T>) => withTransaction((client) => work(clientQuery(client))))

  async function course(access: RosterAccess) {
    return loadCourse(query, access)
  }

  async function list(access: RosterAccess): Promise<{ course: RosterCourse; learners: RosterLearner[]; invitations: RosterInvitation[] }> {
    const managed = await loadCourse(query, access)
    const [learners, invitations] = await Promise.all([
      query(ROSTER_SQL, [managed.id]),
      query(
        `select id, email, created_at, expires_at, email_status
         from public.learning_course_invitations
         where course_id = $1::uuid and status = 'pending' and expires_at > now()
         order by created_at desc
         limit 500`,
        [managed.id],
      ),
    ])
    return {
      course: managed,
      learners: learners.map(mapLearner),
      invitations: invitations.map((row) => ({
        id: String(row.id),
        email: String(row.email),
        createdAt: iso(row.created_at) ?? '',
        expiresAt: iso(row.expires_at) ?? '',
        emailStatus: row.email_status === 'sent' || row.email_status === 'failed' ? row.email_status : 'pending',
      })),
    }
  }

  /**
   * Adds one learner by email. A member (a verified email address on Sea N Shore) is enrolled now and notified; anyone
   * else gets an invitation email and is enrolled when they sign up with that address.
   */
  async function enrolByEmail(access: RosterAccess, email: string): Promise<RosterEnrolOutcome> {
    return transaction(async (tx) => {
      const managed = await loadCourse(tx, access, true)
      if (!managed.openToNewLearners) throw new Error('course_not_enrollable')
      await assertUnderEnrolLimit(tx, access.actorId)

      const member = await memberByVerifiedEmail(tx, email)
      let outcome: RosterEnrolOutcome
      if (member) {
        const enrollmentId = await enrolMember(tx, { courseId: managed.id, learnerId: member.profileId, enrolledBy: access.actorId })
        outcome = enrollmentId ? { kind: 'enrolled', name: member.name } : { kind: 'already_enrolled', name: member.name }
      } else {
        const rows = await tx(
          `insert into public.learning_course_invitations (course_id, email, invited_by)
           values ($1::uuid, $2, $3::uuid)
           on conflict (course_id, email) where status = 'pending' do nothing
           returning id`,
          [managed.id, email, access.actorId],
        )
        outcome = rows[0] ? { kind: 'invited' } : { kind: 'already_invited' }
      }
      await audit(tx, access.actorId, 'learning.roster_enrolled', managed.id, { result: outcome.kind })
      return outcome
    })
  }

  async function cancelInvitation(access: RosterAccess, invitationId: string) {
    return transaction(async (tx) => {
      const managed = await loadCourse(tx, access)
      const rows = await tx(
        `update public.learning_course_invitations
         set status = 'cancelled', cancelled_at = now(), updated_at = now()
         where id = $1::uuid and course_id = $2::uuid and status = 'pending'
         returning id`,
        [invitationId, managed.id],
      )
      if (!rows[0]) throw new Error('invitation_not_found')
      await audit(tx, access.actorId, 'learning.roster_invitation_cancelled', managed.id, {})
    })
  }

  /** The roster for download; the export itself is audited (who, which course, how many rows). */
  async function exportRoster(access: RosterAccess) {
    return transaction(async (tx) => {
      const managed = await loadCourse(tx, access)
      const learners = (await tx(ROSTER_SQL, [managed.id])).map(mapLearner)
      await audit(tx, access.actorId, 'learning.roster_exported', managed.id, { rows: learners.length })
      return { course: managed, learners }
    })
  }

  return { course, list, enrolByEmail, cancelInvitation, exportRoster }
}

export const courseRosterRepository = createCourseRosterRepository()

const CLAIMABLE_SQL = `
  select invitation.id, invitation.course_id, invitation.invited_by, account.profile_id
  from public.learning_course_invitations invitation
  inner join public.identity_accounts account
    on account.email = invitation.email and account.email_verified = true
  inner join public.learning_courses course on course.id = invitation.course_id
  left join public.learning_mentors mentor on mentor.id = course.mentor_id
  left join public.learning_mentor_applications application
    on application.id = mentor.application_id and application.user_id = mentor.user_id
  left join public.companies company on company.id = course.company_id
  where invitation.status = 'pending'
    and invitation.expires_at > now()
    and ${courseOpenToNewLearnersSql('course', 'mentor', 'application', 'company')}`

/**
 * Turns pending invitations into enrolments once the invited address is a verified member's email: for one member
 * (My Learning, right after sign-up) or for anyone (the outbox worker sweep). Safe to run repeatedly.
 */
export function createCourseInvitationClaims(input: { transaction?: Transaction } = {}) {
  const transaction: Transaction = input.transaction ?? (<T>(work: (query: Query) => Promise<T>) => withTransaction((client) => work(clientQuery(client))))

  async function claim(profileId: string | null, limit: number) {
    return transaction(async (tx) => {
      const rows = await tx(
        `${CLAIMABLE_SQL} ${profileId ? 'and account.profile_id = $2::uuid' : ''}
         order by invitation.created_at asc
         limit $1
         for update of invitation skip locked`,
        profileId ? [limit, profileId] : [limit],
      )
      let claimed = 0
      const seen = new Set<string>()
      for (const row of rows) {
        const invitationId = String(row.id)
        if (seen.has(invitationId)) continue
        seen.add(invitationId)
        const learnerId = String(row.profile_id)
        const enrollmentId = await enrolMember(tx, { courseId: String(row.course_id), learnerId, enrolledBy: row.invited_by ? String(row.invited_by) : null })
        const existing = enrollmentId ?? String((await tx(
          `select id from public.learning_enrollments where course_id = $1::uuid and learner_id = $2::uuid`,
          [row.course_id, learnerId],
        ))[0]?.id ?? '')
        await tx(
          `update public.learning_course_invitations
           set status = 'accepted', accepted_profile_id = $2::uuid, enrollment_id = nullif($3, '')::uuid, accepted_at = now(), updated_at = now()
           where id = $1::uuid`,
          [invitationId, learnerId, existing],
        )
        claimed += 1
      }
      return claimed
    })
  }

  return {
    forProfile: (profileId: string) => claim(profileId, 20),
    sweep: (limit = 50) => claim(null, Math.max(1, Math.min(200, Math.floor(limit)))),
  }
}

export const courseInvitationClaims = createCourseInvitationClaims()
