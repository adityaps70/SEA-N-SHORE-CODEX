import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import type { CourseStatus } from './course-workflow'

export type MentorAnalyticsQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type MentorAnalyticsRow = QueryResultRow & {
  course_id: string
  slug: string
  title: string
  status: string
  enrollment_count: string | number | null
  active_enrollment_count: string | number | null
  completed_enrollment_count: string | number | null
  average_progress: string | number | null
  certificate_count: string | number | null
  pending_assignment_count: string | number | null
  passed_assignment_count: string | number | null
  revision_assignment_count: string | number | null
}

export type MentorCourseAnalytics = {
  courseId: string
  slug: string
  title: string
  status: CourseStatus
  enrollmentCount: number
  activeEnrollmentCount: number
  completedEnrollmentCount: number
  completionRate: number
  averageProgress: number
  certificateCount: number
  pendingAssignmentCount: number
  passedAssignmentCount: number
  revisionAssignmentCount: number
}

export type MentorLearningAnalytics = {
  summary: {
    courseCount: number
    publishedCourseCount: number
    enrollmentCount: number
    activeEnrollmentCount: number
    completedEnrollmentCount: number
    completionRate: number
    averageProgress: number
    certificateCount: number
    pendingAssignmentCount: number
    passedAssignmentCount: number
    revisionAssignmentCount: number
  }
  courses: MentorCourseAnalytics[]
}

function nonNegativeInteger(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.round(numeric)
}

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

function percentage(numerator: number, denominator: number) {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 100)
}

function mapCourse(row: MentorAnalyticsRow): MentorCourseAnalytics {
  const enrollmentCount = nonNegativeInteger(row.enrollment_count)
  const completedEnrollmentCount = nonNegativeInteger(row.completed_enrollment_count)

  return {
    courseId: row.course_id,
    slug: row.slug,
    title: row.title,
    status: asCourseStatus(row.status),
    enrollmentCount,
    activeEnrollmentCount: nonNegativeInteger(row.active_enrollment_count),
    completedEnrollmentCount,
    completionRate: percentage(completedEnrollmentCount, enrollmentCount),
    averageProgress: nonNegativeInteger(row.average_progress),
    certificateCount: nonNegativeInteger(row.certificate_count),
    pendingAssignmentCount: nonNegativeInteger(row.pending_assignment_count),
    passedAssignmentCount: nonNegativeInteger(row.passed_assignment_count),
    revisionAssignmentCount: nonNegativeInteger(row.revision_assignment_count),
  }
}

export function createMentorAnalyticsRepository(input: { query?: MentorAnalyticsQuery } = {}) {
  const queryRows: MentorAnalyticsQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  async function getForMentor(mentorUserId: string): Promise<MentorLearningAnalytics> {
    const rows = await queryRows(
      `with owned_courses as (
         select
           course.id,
           course.slug,
           course.title,
           course.status
         from public.learning_courses course
         inner join public.learning_mentors mentor
           on mentor.id = course.mentor_id
         where mentor.user_id = $1
           and mentor.status = 'active'
       ),
       published_lesson_counts as (
         select
           course.id as course_id,
           count(lesson.id)::bigint as total_lessons
         from owned_courses course
         left join public.learning_course_sections section
           on section.course_id = course.id
         left join public.learning_lessons lesson
           on lesson.section_id = section.id
          and lesson.is_published = true
         group by course.id
       ),
       enrollment_progress as (
         select
           enrollment.id as enrollment_id,
           enrollment.course_id,
           enrollment.status,
           case
             when coalesce(lesson_counts.total_lessons, 0) > 0 then
               round(
                 count(progress.lesson_id) filter (where progress.completed = true)::numeric
                 * 100
                 / lesson_counts.total_lessons
               )::integer
             else 0
           end as progress_percent
         from public.learning_enrollments enrollment
         inner join owned_courses course
           on course.id = enrollment.course_id
         left join published_lesson_counts lesson_counts
           on lesson_counts.course_id = course.id
         left join public.learning_course_sections section
           on section.course_id = course.id
         left join public.learning_lessons lesson
           on lesson.section_id = section.id
          and lesson.is_published = true
         left join public.learning_progress progress
           on progress.enrollment_id = enrollment.id
          and progress.lesson_id = lesson.id
         where enrollment.status <> 'revoked'
         group by
           enrollment.id,
           enrollment.course_id,
           enrollment.status,
           lesson_counts.total_lessons
       ),
       enrollment_metrics as (
         select
           course_id,
           count(*)::bigint as enrollment_count,
           count(*) filter (where status = 'active')::bigint as active_enrollment_count,
           count(*) filter (where status = 'completed')::bigint as completed_enrollment_count,
           coalesce(round(avg(progress_percent)), 0)::integer as average_progress
         from enrollment_progress
         group by course_id
       ),
       certificate_metrics as (
         select
           certificate.course_id,
           count(*)::bigint as certificate_count
         from public.learning_certificates certificate
         inner join owned_courses course
           on course.id = certificate.course_id
         group by certificate.course_id
       ),
       assignment_metrics as (
         select
           section.course_id,
           count(*) filter (where attempt.status = 'submitted')::bigint as pending_assignment_count,
           count(*) filter (where attempt.status = 'graded' and attempt.passed = true)::bigint as passed_assignment_count,
           count(*) filter (where attempt.status = 'graded' and attempt.passed = false)::bigint as revision_assignment_count
         from public.learning_assignment_attempts attempt
         inner join public.learning_assignments assignment
           on assignment.id = attempt.assignment_id
         inner join public.learning_lessons lesson
           on lesson.id = attempt.lesson_id
         inner join public.learning_course_sections section
           on section.id = lesson.section_id
         inner join owned_courses course
           on course.id = section.course_id
         group by section.course_id
       )
       select
         course.id as course_id,
         course.slug,
         course.title,
         course.status,
         coalesce(enrollment.enrollment_count, 0)::bigint as enrollment_count,
         coalesce(enrollment.active_enrollment_count, 0)::bigint as active_enrollment_count,
         coalesce(enrollment.completed_enrollment_count, 0)::bigint as completed_enrollment_count,
         coalesce(enrollment.average_progress, 0)::integer as average_progress,
         coalesce(certificate.certificate_count, 0)::bigint as certificate_count,
         coalesce(assignment.pending_assignment_count, 0)::bigint as pending_assignment_count,
         coalesce(assignment.passed_assignment_count, 0)::bigint as passed_assignment_count,
         coalesce(assignment.revision_assignment_count, 0)::bigint as revision_assignment_count
       from owned_courses course
       left join enrollment_metrics enrollment
         on enrollment.course_id = course.id
       left join certificate_metrics certificate
         on certificate.course_id = course.id
       left join assignment_metrics assignment
         on assignment.course_id = course.id
       order by
         coalesce(enrollment.enrollment_count, 0) desc,
         coalesce(assignment.pending_assignment_count, 0) desc,
         course.title asc,
         course.id asc`,
      [mentorUserId],
    ) as MentorAnalyticsRow[]

    const courses = rows.map(mapCourse)
    const enrollmentCount = courses.reduce((sum, course) => sum + course.enrollmentCount, 0)
    const activeEnrollmentCount = courses.reduce((sum, course) => sum + course.activeEnrollmentCount, 0)
    const completedEnrollmentCount = courses.reduce((sum, course) => sum + course.completedEnrollmentCount, 0)
    const weightedProgress = courses.reduce(
      (sum, course) => sum + course.averageProgress * course.enrollmentCount,
      0,
    )

    return {
      summary: {
        courseCount: courses.length,
        publishedCourseCount: courses.filter((course) => course.status === 'published').length,
        enrollmentCount,
        activeEnrollmentCount,
        completedEnrollmentCount,
        completionRate: percentage(completedEnrollmentCount, enrollmentCount),
        averageProgress: enrollmentCount > 0 ? Math.round(weightedProgress / enrollmentCount) : 0,
        certificateCount: courses.reduce((sum, course) => sum + course.certificateCount, 0),
        pendingAssignmentCount: courses.reduce((sum, course) => sum + course.pendingAssignmentCount, 0),
        passedAssignmentCount: courses.reduce((sum, course) => sum + course.passedAssignmentCount, 0),
        revisionAssignmentCount: courses.reduce((sum, course) => sum + course.revisionAssignmentCount, 0),
      },
      courses,
    }
  }

  return { getForMentor }
}

export const mentorAnalyticsRepository = createMentorAnalyticsRepository()