import type { QueryResultRow } from 'pg'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'

export type AssignmentQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type AssignmentTransaction = <T>(work: (query: AssignmentQuery) => Promise<T>) => Promise<T>

type AssignmentAccessRow = QueryResultRow & {
  assignment_id: string
  enrollment_id: string
  lesson_id: string
  max_attempts: string | number | null
  attempts_used: string | number
}

type AttemptRow = QueryResultRow & { id: string; attempt_number: string | number }

function runtimeTransaction<T>(work: (query: AssignmentQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

export function createLearnerAssignmentRepository(input: { transaction?: AssignmentTransaction } = {}) {
  const transaction = input.transaction ?? runtimeTransaction

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
           count(attempt.id)::bigint as attempts_used
         from public.learning_enrollments enrollment
         inner join public.learning_courses course
           on course.id = enrollment.course_id
          and course.status = 'published'
         inner join public.learning_mentors mentor
           on mentor.id = course.mentor_id
          and mentor.status = 'active'
         inner join public.learning_mentor_applications application
           on application.id = mentor.application_id
          and application.status = 'approved'
         inner join public.learning_course_sections section
           on section.course_id = course.id
         inner join public.learning_lessons lesson
           on lesson.section_id = section.id
          and lesson.lesson_type = 'assignment'
          and lesson.is_published = true
         inner join public.learning_assignments assignment
           on assignment.lesson_id = lesson.id
         left join public.learning_assignment_attempts attempt
           on attempt.enrollment_id = enrollment.id
          and attempt.lesson_id = lesson.id
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
         group by assignment.id, enrollment.id, lesson.id, lesson.max_attempts
         for update of enrollment, lesson`,
        [learnerId, slug, lessonId],
      ) as AssignmentAccessRow[]

      const access = accessRows[0]
      if (!access) throw new Error('assignment_not_accessible')
      const attemptsUsed = Number(access.attempts_used ?? 0)
      const maxAttempts = access.max_attempts === null ? null : Number(access.max_attempts)
      if (maxAttempts !== null && attemptsUsed >= maxAttempts) throw new Error('learning_attempt_limit_reached')

      const attemptNumber = attemptsUsed + 1
      const inserted = await query(
        `insert into public.learning_assignment_attempts (
           assignment_id,
           lesson_id,
           enrollment_id,
           learner_id,
           attempt_number,
           response_text,
           attachment_path,
           submitted_at
         ) values ($1, $2, $3, $4, $5, $6, $7, now())
         returning id, attempt_number`,
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
           enrollment_id, lesson_id, completed, completed_at, first_started_at, viewed_at, attempts_used, updated_at
         ) values ($1, $2, true, now(), now(), now(), $3, now())
         on conflict (enrollment_id, lesson_id) do update
         set completed = true,
             completed_at = coalesce(public.learning_progress.completed_at, excluded.completed_at),
             first_started_at = coalesce(public.learning_progress.first_started_at, excluded.first_started_at),
             viewed_at = coalesce(public.learning_progress.viewed_at, excluded.viewed_at),
             attempts_used = greatest(public.learning_progress.attempts_used, excluded.attempts_used),
             updated_at = now()`,
        [access.enrollment_id, access.lesson_id, attemptNumber],
      )

      await query(
        `update public.learning_enrollments enrollment
         set status = 'completed',
             completed_at = coalesce(enrollment.completed_at, now()),
             updated_at = now()
         where enrollment.id = $1
           and not exists (
             select 1
             from public.learning_course_sections section
             inner join public.learning_lessons lesson on lesson.section_id = section.id
             left join public.learning_progress progress
               on progress.enrollment_id = enrollment.id
              and progress.lesson_id = lesson.id
             where section.course_id = enrollment.course_id
               and lesson.is_published = true
               and coalesce(progress.completed, false) = false
           )`,
        [access.enrollment_id],
      )

      return {
        attemptId: attempt.id,
        attemptNumber: Number(attempt.attempt_number),
        completed: true,
      }
    })
  }

  return { submit }
}

export const learnerAssignmentRepository = createLearnerAssignmentRepository()
