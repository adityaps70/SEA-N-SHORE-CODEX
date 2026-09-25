import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { canMentorEditCourse, type CourseStatus } from './course-workflow'
import { courseManagerAccessSql } from './course-access'

type OwnedCourseRow = QueryResultRow & { id: string; status: string }
type ReferenceRow = QueryResultRow & { referenced: boolean }

function asCourseStatus(value: string): CourseStatus {
  if (
    value === 'draft'
    || value === 'submitted'
    || value === 'changes_requested'
    || value === 'approved'
    || value === 'published'
    || value === 'archived'
  ) return value
  throw new Error('course_status_invalid')
}

export function createLearningMediaRepository() {
  async function assertOwnedCourse(actorId: string, courseId: string) {
    const rows = await databaseQuery<OwnedCourseRow>(
      `select course.id, course.status
       from public.learning_courses course
       where course.id = $1
         and ${courseManagerAccessSql('course', '$2')}
       limit 1`,
      [courseId, actorId],
    )
    const course = rows[0]
    if (!course) throw new Error('course_not_found')
    return course
  }

  async function assertEditableOwnedCourse(actorId: string, courseId: string) {
    const course = await assertOwnedCourse(actorId, courseId)
    if (!canMentorEditCourse(asCourseStatus(course.status))) throw new Error('course_edit_forbidden')
    return true
  }

  async function isMediaReferenced(actorId: string, courseId: string, storagePath: string) {
    const rows = await databaseQuery<ReferenceRow>(
      `select exists (
         select 1
         from public.learning_courses course
         where course.id = $2
           and ${courseManagerAccessSql('course', '$1')}
           and (
             course.thumbnail_path = $3
             or course.trailer_path = $3
             or exists (
               select 1
               from public.learning_course_sections section
               inner join public.learning_lessons lesson
                 on lesson.section_id = section.id
               where section.course_id = course.id
                 and lesson.asset_path = $3
             )
           )
       ) as referenced`,
      [actorId, courseId, storagePath],
    )
    return rows[0]?.referenced ?? false
  }

  return { assertOwnedCourse, assertEditableOwnedCourse, isMediaReferenced }
}

export const learningMediaRepository = createLearningMediaRepository()
