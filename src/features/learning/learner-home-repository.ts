import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { learnerCourseAccessSql } from './course-publication'
import { learnerCourseRepository, type LearnerCourse, type LearnerLesson } from './learner-course-repository'
import { curriculumLessons, resumePoint, type ResumePoint } from './next-lesson'

type LearnerHomeQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type ResumeEnrollmentRow = QueryResultRow & {
  enrollment_id: string
  enrolled_at: string | Date
  slug: string
  title: string
  last_active_at: string | Date
}

export type ResumeCourse = {
  enrollmentId: string
  slug: string
  title: string
  point: ResumePoint<LearnerLesson>
}

function asDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value)
}

/**
 * The learner home (My Learning, learning round C, C6): the course the learner was most recently active in, and
 * the exact lesson to pick up next. Only the learner's own enrolments are read.
 */
export function createLearnerHomeRepository(input: {
  query?: LearnerHomeQuery
  now?: () => Date
  getLearnerCourse?: (learnerId: string, slug: string) => Promise<LearnerCourse | null>
} = {}) {
  const queryRows: LearnerHomeQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const now = input.now ?? (() => new Date())
  const getLearnerCourse = input.getLearnerCourse ?? learnerCourseRepository.getLearnerCourse

  /**
   * The in-progress enrolment the learner last worked in: active (not completed, not revoked), access not ended,
   * ordered by the latest lesson progress and, without any, by when they enrolled.
   */
  async function findResumeEnrollment(learnerId: string) {
    const rows = await queryRows(
      `select
         enrollment.id as enrollment_id,
         enrollment.enrolled_at,
         course.slug,
         course.title,
         coalesce(
           (select max(progress.updated_at)
            from public.learning_progress progress
            where progress.enrollment_id = enrollment.id),
           enrollment.enrolled_at
         ) as last_active_at
       from public.learning_enrollments enrollment
       inner join public.learning_courses course
         on course.id = enrollment.course_id
       left join public.learning_mentors mentor
         on mentor.id = course.mentor_id
       left join public.learning_mentor_applications application
         on application.id = mentor.application_id
        and application.user_id = mentor.user_id
       left join public.companies company
         on company.id = course.company_id
       where enrollment.learner_id = $1
         and enrollment.status = 'active'
         and (enrollment.access_expires_at is null or enrollment.access_expires_at > $2::timestamptz)
         and ${learnerCourseAccessSql()}
       order by last_active_at desc, enrollment.enrolled_at desc, enrollment.id desc
       limit 1`,
      [learnerId, now().toISOString()],
    ) as ResumeEnrollmentRow[]
    const row = rows[0]
    if (!row) return null
    return {
      enrollmentId: row.enrollment_id,
      enrolledAt: asDate(row.enrolled_at),
      slug: row.slug,
      title: row.title,
      lastActiveAt: asDate(row.last_active_at).toISOString(),
    }
  }

  /** The "Continue" card: the next lesson is worked out for the one chosen course only. */
  async function getResumeCourse(learnerId: string): Promise<ResumeCourse | null> {
    const enrollment = await findResumeEnrollment(learnerId)
    if (!enrollment) return null
    const course = await getLearnerCourse(learnerId, enrollment.slug)
    if (!course || course.enrollmentId !== enrollment.enrollmentId) return null
    return {
      enrollmentId: course.enrollmentId,
      slug: course.slug,
      title: course.title,
      point: resumePoint(curriculumLessons(course), enrollment.enrolledAt),
    }
  }

  return { findResumeEnrollment, getResumeCourse }
}

export const learnerHomeRepository = createLearnerHomeRepository()
