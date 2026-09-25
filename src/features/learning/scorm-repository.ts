import type { QueryResultRow } from 'pg'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { finalizeEnrollmentIfComplete } from './learner-progress-repository'
import { publishedCourseVisibilitySql } from './course-publication'
import {
  createScormRuntimeState,
  isScormCompletionTerminal,
  normalizeScorm12Update,
  normalizeScorm2004Update,
  type ScormRuntimeState,
} from './scorm-runtime'

export type ScormQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type ScormTransaction = <T>(work: (query: ScormQuery) => Promise<T>) => Promise<T>

type PackageAccessRow = QueryResultRow & {
  package_id: string
  enrollment_id: string
  lesson_id: string
  scorm_version: '1.2' | '2004'
  max_attempts: string | number | null
  attempts_used: string | number
}

type AttemptRow = QueryResultRow & {
  id: string
  attempt_number: string | number
}

type LockedAttemptRow = QueryResultRow & {
  id: string
  enrollment_id: string
  course_id: string
  lesson_id: string
  scorm_version: '1.2' | '2004'
  completion_status: string
  success_status: string
  score_raw: string | number | null
  score_scaled: string | number | null
  location: string | null
  suspend_data: string | null
  session_time_seconds: string | number
  total_time_seconds: string | number
  exit_value: string | null
}

function runtimeTransaction<T>(work: (query: ScormQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function rowState(row: LockedAttemptRow): ScormRuntimeState {
  return {
    completionStatus: row.completion_status as ScormRuntimeState['completionStatus'],
    successStatus: row.success_status as ScormRuntimeState['successStatus'],
    scoreRaw: row.score_raw === null ? null : Number(row.score_raw),
    scoreScaled: row.score_scaled === null ? null : Number(row.score_scaled),
    location: row.location,
    suspendData: row.suspend_data,
    sessionTimeSeconds: Number(row.session_time_seconds ?? 0),
    exitValue: row.exit_value,
  }
}

export function createScormRepository(input: { transaction?: ScormTransaction } = {}) {
  const transaction = input.transaction ?? runtimeTransaction

  async function startAttempt(learnerId: string, slug: string, lessonId: string) {
    return transaction(async (query) => {
      const accessRows = await query(
        `select
           package.id as package_id,
           enrollment.id as enrollment_id,
           lesson.id as lesson_id,
           package.scorm_version,
           lesson.max_attempts,
           coalesce(stats.attempts_used, 0)::bigint as attempts_used
         from public.learning_enrollments enrollment
         inner join public.learning_courses course
           on course.id = enrollment.course_id
         left join public.learning_mentors mentor
           on mentor.id = course.mentor_id
         left join public.learning_mentor_applications application
           on application.id = mentor.application_id
         left join public.companies company
           on company.id = course.company_id
         inner join public.learning_course_sections section
           on section.course_id = course.id
         inner join public.learning_lessons lesson
           on lesson.section_id = section.id
          and lesson.lesson_type = 'scorm'
          and lesson.is_published = true
         inner join public.learning_scorm_packages package
           on package.lesson_id = lesson.id
          and package.status = 'ready'
          and package.scorm_version in ('1.2', '2004')
         left join public.learning_progress prerequisite_progress
           on prerequisite_progress.enrollment_id = enrollment.id
          and prerequisite_progress.lesson_id = lesson.prerequisite_lesson_id
         left join lateral (
           select count(*)::bigint as attempts_used
           from public.learning_scorm_attempts attempt
           where attempt.enrollment_id = enrollment.id
             and attempt.lesson_id = lesson.id
         ) stats on true
         where enrollment.learner_id = $1
           and enrollment.status in ('active', 'completed')
           and course.slug = $2
           and ${publishedCourseVisibilitySql()}
           and lesson.id = $3
           and (
             lesson.release_mode = 'immediate'
             or (lesson.release_mode = 'scheduled' and lesson.release_at <= now())
             or (lesson.release_mode = 'drip' and enrollment.enrolled_at + make_interval(days => lesson.drip_delay_days) <= now())
           )
           and (lesson.prerequisite_lesson_id is null or prerequisite_progress.completed = true)
         for update of enrollment, lesson`,
        [learnerId, slug, lessonId],
      ) as PackageAccessRow[]

      const access = accessRows[0]
      if (!access) throw new Error('scorm_not_accessible')
      const attemptsUsed = Number(access.attempts_used ?? 0)
      const maxAttempts = access.max_attempts === null ? null : Number(access.max_attempts)
      if (maxAttempts !== null && attemptsUsed >= maxAttempts) throw new Error('learning_attempt_limit_reached')

      const attemptNumber = attemptsUsed + 1
      const inserted = await query(
        `insert into public.learning_scorm_attempts (
           package_id, lesson_id, enrollment_id, learner_id, attempt_number, initialized_at, updated_at
         ) values ($1, $2, $3, $4, $5, now(), now())
         returning id, attempt_number`,
        [access.package_id, access.lesson_id, access.enrollment_id, learnerId, attemptNumber],
      ) as AttemptRow[]
      const attempt = inserted[0]
      if (!attempt) throw new Error('scorm_attempt_start_failed')

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
        id: attempt.id,
        attemptNumber: Number(attempt.attempt_number),
        scormVersion: access.scorm_version,
        state: createScormRuntimeState(),
      }
    })
  }

  async function commit(learnerId: string, attemptId: string, values: Record<string, string>) {
    return transaction(async (query) => {
      const rows = await query(
        `select
           attempt.id,
           attempt.enrollment_id,
           enrollment.course_id,
           attempt.lesson_id,
           package.scorm_version,
           attempt.completion_status,
           attempt.success_status,
           attempt.score_raw,
           attempt.score_scaled,
           attempt.location,
           attempt.suspend_data,
           attempt.session_time_seconds,
           attempt.total_time_seconds,
           attempt.exit_value
         from public.learning_scorm_attempts attempt
         inner join public.learning_scorm_packages package on package.id = attempt.package_id
         inner join public.learning_enrollments enrollment
           on enrollment.id = attempt.enrollment_id
          and enrollment.learner_id = $1
          and enrollment.status in ('active', 'completed')
         where attempt.id = $2
         for update of attempt`,
        [learnerId, attemptId],
      ) as LockedAttemptRow[]
      const attempt = rows[0]
      if (!attempt) throw new Error('scorm_attempt_not_found')

      const current = rowState(attempt)
      const state = attempt.scorm_version === '1.2'
        ? normalizeScorm12Update(current, values)
        : normalizeScorm2004Update(current, values)
      const completed = isScormCompletionTerminal(state)
      const totalTime = Math.max(Number(attempt.total_time_seconds ?? 0), 0) + Math.max(state.sessionTimeSeconds, 0)

      await query(
        `update public.learning_scorm_attempts
         set completion_status = $3,
             success_status = $4,
             score_raw = $5,
             score_scaled = $6,
             location = $7,
             suspend_data = $8,
             session_time_seconds = $9,
             total_time_seconds = $10,
             exit_value = $11,
             completed_at = case when $12 then coalesce(completed_at, now()) else completed_at end,
             updated_at = now()
         where id = $1
           and learner_id = $2`,
        [
          attempt.id,
          learnerId,
          state.completionStatus,
          state.successStatus,
          state.scoreRaw,
          state.scoreScaled,
          state.location,
          state.suspendData,
          state.sessionTimeSeconds,
          totalTime,
          state.exitValue,
          completed,
        ],
      )

      if (completed) {
        await query(
          `insert into public.learning_progress (
             enrollment_id, lesson_id, completed, completed_at, first_started_at, viewed_at, updated_at
           ) values ($1, $2, true, now(), now(), now(), now())
           on conflict (enrollment_id, lesson_id) do update
           set completed = true,
               completed_at = coalesce(public.learning_progress.completed_at, excluded.completed_at),
               first_started_at = coalesce(public.learning_progress.first_started_at, excluded.first_started_at),
               viewed_at = coalesce(public.learning_progress.viewed_at, excluded.viewed_at),
               updated_at = now()`,
          [attempt.enrollment_id, attempt.lesson_id],
        )
        await finalizeEnrollmentIfComplete(query, attempt.enrollment_id, attempt.course_id)
      }

      return { completed, state }
    })
  }

  return { startAttempt, commit }
}

export const scormRepository = createScormRepository()
