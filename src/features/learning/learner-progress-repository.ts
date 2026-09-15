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
  completion_rule?: string
  completion_threshold?: string | number | null
  duration_seconds?: string | number | null
}

type CompletionRow = QueryResultRow & {
  completed_at: string | Date
}

type PlaybackPositionRow = QueryResultRow & {
  last_position_seconds: string | number
  media_percent?: string | number
  completed?: boolean
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

const accessPolicySql = `
     and lesson.is_published = true
     and (
       lesson.release_mode = 'immediate'
       or (lesson.release_mode = 'scheduled' and lesson.release_at <= now())
       or (lesson.release_mode = 'drip' and enrollment.enrolled_at + make_interval(days => lesson.drip_delay_days) <= now())
     )
     and (
       lesson.prerequisite_lesson_id is null
       or exists (
         select 1 from public.learning_progress prerequisite_progress
         where prerequisite_progress.enrollment_id = enrollment.id
           and prerequisite_progress.lesson_id = lesson.prerequisite_lesson_id
           and prerequisite_progress.completed = true
       )
     )
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
     )`

async function courseProgress(
  query: LearnerProgressQuery,
  enrollmentId: string,
  courseId: string,
) {
  const countRows = await query(
    `select
       count(lesson.id)::bigint as total_lessons,
       count(progress.lesson_id) filter (where progress.completed = true)::bigint as completed_lessons
     from public.learning_course_sections section
     inner join public.learning_lessons lesson
       on lesson.section_id = section.id
      and lesson.is_published = true
     left join public.learning_progress progress
       on progress.enrollment_id = $1
      and progress.lesson_id = lesson.id
     where section.course_id = $2`,
    [enrollmentId, courseId],
  ) as ProgressCountRow[]

  const counts = countRows[0]
  const totalLessons = Number(counts?.total_lessons ?? 0)
  const completedLessons = Number(counts?.completed_lessons ?? 0)
  const progressPercent = totalLessons > 0
    ? Math.round((completedLessons / totalLessons) * 100)
    : 0
  return {
    totalLessons,
    completedLessons,
    progressPercent,
    enrollmentCompleted: totalLessons > 0 && completedLessons === totalLessons,
  }
}

async function finalizeEnrollmentIfComplete(
  query: LearnerProgressQuery,
  enrollmentId: string,
  courseId: string,
) {
  const progress = await courseProgress(query, enrollmentId, courseId)
  if (progress.enrollmentCompleted) {
    await query(
      `update public.learning_enrollments
       set status = 'completed',
           completed_at = coalesce(completed_at, now()),
           updated_at = now()
       where id = $1
         and status in ('active', 'completed')
       returning id`,
      [enrollmentId],
    )
    await issueCertificateForCompletedEnrollmentWithQuery(query, enrollmentId)
  }
  return progress
}

export async function completeLearningLessonWithQuery(
  query: LearnerProgressQuery,
  learnerId: string,
  slug: string,
  lessonId: string,
  manualCompletionOnly = false,
) {
  const manualRuleSql = manualCompletionOnly
    ? "and lesson.completion_rule in ('manual', 'view')"
    : ''
  const accessRows = await query(
    `select
       enrollment.id as enrollment_id,
       enrollment.status as enrollment_status,
       course.id as course_id,
       lesson.id as lesson_id,
       lesson.completion_rule
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
       ${manualRuleSql}
       ${accessPolicySql}
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
       viewed_at,
       updated_at
     )
     values ($1, $2, true, now(), 0, now(), now(), now())
     on conflict (enrollment_id, lesson_id) do update
     set completed = true,
         completed_at = coalesce(public.learning_progress.completed_at, excluded.completed_at),
         first_started_at = coalesce(public.learning_progress.first_started_at, excluded.first_started_at),
         viewed_at = coalesce(public.learning_progress.viewed_at, excluded.viewed_at),
         updated_at = now()
     returning completed_at`,
    [accessible.enrollment_id, accessible.lesson_id],
  ) as CompletionRow[]

  const completion = completionRows[0]
  if (!completion) throw new Error('lesson_completion_failed')
  const progress = await finalizeEnrollmentIfComplete(query, accessible.enrollment_id, accessible.course_id)

  return {
    enrollmentId: accessible.enrollment_id,
    lessonId: accessible.lesson_id,
    completedAt: isoDateTime(completion.completed_at),
    ...progress,
  }
}

export function createLearnerProgressRepository(input: { transaction?: ProgressTransaction } = {}) {
  const transaction = input.transaction ?? runtimeTransaction

  async function completeLesson(learnerId: string, slug: string, lessonId: string) {
    return transaction((query) => completeLearningLessonWithQuery(query, learnerId, slug, lessonId, true))
  }

  async function savePlaybackPosition(
    learnerId: string,
    slug: string,
    lessonId: string,
    positionSeconds: number,
    reportedDurationSeconds?: number,
  ) {
    return transaction(async (query) => {
      const accessRows = await query(
        `select
           enrollment.id as enrollment_id,
           enrollment.status as enrollment_status,
           course.id as course_id,
           lesson.id as lesson_id,
           lesson.duration_seconds,
           lesson.completion_rule,
           lesson.completion_threshold
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
           ${accessPolicySql}
         for update of enrollment`,
        [learnerId, slug, lessonId],
      ) as AccessibleLessonRow[]

      const accessible = accessRows[0]
      if (!accessible) throw new Error('lesson_not_accessible')

      const duration = reportedDurationSeconds && reportedDurationSeconds > 0
        ? reportedDurationSeconds
        : Number(accessible.duration_seconds ?? 0)
      const mediaPercent = duration > 0
        ? Math.max(0, Math.min(100, Math.floor((positionSeconds / duration) * 100)))
        : 0
      const threshold = Number(accessible.completion_threshold ?? 90)
      const autoComplete = accessible.completion_rule === 'media_percentage'
        && duration > 0
        && mediaPercent >= threshold

      let positionRows: PlaybackPositionRow[]
      if (duration <= 0) {
        positionRows = await query(
          `insert into public.learning_progress (
             enrollment_id, lesson_id, last_position_seconds, first_started_at, viewed_at, updated_at
           ) values ($1, $2, $3, now(), now(), now())
           on conflict (enrollment_id, lesson_id) do update
           set last_position_seconds = excluded.last_position_seconds,
               first_started_at = coalesce(public.learning_progress.first_started_at, excluded.first_started_at),
               viewed_at = coalesce(public.learning_progress.viewed_at, excluded.viewed_at),
               updated_at = now()
           returning last_position_seconds, media_percent, completed`,
          [accessible.enrollment_id, accessible.lesson_id, positionSeconds],
        ) as PlaybackPositionRow[]
      } else if (autoComplete) {
        positionRows = await query(
          `insert into public.learning_progress (
             enrollment_id, lesson_id, last_position_seconds, first_started_at, viewed_at, media_percent, completed, completed_at, updated_at
           ) values ($1, $2, $3, now(), now(), $4, true, now(), now())
           on conflict (enrollment_id, lesson_id) do update
           set last_position_seconds = greatest(public.learning_progress.last_position_seconds, excluded.last_position_seconds),
               first_started_at = coalesce(public.learning_progress.first_started_at, excluded.first_started_at),
               viewed_at = coalesce(public.learning_progress.viewed_at, excluded.viewed_at),
               media_percent = greatest(public.learning_progress.media_percent, excluded.media_percent),
               completed = true,
               completed_at = coalesce(public.learning_progress.completed_at, excluded.completed_at),
               updated_at = now()
           returning last_position_seconds, media_percent, completed`,
          [accessible.enrollment_id, accessible.lesson_id, positionSeconds, mediaPercent],
        ) as PlaybackPositionRow[]
      } else {
        positionRows = await query(
          `insert into public.learning_progress (
             enrollment_id, lesson_id, last_position_seconds, first_started_at, viewed_at, media_percent, updated_at
           ) values ($1, $2, $3, now(), now(), $4, now())
           on conflict (enrollment_id, lesson_id) do update
           set last_position_seconds = excluded.last_position_seconds,
               first_started_at = coalesce(public.learning_progress.first_started_at, excluded.first_started_at),
               viewed_at = coalesce(public.learning_progress.viewed_at, excluded.viewed_at),
               media_percent = greatest(public.learning_progress.media_percent, excluded.media_percent),
               updated_at = now()
           returning last_position_seconds, media_percent, completed`,
          [accessible.enrollment_id, accessible.lesson_id, positionSeconds, mediaPercent],
        ) as PlaybackPositionRow[]
      }

      const position = positionRows[0]
      if (!position) throw new Error('playback_position_save_failed')

      if (autoComplete) {
        await finalizeEnrollmentIfComplete(query, accessible.enrollment_id, accessible.course_id)
      }

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
