import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { courseOpenToNewLearnersSql, learnerCourseAccessSql } from './course-publication'

/**
 * Who may read a video's captions (learning round A, A7): a learner enrolled in the course once the
 * video is released to them, or anyone when the video is a free preview of a course open to new
 * learners. Checked in SQL; returns the caption file's storage path, or null.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

const RELEASED_SQL = `(
  lesson.release_mode = 'immediate'
  or (lesson.release_mode = 'scheduled' and lesson.release_at <= now())
  or (lesson.release_mode = 'drip' and enrollment.enrolled_at + make_interval(days => coalesce(lesson.drip_delay_days, 0)) <= now())
)`

const COURSE_JOINS = `inner join public.learning_course_sections section on section.id = lesson.section_id and section.removed_at is null
  inner join public.learning_courses course on course.id = section.course_id
  left join public.learning_mentors mentor on mentor.id = course.mentor_id
  left join public.learning_mentor_applications application
    on application.id = mentor.application_id and application.user_id = mentor.user_id
  left join public.companies company on company.id = course.company_id`

export function createCaptionRepository(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  async function captionPathForViewer(lessonId: string, viewerId: string | null): Promise<string | null> {
    if (viewerId) {
      const rows = await queryRows(
        `select lesson.caption_path
         from public.learning_lessons lesson
         ${COURSE_JOINS}
         inner join public.learning_enrollments enrollment
           on enrollment.course_id = course.id and enrollment.learner_id = $2 and enrollment.status in ('active', 'completed')
         where lesson.id = $1
           and lesson.lesson_type = 'video'
           and lesson.caption_path is not null
           and lesson.is_published = true
           and lesson.removed_at is null
           and ${learnerCourseAccessSql()}
           and ${RELEASED_SQL}
         limit 1`,
        [lessonId, viewerId],
      )
      if (rows[0]) return String(rows[0].caption_path)
    }
    const preview = await queryRows(
      `select lesson.caption_path
       from public.learning_lessons lesson
       ${COURSE_JOINS}
       where lesson.id = $1
         and lesson.lesson_type = 'video'
         and lesson.caption_path is not null
         and lesson.is_preview = true
         and lesson.is_published = true
         and lesson.removed_at is null
         and course.revision_of_course_id is null
         and ${courseOpenToNewLearnersSql()}
       limit 1`,
      [lessonId],
    )
    return preview[0] ? String(preview[0].caption_path) : null
  }

  return { captionPathForViewer }
}

export const captionRepository = createCaptionRepository()
