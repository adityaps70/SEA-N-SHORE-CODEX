import type { QueryResultRow } from 'pg'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { issueCertificateForCompletedEnrollmentWithQuery } from './certificate-repository'

export type LearnerProgressQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type ProgressTransaction = <T>(work: (query: LearnerProgressQuery) => Promise<T>) => Promise<T>

type AccessibleLessonRow = QueryResultRow & {
  enrollment_id: string
  enrollment_status: string
  course_id: string
  lesson_id: string
}

type CompletionRow = QueryResultRow & {
  completed_at: string | Date
}

type PlaybackPositionRow = QueryResultRow & {
  last_position_seconds: string | number
}

type ProgressCountRow = QueryResultRow & {
  total_lessons: string | number
  completed_lessons: string | number
}

function runtimeTransaction<T>(work: (query: LearnerProgressQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function isoDateTime(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value
}

export async function completeLearningLessonWithQuery(
  query: LearnerProgressQuery,
  learnerId: string,
  slug: string,
  lessonId: string,
) {
  const accessRows = await query(
    `select
       enrollment.id as enrollment_id,
       enrollment.status as enrollment_status,
       course.id as course_id,
       lesson.id as lesson_id
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
     inner join public.learning_course_sections section
       on section.course_id = course.id
     inner join public.learning_lessons lesson
       on lesson.section_id = section.id
     where enrollment.learner_id = $1
       and course.slug = $2
       and lesson.id = $3
       and enrollment.status in ('active', 'completed')
     for update of enrollment`,
    [learnerId, slug, lessonId],
  ) as AccessibleLessonRow[]

  const accessible = accessRows[0]
  if (!accessible) throw new Error('lesson_not_accessible')

  const completionRows = await query(
    `insert into public.learning_progress (
       enrollment_id,
       lesson_id,
       completed,
       completed_at,
       last_position_seconds,
       first_started_at,
       updated_at
     )
     values ($1, $2, true, now(), 0, now(), now())
     on conflict (enrollment_id, lesson_id) do update
     set completed = true,
         completed_at = coalesce(public.learning_progress.completed_at, excluded.completed_at),
         first_started_at = coalesce(public.learning_progress.first_started_at, excluded.first_started_at),
         updated_at = now()
     returning completed_at`,
    [accessible.enrollment_id, accessible.lesson_id],
  ) as CompletionRow[]

  const completion = completionRows[0]
  if (!completion) throw new Error('lesson_completion_failed')

  const countRows = await query(
    `select
       count(lesson.id)::bigint as total_lessons,
       count(progress.lesson_id) filter (where progress.completed = true)::bigint as completed_lessons
     from public.learning_course_sections section
     inner join public.learning_lessons lesson
       on lesson.section_id = section.id
     left join public.learning_progress progress
       on progress.enrollment_id = $1
      and progress.lesson_id = lesson.id
     where section.course_id = $2`,
    [accessible.enrollment_id, accessible.course_id],
  ) as ProgressCountRow[]

  const counts = countRows[0]
  const totalLessons = Number(counts?.total_lessons ?? 0)
  const completedLessons = Number(counts?.completed_lessons ?? 0)
  const progressPercent = totalLessons > 0
    ? Math.round((completedLessons / totalLessons) * 100)
    : 0
  const enrollmentCompleted = totalLessons > 0 && completedLessons === totalLessons

  if (enrollmentCompleted) {
    await query(
      `update public.learning_enrollments
       set status = 'completed',
           completed_at = coalesce(completed_at, now()),
           updated_at = now()
       where id = $1
         and status in ('active', 'completed')
       returning id`,
      [accessible.enrollment_id],
    )
    await issueCertificateForCompletedEnrollmentWithQuery(query, accessible.enrollment_id)
  }

  return {
    enrollmentId: accessible.enrollment_id,
    lessonId: accessible.lesson_id,
    completedAt: isoDateTime(completion.completed_at),
    totalLessons,
    completedLessons,
    progressPercent,
    enrollmentCompleted,
  }
}

export function createLearnerProgressRepository(input: { transaction?: ProgressTransaction } = {}) {
  const transaction = input.transaction ?? runtimeTransaction

  async function completeLesson(learnerId: string, slug: string, lessonId: string) {
    return transaction((query) => completeLearningLessonWithQuery(query, learnerId, slug, lessonId))
  }

  async function savePlaybackPosition(
    learnerId: string,
    slug: string,
    lessonId: string,
    positionSeconds: number,
  ) {
    return transaction(async (query) => {
      const accessRows = await query(
        `select
           enrollment.id as enrollment_id,
           enrollment.status as enrollment_status,
           course.id as course_id,
           lesson.id as lesson_id
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
         inner join public.learning_course_sections section
           on section.course_id = course.id
         inner join public.learning_lessons lesson
           on lesson.section_id = section.id
         where enrollment.learner_id = $1
           and course.slug = $2
           and lesson.id = $3
           and lesson.lesson_type in ('video', 'audio')
           and enrollment.status in ('active', 'completed')
         for update of enrollment`,
        [learnerId, slug, lessonId],
      ) as AccessibleLessonRow[]

      const accessible = accessRows[0]
      if (!accessible) throw new Error('lesson_not_accessible')

      const positionRows = await query(
        `insert into public.learning_progress (
           enrollment_id,
           lesson_id,
           last_position_seconds,
           first_started_at,
           updated_at
         )
         values ($1, $2, $3, now(), now())
         on conflict (enrollment_id, lesson_id) do update
         set last_position_seconds = excluded.last_position_seconds,
             first_started_at = coalesce(public.learning_progress.first_started_at, excluded.first_started_at),
             updated_at = now()
         returning last_position_seconds`,
        [accessible.enrollment_id, accessible.lesson_id, positionSeconds],
      ) as PlaybackPositionRow[]

      const position = positionRows[0]
      if (!position) throw new Error('playback_position_save_failed')

      return {
        enrollmentId: accessible.enrollment_id,
        lessonId: accessible.lesson_id,
        lastPositionSeconds: Number(position.last_position_seconds),
      }
    })
  }

  return { completeLesson, savePlaybackPosition }
}

export const learnerProgressRepository = createLearnerProgressRepository()
