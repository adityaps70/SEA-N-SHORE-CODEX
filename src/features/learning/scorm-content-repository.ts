import { posix as path } from 'node:path'
import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'

type ContentRow = QueryResultRow & { extracted_prefix: string }

export function normalizeScormContentPath(value: string) {
  if (!value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error('scorm_content_path_invalid')
  }
  const normalized = path.normalize(value).replace(/^\.\//, '')
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('scorm_content_path_invalid')
  }
  return normalized
}

export async function resolveLearnerScormContentKey(
  learnerId: string,
  lessonId: string,
  relativePath: string,
) {
  const safePath = normalizeScormContentPath(relativePath)
  const rows = await databaseQuery<ContentRow>(
    `select package.extracted_prefix
     from public.learning_enrollments enrollment
     inner join public.learning_courses course
       on course.id = enrollment.course_id and course.status = 'published'
     inner join public.learning_mentors mentor
       on mentor.id = course.mentor_id and mentor.status = 'active'
     inner join public.learning_mentor_applications application
       on application.id = mentor.application_id and application.status = 'approved'
     inner join public.learning_course_sections section on section.course_id = course.id
     inner join public.learning_lessons lesson
       on lesson.section_id = section.id
      and lesson.id = $2
      and lesson.lesson_type = 'scorm'
      and lesson.is_published = true
     inner join public.learning_scorm_packages package
       on package.lesson_id = lesson.id
      and package.status = 'ready'
      and package.extracted_prefix is not null
     left join public.learning_progress prerequisite_progress
       on prerequisite_progress.enrollment_id = enrollment.id
      and prerequisite_progress.lesson_id = lesson.prerequisite_lesson_id
     where enrollment.learner_id = $1
       and enrollment.status in ('active', 'completed')
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
     limit 1`,
    [learnerId, lessonId],
  )
  const prefix = rows[0]?.extracted_prefix
  if (!prefix) throw new Error('scorm_content_not_accessible')
  return `${prefix}/${safePath}`
}
