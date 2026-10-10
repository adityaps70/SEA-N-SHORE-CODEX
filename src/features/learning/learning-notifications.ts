import type { QueryResultRow } from 'pg'
import { learnerCourseAccessSql } from './course-publication'

/**
 * Learning notifications (learning round A, A6): an in-app notification and, unless the
 * recipient turned learning emails off, one email from the learning email queue.
 *
 * Every notification has a dedupe key, so a retried action, a repeated sweep or a redelivered
 * request never notifies twice. Writers run inside the caller's transaction behind a savepoint:
 * a notification that cannot be written is logged (kind and error code only, never names or
 * emails) and dropped, and the enrolment, grade, certificate or review it belongs to still
 * commits.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export const LEARNING_NOTIFICATION_KINDS = [
  'enrolled',
  'lessons_released',
  'assignment_graded',
  'certificate_issued',
  'course_approved',
  'course_changes_requested',
  'submissions_to_grade',
  'quiz_graded',
  'certificate_expiring',
] as const
export type LearningNotificationKind = (typeof LEARNING_NOTIFICATION_KINDS)[number]

/** What a learning notification says; stored on the notification (details) and the email (payload). */
export type LearningNotificationDetails = {
  courseTitle: string
  courseSlug: string
  /** The live course in Studio, for trainer notifications (a draft revision's own id otherwise). */
  studioCourseId?: string
  lessonId?: string | null
  lessonTitle?: string | null
  /** lessons_released / submissions_to_grade: how many. */
  count?: number
  /** submissions_to_grade (round C): how many are assignments and how many are quiz attempts with written answers. */
  assignmentCount?: number
  quizAnswerCount?: number
  percentage?: number | null
  passed?: boolean | null
  verificationCode?: string | null
  /** course_approved / course_changes_requested for changes to a published course. */
  revision?: boolean
  /** certificate_expiring: when it expires, and how many days were left when the reminder went out. */
  expiresAt?: string | null
  daysLeft?: number
}

export type LearningNotificationInput = {
  recipientId: string
  kind: LearningNotificationKind
  courseId: string
  lessonId?: string | null
  details: LearningNotificationDetails
  /** In-app dedupe key (unique per recipient). */
  dedupeKey: string
  /** Email dedupe key (unique overall); defaults to `<recipient>:<dedupeKey>`. */
  emailDedupeKey?: string
  /** Digests: a repeat refreshes the notification (new count, unread again) instead of being ignored. */
  refresh?: boolean
}

function errorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return error instanceof Error ? error.message.slice(0, 80) : 'unknown_error'
}

/**
 * Runs a notification's whole unit of work (lookups included) so that it can never break the
 * caller: inside a transaction behind a savepoint (a failed statement would otherwise abort the
 * caller's transaction and silently roll back its commit), outside one as plain statements.
 * `inTransaction` must say whether `query` runs inside a transaction. Never throws.
 */
async function guarded<T>(query: Query, kind: string, inTransaction: boolean, work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    if (inTransaction) await query('savepoint learning_notification')
    const result = await work()
    if (inTransaction) await query('release savepoint learning_notification')
    return result
  } catch (error) {
    console.error('[learning_notification_error]', { kind, code: errorCode(error) })
    if (inTransaction) {
      try {
        await query('rollback to savepoint learning_notification')
        await query('release savepoint learning_notification')
      } catch {
        // The caller's transaction reports its own failure, if any.
      }
    }
    return fallback
  }
}

/** Writes one learning notification (in-app + queued email). Run it inside `guarded`. */
async function writeNotification(query: Query, input: LearningNotificationInput) {
  const details = JSON.stringify(input.details)
  await query(
    `insert into public.notifications (recipient_id, actor_id, notification_type, course_id, lesson_id, details, dedupe_key)
     values ($1, null, $2::public.network_notification_type, $3, $4, $5::jsonb, $6)
     on conflict (recipient_id, dedupe_key) where dedupe_key is not null
     ${input.refresh ? 'do update set details = excluded.details, created_at = now(), read_at = null' : 'do nothing'}`,
    [input.recipientId, `learning_${input.kind}`, input.courseId, input.lessonId ?? null, details, input.dedupeKey],
  )
  await query(
    `insert into public.learning_notification_emails (dedupe_key, recipient_id, kind, payload)
     values ($1, $2, $3, jsonb_build_object('courseId', $4::uuid, 'details', $5::jsonb))
     on conflict (dedupe_key) do nothing`,
    [input.emailDedupeKey ?? `${input.recipientId}:${input.dedupeKey}`, input.recipientId, input.kind, input.courseId, details],
  )
  return true
}

/** One learning notification on its own, guarded (see `guarded`). Never throws. */
export async function recordLearningNotification(query: Query, input: LearningNotificationInput, options: { inTransaction: boolean }) {
  return guarded(query, input.kind, options.inTransaction, () => writeNotification(query, input), false)
}

/** People who manage a course in Studio: its active trainer, or its organization's learning managers. */
export async function courseManagerIds(query: Query, courseId: string) {
  const rows = await query(
    `select mentor.user_id as profile_id
     from public.learning_courses course
     inner join public.learning_mentors mentor on mentor.id = course.mentor_id and mentor.status = 'active'
     where course.id = $1
     union
     select member.user_id as profile_id
     from public.learning_courses course
     inner join public.company_members member on member.company_id = course.company_id
     where course.id = $1
       and member.approved_at is not null
       and member.role::text in ('owner', 'administrator', 'lms_manager')`,
    [courseId],
  )
  return rows.map((row) => String(row.profile_id))
}

type CourseRow = QueryResultRow & { id: string; title: string; slug: string; revision_of_course_id: string | null }

async function loadCourse(query: Query, courseId: string) {
  const rows = await query(
    `select id, title, slug, revision_of_course_id from public.learning_courses where id = $1`,
    [courseId],
  ) as CourseRow[]
  return rows[0] ?? null
}

/** A learner enrolled (free, or a confirmed purchase). `occasion` separates a repurchase after a refund. */
export async function notifyEnrolled(query: Query, input: { learnerId: string; courseId: string; enrollmentId: string; occasion?: string }, options: { inTransaction: boolean }) {
  return guarded(query, 'enrolled', options.inTransaction, async () => {
    const course = await loadCourse(query, input.courseId)
    if (!course) return false
    return writeNotification(query, {
      recipientId: input.learnerId,
      kind: 'enrolled',
      courseId: course.id,
      details: { courseTitle: course.title, courseSlug: course.slug },
      dedupeKey: `learning_enrolled:${input.enrollmentId}${input.occasion ? `:${input.occasion}` : ''}`,
    })
  }, false)
}

/** A trainer graded an assignment attempt. */
export async function notifyAssignmentGraded(query: Query, input: { attemptId: string }) {
  return guarded(query, 'assignment_graded', true, async () => {
    const rows = await query(
      `select attempt.learner_id, attempt.percentage, attempt.passed, lesson.id as lesson_id, lesson.title as lesson_title,
              course.id as course_id, course.title as course_title, course.slug as course_slug
       from public.learning_assignment_attempts attempt
       inner join public.learning_lessons lesson on lesson.id = attempt.lesson_id
       inner join public.learning_course_sections section on section.id = lesson.section_id
       inner join public.learning_courses course on course.id = section.course_id
       where attempt.id = $1 and attempt.status = 'graded'`,
      [input.attemptId],
    )
    const row = rows[0]
    if (!row) return false
    return writeNotification(query, {
      recipientId: String(row.learner_id),
      kind: 'assignment_graded',
      courseId: String(row.course_id),
      lessonId: String(row.lesson_id),
      details: {
        courseTitle: String(row.course_title),
        courseSlug: String(row.course_slug),
        lessonId: String(row.lesson_id),
        lessonTitle: String(row.lesson_title),
        percentage: row.percentage === null ? null : Number(row.percentage),
        passed: row.passed === null ? null : Boolean(row.passed),
      },
      dedupeKey: `learning_assignment_graded:${input.attemptId}`,
    })
  }, false)
}

/** A trainer graded the written answers of a quiz attempt. */
export async function notifyQuizGraded(query: Query, input: { attemptId: string }) {
  return guarded(query, 'quiz_graded', true, async () => {
    const rows = await query(
      `select attempt.learner_id, attempt.percentage, attempt.passed, lesson.id as lesson_id, lesson.title as lesson_title,
              course.id as course_id, course.title as course_title, course.slug as course_slug
       from public.learning_quiz_attempts attempt
       inner join public.learning_quizzes quiz on quiz.id = attempt.quiz_id
       inner join public.learning_lessons lesson on lesson.id = quiz.lesson_id
       inner join public.learning_course_sections section on section.id = lesson.section_id
       inner join public.learning_courses course on course.id = section.course_id
       where attempt.id = $1 and attempt.status = 'completed'`,
      [input.attemptId],
    )
    const row = rows[0]
    if (!row) return false
    return writeNotification(query, {
      recipientId: String(row.learner_id),
      kind: 'quiz_graded',
      courseId: String(row.course_id),
      lessonId: String(row.lesson_id),
      details: {
        courseTitle: String(row.course_title),
        courseSlug: String(row.course_slug),
        lessonId: String(row.lesson_id),
        lessonTitle: String(row.lesson_title),
        percentage: Number(row.percentage),
        passed: Boolean(row.passed),
      },
      dedupeKey: `learning_quiz_graded:${input.attemptId}`,
    })
  }, false)
}

/** A certificate was issued for the first time (never for one that already existed). */
export async function notifyCertificateIssued(query: Query, input: {
  learnerId: string
  courseId: string
  enrollmentId: string
  courseTitle: string
  verificationCode: string
}) {
  return guarded(query, 'certificate_issued', true, async () => {
    const course = await loadCourse(query, input.courseId)
    return writeNotification(query, {
      recipientId: input.learnerId,
      kind: 'certificate_issued',
      courseId: input.courseId,
      details: { courseTitle: input.courseTitle, courseSlug: course?.slug ?? '', verificationCode: input.verificationCode },
      dedupeKey: `learning_certificate_issued:${input.enrollmentId}`,
    })
  }, false)
}

/**
 * Sea N Shore approved a course (or changes to a published course), or asked for changes.
 * `reviewedCourseId` is the course or draft revision that was reviewed; `liveCourseId` is the
 * course learners see (the same course unless a revision was approved).
 */
export async function notifyCourseReviewed(query: Query, input: {
  reviewedCourseId: string
  liveCourseId: string
  decision: 'approved' | 'changes_requested'
}) {
  const kind = input.decision === 'approved' ? 'course_approved' : 'course_changes_requested'
  return guarded(query, kind, true, async () => {
    const reviewed = await loadCourse(query, input.reviewedCourseId)
    const live = input.liveCourseId === input.reviewedCourseId ? reviewed : await loadCourse(query, input.liveCourseId)
    if (!reviewed || !live) return false
    const revision = Boolean(reviewed.revision_of_course_id)
    // The trainer works on the course itself, or on the open draft revision while it is sent back.
    const studioCourseId = input.decision === 'approved' ? live.id : reviewed.id
    const submissions = await query(
      `select id from public.learning_course_submissions where course_id = $1 order by submitted_at desc, id desc limit 1`,
      [input.reviewedCourseId],
    )
    const occasion = submissions[0] ? String(submissions[0].id) : new Date().toISOString().slice(0, 10)
    const managers = await courseManagerIds(query, live.id)
    for (const managerId of managers) {
      await writeNotification(query, {
        recipientId: managerId,
        kind,
        courseId: live.id,
        details: { courseTitle: live.title, courseSlug: live.slug, studioCourseId, revision },
        dedupeKey: `learning_${kind}:${input.reviewedCourseId}:${occasion}`,
      })
    }
    return managers.length > 0
  }, false)
}

function dayKey(now: Date) {
  return now.toISOString().slice(0, 10)
}

/** Released scheduled/drip materials (learner digest) are noticed for this long after release. */
const RELEASE_LOOKBACK_HOURS = 26

type ReleaseCandidateRow = QueryResultRow & {
  enrollment_id: string
  learner_id: string
  course_id: string
  course_title: string
  course_slug: string
  lesson_id: string
  lesson_title: string
  released_at: string | Date
}

/**
 * Hourly: materials that became available to an enrolled learner (a scheduled date passed, or a
 * drip delay after enrolment ran out) since the last sweep. One notification per enrolment per day
 * lists them; each (enrolment, material) is noticed once (learning_release_notices). Materials
 * released before the learner enrolled, or long ago, are never announced.
 */
export async function sweepReleasedLessons(transaction: <T>(work: (query: Query) => Promise<T>) => Promise<T>, input: { now?: Date; limit?: number } = {}) {
  const now = input.now ?? new Date()
  return transaction(async (query) => {
    const candidates = await query(
      `with released as (
         select enrollment.id as enrollment_id, enrollment.learner_id, enrollment.enrolled_at,
                course.id as course_id, course.title as course_title, course.slug as course_slug,
                lesson.id as lesson_id, lesson.title as lesson_title, section.position as section_position, lesson.position as lesson_position,
                case when lesson.release_mode = 'scheduled' then lesson.release_at
                     else enrollment.enrolled_at + make_interval(days => lesson.drip_delay_days) end as released_at
         from public.learning_enrollments enrollment
         inner join public.learning_courses course on course.id = enrollment.course_id
         left join public.learning_mentors mentor on mentor.id = course.mentor_id
         left join public.learning_mentor_applications application
           on application.id = mentor.application_id and application.user_id = mentor.user_id
         left join public.companies company on company.id = course.company_id
         inner join public.learning_course_sections section on section.course_id = course.id and section.removed_at is null
         inner join public.learning_lessons lesson on lesson.section_id = section.id
         where enrollment.status = 'active'
           and course.revision_of_course_id is null
           and course.removed_at is null
           and ${learnerCourseAccessSql()}
           and lesson.is_published = true
           and lesson.removed_at is null
           and ((lesson.release_mode = 'scheduled' and lesson.release_at is not null)
             or (lesson.release_mode = 'drip' and coalesce(lesson.drip_delay_days, 0) > 0))
       )
       select released.*
       from released
       where released.released_at <= $1::timestamptz
         and released.released_at > $1::timestamptz - make_interval(hours => $2::int)
         and released.released_at > released.enrolled_at
         and not exists (
           select 1 from public.learning_release_notices notice
           where notice.enrollment_id = released.enrollment_id and notice.lesson_id = released.lesson_id
         )
       order by released.enrollment_id, released.section_position, released.lesson_position, released.lesson_id
       limit $3`,
      [now.toISOString(), RELEASE_LOOKBACK_HOURS, input.limit ?? 2000],
    ) as ReleaseCandidateRow[]

    const byEnrollment = new Map<string, ReleaseCandidateRow[]>()
    for (const row of candidates) {
      const noticed = await query(
        `insert into public.learning_release_notices (enrollment_id, lesson_id, released_at, noticed_at)
         values ($1, $2, $3, $4)
         on conflict (enrollment_id, lesson_id) do nothing
         returning lesson_id`,
        [row.enrollment_id, row.lesson_id, row.released_at, now.toISOString()],
      )
      if (!noticed[0]) continue
      const list = byEnrollment.get(row.enrollment_id) ?? []
      list.push(row)
      byEnrollment.set(row.enrollment_id, list)
    }

    let notified = 0
    const day = dayKey(now)
    for (const [enrollmentId, rows] of byEnrollment) {
      const first = rows[0]!
      // Everything noticed for this enrolment today, so a second sweep the same day updates the count.
      const today = await query(
        `select count(*)::int as count from public.learning_release_notices
         where enrollment_id = $1 and noticed_at >= $2::date and noticed_at < $2::date + 1`,
        [enrollmentId, day],
      )
      const count = Math.max(Number(today[0]?.count ?? rows.length), rows.length)
      const ok = await recordLearningNotification(query, {
        recipientId: first.learner_id,
        kind: 'lessons_released',
        courseId: first.course_id,
        lessonId: first.lesson_id,
        details: {
          courseTitle: first.course_title,
          courseSlug: first.course_slug,
          lessonId: first.lesson_id,
          lessonTitle: first.lesson_title,
          count,
        },
        dedupeKey: `learning_lessons_released:${enrollmentId}:${day}`,
        refresh: true,
      }, { inTransaction: true })
      if (ok) notified += 1
    }
    return { noticed: candidates.length, notified }
  })
}

type SubmissionRow = QueryResultRow & { attempt_id: string; course_id: string }

/**
 * Hourly: new submissions waiting to be graded — assignment submissions and quiz attempts with written answers
 * awaiting grading (round C) — as one notification per course manager per course per day ("3 submissions to grade
 * in …"). Each submission is counted into a digest once (trainer_digest_at); the count shown is everything still
 * waiting in that course.
 */
export async function sweepSubmissionsToGrade(transaction: <T>(work: (query: Query) => Promise<T>) => Promise<T>, input: { now?: Date; limit?: number } = {}) {
  const now = input.now ?? new Date()
  const limit = input.limit ?? 1000
  return transaction(async (query) => {
    const assignments = await query(
      `select attempt.id as attempt_id, section.course_id
       from public.learning_assignment_attempts attempt
       inner join public.learning_lessons lesson on lesson.id = attempt.lesson_id
       inner join public.learning_course_sections section on section.id = lesson.section_id
       where attempt.status = 'submitted'
         and attempt.trainer_digest_at is null
       order by attempt.submitted_at asc, attempt.id asc
       limit $1
       for update of attempt skip locked`,
      [limit],
    ) as SubmissionRow[]
    const quizzes = await query(
      `select attempt.id as attempt_id, section.course_id
       from public.learning_quiz_attempts attempt
       inner join public.learning_quizzes quiz on quiz.id = attempt.quiz_id
       inner join public.learning_lessons lesson on lesson.id = quiz.lesson_id
       inner join public.learning_course_sections section on section.id = lesson.section_id
       where attempt.status = 'awaiting_grading'
         and attempt.trainer_digest_at is null
       order by attempt.submitted_at asc, attempt.id asc
       limit $1
       for update of attempt skip locked`,
      [limit],
    ) as SubmissionRow[]
    if (!assignments.length && !quizzes.length) return { submissions: 0, notified: 0 }

    if (assignments.length) {
      await query(
        `update public.learning_assignment_attempts set trainer_digest_at = $2::timestamptz where id = any($1::uuid[])`,
        [assignments.map((row) => row.attempt_id), now.toISOString()],
      )
    }
    if (quizzes.length) {
      await query(
        `update public.learning_quiz_attempts set trainer_digest_at = $2::timestamptz where id = any($1::uuid[])`,
        [quizzes.map((row) => row.attempt_id), now.toISOString()],
      )
    }

    let notified = 0
    const day = dayKey(now)
    for (const courseId of new Set([...assignments, ...quizzes].map((row) => row.course_id))) {
      const course = await loadCourse(query, courseId)
      if (!course) continue
      const waiting = await query(
        `select
           (select count(*)::int
            from public.learning_assignment_attempts attempt
            inner join public.learning_lessons lesson on lesson.id = attempt.lesson_id
            inner join public.learning_course_sections section on section.id = lesson.section_id
            where section.course_id = $1 and attempt.status = 'submitted') as assignments,
           (select count(*)::int
            from public.learning_quiz_attempts attempt
            inner join public.learning_quizzes quiz on quiz.id = attempt.quiz_id
            inner join public.learning_lessons lesson on lesson.id = quiz.lesson_id
            inner join public.learning_course_sections section on section.id = lesson.section_id
            where section.course_id = $1 and attempt.status = 'awaiting_grading') as quiz_answers`,
        [courseId],
      )
      const assignmentCount = Number(waiting[0]?.assignments ?? 0)
      const quizAnswerCount = Number(waiting[0]?.quiz_answers ?? 0)
      const count = assignmentCount + quizAnswerCount
      if (!count) continue
      for (const managerId of await courseManagerIds(query, courseId)) {
        const ok = await recordLearningNotification(query, {
          recipientId: managerId,
          kind: 'submissions_to_grade',
          courseId,
          details: { courseTitle: course.title, courseSlug: course.slug, studioCourseId: course.id, count, assignmentCount, quizAnswerCount },
          dedupeKey: `learning_submissions_to_grade:${courseId}:${day}`,
          refresh: true,
        }, { inTransaction: true })
        if (ok) notified += 1
      }
    }
    return { submissions: assignments.length + quizzes.length, notified }
  })
}

type ExpiringCertificateRow = QueryResultRow & {
  id: string
  learner_id: string
  course_id: string
  course_title: string
  course_slug: string | null
  verification_code: string
  expires_at: string | Date
}

/**
 * Hourly (learning round B, B4): a reminder 30 days and again 7 days before a certificate expires, in-app and by
 * Learning email (members can turn Learning emails off). Each reminder is sent once (its dedupe key); a certificate
 * first seen inside the last 7 days gets only the 7-day reminder.
 */
export async function sweepExpiringCertificates(transaction: <T>(work: (query: Query) => Promise<T>) => Promise<T>, input: { now?: Date; limit?: number } = {}) {
  const now = input.now ?? new Date()
  return transaction(async (query) => {
    const rows = await query(
      `select certificate.id, certificate.learner_id, certificate.course_id, certificate.course_title,
              course.slug as course_slug, certificate.verification_code, certificate.expires_at
       from public.learning_certificates certificate
       left join public.learning_courses course on course.id = certificate.course_id
       where certificate.expires_at is not null
         and certificate.expires_at > $1::timestamptz
         and certificate.expires_at <= $1::timestamptz + interval '30 days'
       order by certificate.expires_at asc, certificate.id asc
       limit $2`,
      [now.toISOString(), input.limit ?? 1000],
    ) as ExpiringCertificateRow[]
    let notified = 0
    for (const row of rows) {
      const expiresAt = new Date(row.expires_at)
      const daysLeft = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      const stage = daysLeft <= 7 ? 7 : 30
      const ok = await recordLearningNotification(query, {
        recipientId: row.learner_id,
        kind: 'certificate_expiring',
        courseId: row.course_id,
        details: {
          courseTitle: row.course_title,
          courseSlug: row.course_slug ?? '',
          verificationCode: row.verification_code,
          expiresAt: expiresAt.toISOString(),
          daysLeft: stage,
        },
        dedupeKey: `learning_certificate_expiring:${row.id}:${stage}`,
      }, { inTransaction: true })
      if (ok) notified += 1
    }
    return { expiring: rows.length, notified }
  })
}
