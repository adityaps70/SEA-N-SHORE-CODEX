import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'

export type AssignmentQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type AssignmentTransaction = <T>(work: (query: AssignmentQuery) => Promise<T>) => Promise<T>

type AssignmentAccessRow = QueryResultRow & {
  assignment_id: string
  enrollment_id: string
  lesson_id: string
  max_attempts: string | number | null
  attempts_used: string | number
  pending_attempt_id?: string | null
  completed?: boolean | null
}

type AttemptRow = QueryResultRow & {
  id: string
  attempt_number: string | number
  status: string
  submitted_at: string | Date
  response_text?: string | null
  score_points?: string | number | null
  percentage?: string | number | null
  passed?: boolean | null
  feedback?: string | null
  graded_at?: string | Date | null
}

type AssignmentStateAccessRow = QueryResultRow & {
  assignment_id: string
  enrollment_id: string
  max_points: string | number
  passing_percentage: string | number
  max_attempts: string | number | null
  completed: boolean | null
}

export type LearnerAssignmentAttempt = {
  id: string
  attemptNumber: number
  status: 'submitted' | 'graded'
  submittedAt: string
  responseText: string | null
  scorePoints: number | null
  percentage: number | null
  passed: boolean | null
  feedback: string | null
  gradedAt: string | null
}

export type LearnerAssignmentState = {
  completed: boolean
  maxPoints: number
  passingPercentage: number
  maxAttempts: number | null
  attemptsUsed: number
  attemptsRemaining: number | null
  reviewPending: boolean
  latestAttempt: LearnerAssignmentAttempt | null
  attempts: LearnerAssignmentAttempt[]
}

function runtimeTransaction<T>(work: (query: AssignmentQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function iso(value: string | Date | null | undefined) {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

function asStatus(value: string): 'submitted' | 'graded' {
  if (value === 'submitted' || value === 'graded') return value
  throw new Error('assignment_attempt_status_invalid')
}

function asSubmittedStatus(value: string): 'submitted' {
  if (value === 'submitted') return value
  throw new Error('assignment_attempt_status_invalid')
}

function mapAttempt(row: AttemptRow): LearnerAssignmentAttempt {
  return {
    id: row.id,
    attemptNumber: Number(row.attempt_number),
    status: asStatus(row.status),
    submittedAt: iso(row.submitted_at)!,
    responseText: row.response_text ?? null,
    scorePoints: row.score_points === null || row.score_points === undefined ? null : Number(row.score_points),
    percentage: row.percentage === null || row.percentage === undefined ? null : Number(row.percentage),
    passed: row.passed ?? null,
    feedback: row.feedback ?? null,
    gradedAt: iso(row.graded_at),
  }
}

export function createLearnerAssignmentRepository(input: {
  query?: AssignmentQuery
  transaction?: AssignmentTransaction
} = {}) {
  const queryRows: AssignmentQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function getState(learnerId: string, slug: string, lessonId: string): Promise<LearnerAssignmentState | null> {
    const accessRows = await queryRows(
      `select
         assignment.id as assignment_id,
         enrollment.id as enrollment_id,
         assignment.max_points,
         assignment.passing_percentage,
         lesson.max_attempts,
         coalesce(progress.completed, false) as completed
       from public.learning_enrollments enrollment
       inner join public.learning_courses course
         on course.id = enrollment.course_id
        and course.status = 'published'
       inner join public.learning_mentors mentor
         on mentor.id = course.mentor_id
        and mentor.status = 'active'
       inner join public.learning_mentor_applications application
         on application.id = mentor.application_id
        and application.user_id = mentor.user_id
        and application.status = 'approved'
       inner join public.learning_course_sections section on section.course_id = course.id
       inner join public.learning_lessons lesson
         on lesson.section_id = section.id
        and lesson.lesson_type = 'assignment'
        and lesson.is_published = true
       inner join public.learning_assignments assignment on assignment.lesson_id = lesson.id
       left join public.learning_progress progress
         on progress.enrollment_id = enrollment.id
        and progress.lesson_id = lesson.id
       where enrollment.learner_id = $1
         and enrollment.status in ('active', 'completed')
         and course.slug = $2
         and lesson.id = $3
       limit 1`,
      [learnerId, slug, lessonId],
    ) as AssignmentStateAccessRow[]
    const access = accessRows[0]
    if (!access) return null

    const attemptRows = await queryRows(
      `select id, attempt_number, status, submitted_at, response_text,
              score_points, percentage, passed, feedback, graded_at
       from public.learning_assignment_attempts
       where enrollment_id = $1
         and lesson_id = $2
         and learner_id = $3
       order by attempt_number desc, id desc`,
      [access.enrollment_id, lessonId, learnerId],
    ) as AttemptRow[]
    const attempts = attemptRows.map(mapAttempt)
    const maxAttempts = access.max_attempts === null ? null : Number(access.max_attempts)
    const attemptsUsed = attempts.length

    return {
      completed: access.completed ?? false,
      maxPoints: Number(access.max_points),
      passingPercentage: Number(access.passing_percentage),
      maxAttempts,
      attemptsUsed,
      attemptsRemaining: maxAttempts === null ? null : Math.max(0, maxAttempts - attemptsUsed),
      reviewPending: attempts.some((attempt) => attempt.status === 'submitted'),
      latestAttempt: attempts[0] ?? null,
      attempts,
    }
  }

  async function submit(
    learnerId: string,
    slug: string,
    lessonId: string,
    submission: { responseText: string | null; attachmentPath: string | null },
  ) {
    if (!submission.responseText?.trim() && !submission.attachmentPath?.trim()) {
      throw new Error('assignment_submission_empty')
    }

    return transaction(async (query) => {
      const accessRows = await query(
        `select
           assignment.id as assignment_id,
           enrollment.id as enrollment_id,
           lesson.id as lesson_id,
           lesson.max_attempts,
           coalesce(progress.completed, false) as completed,
           (select count(*)::bigint
              from public.learning_assignment_attempts counted
             where counted.enrollment_id = enrollment.id
               and counted.lesson_id = lesson.id) as attempts_used,
           (select pending.id
              from public.learning_assignment_attempts pending
             where pending.enrollment_id = enrollment.id
               and pending.lesson_id = lesson.id
               and pending.status = 'submitted'
             order by pending.attempt_number desc, pending.id desc
             limit 1) as pending_attempt_id
         from public.learning_enrollments enrollment
         inner join public.learning_courses course
           on course.id = enrollment.course_id
          and course.status = 'published'
         inner join public.learning_mentors mentor
           on mentor.id = course.mentor_id
          and mentor.status = 'active'
         inner join public.learning_mentor_applications application
           on application.id = mentor.application_id
          and application.user_id = mentor.user_id
          and application.status = 'approved'
         inner join public.learning_course_sections section on section.course_id = course.id
         inner join public.learning_lessons lesson
           on lesson.section_id = section.id
          and lesson.lesson_type = 'assignment'
          and lesson.is_published = true
         inner join public.learning_assignments assignment on assignment.lesson_id = lesson.id
         left join public.learning_progress progress
           on progress.enrollment_id = enrollment.id
          and progress.lesson_id = lesson.id
         left join public.learning_progress prerequisite_progress
           on prerequisite_progress.enrollment_id = enrollment.id
          and prerequisite_progress.lesson_id = lesson.prerequisite_lesson_id
         where enrollment.learner_id = $1
           and enrollment.status in ('active', 'completed')
           and course.slug = $2
           and lesson.id = $3
           and (
             lesson.release_mode = 'immediate'
             or (lesson.release_mode = 'scheduled' and lesson.release_at <= now())
             or (lesson.release_mode = 'drip' and enrollment.enrolled_at + make_interval(days => lesson.drip_delay_days) <= now())
           )
           and (lesson.prerequisite_lesson_id is null or prerequisite_progress.completed = true)
           and (
             course.navigation_mode = 'free'
             or lesson.prerequisite_lesson_id is not null
             or not exists (
               select 1
               from public.learning_course_sections previous_section
               inner join public.learning_lessons previous_lesson
                 on previous_lesson.section_id = previous_section.id
                and previous_lesson.is_published = true
               left join public.learning_progress previous_progress
                 on previous_progress.enrollment_id = enrollment.id
                and previous_progress.lesson_id = previous_lesson.id
               where previous_section.course_id = course.id
                 and (
                   previous_section.position < section.position
                   or (previous_section.position = section.position and previous_lesson.position < lesson.position)
                 )
                 and coalesce(previous_progress.completed, false) = false
             )
           )
         for update of enrollment, lesson`,
        [learnerId, slug, lessonId],
      ) as AssignmentAccessRow[]

      const access = accessRows[0]
      if (!access) throw new Error('assignment_not_accessible')
      if (access.completed) throw new Error('assignment_already_completed')
      if (access.pending_attempt_id) throw new Error('assignment_review_pending')
      const attemptsUsed = Number(access.attempts_used ?? 0)
      const maxAttempts = access.max_attempts === null ? null : Number(access.max_attempts)
      if (maxAttempts !== null && attemptsUsed >= maxAttempts) throw new Error('learning_attempt_limit_reached')

      const attemptNumber = attemptsUsed + 1
      const inserted = await query(
        `insert into public.learning_assignment_attempts (
           assignment_id, lesson_id, enrollment_id, learner_id, attempt_number,
           response_text, attachment_path, status, submitted_at
         ) values ($1, $2, $3, $4, $5, $6, $7, 'submitted', now())
         returning id, attempt_number, status, submitted_at`,
        [
          access.assignment_id,
          access.lesson_id,
          access.enrollment_id,
          learnerId,
          attemptNumber,
          submission.responseText?.trim() || null,
          submission.attachmentPath?.trim() || null,
        ],
      ) as AttemptRow[]
      const attempt = inserted[0]
      if (!attempt) throw new Error('assignment_submit_failed')

      await query(
        `insert into public.learning_progress (
           enrollment_id, lesson_id, first_started_at, viewed_at, attempts_used, updated_at
         ) values ($1, $2, now(), now(), $3, now())
         on conflict (enrollment_id, lesson_id) do update
         set first_started_at = coalesce(public.learning_progress.first_started_at, excluded.first_started_at),
             viewed_at = coalesce(public.learning_progress.viewed_at, excluded.viewed_at),
             attempts_used = greatest(public.learning_progress.attempts_used, excluded.attempts_used),
             updated_at = now()`,
        [access.enrollment_id, access.lesson_id, attemptNumber],
      )

      return {
        attemptId: attempt.id,
        attemptNumber: Number(attempt.attempt_number),
        status: asSubmittedStatus(attempt.status),
        submittedAt: iso(attempt.submitted_at)!,
        completed: false as const,
      }
    })
  }

  return { getState, submit }
}

export const learnerAssignmentRepository = createLearnerAssignmentRepository()
