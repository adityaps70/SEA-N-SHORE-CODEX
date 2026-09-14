import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'

type EnrollmentQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type EnrollmentStatus = 'active' | 'completed' | 'revoked'
type EnrollmentSource = 'free' | 'purchase' | 'admin'
type CourseLevel = 'beginner' | 'intermediate' | 'advanced' | 'all_levels'
type CourseFormat = 'recorded' | 'live_cohort' | 'hybrid'

type EnrollmentRow = QueryResultRow & {
  id: string
  status: string
  enrollment_source: string
  enrolled_at: string | Date
  completed_at: string | Date | null
  revoked_at: string | Date | null
}

type LearnerCourseRow = QueryResultRow & {
  enrollment_id: string
  enrollment_status: string
  enrolled_at: string | Date
  completed_at: string | Date | null
  course_id: string
  slug: string
  title: string
  subtitle: string | null
  category: string
  level: CourseLevel
  language: string
  thumbnail_path: string | null
  course_format: CourseFormat
  certificate_enabled: boolean
  mentor_name: string
  certificate_id: string | null
  certificate_verification_code: string | null
  total_lessons: string | number
  completed_lessons: string | number
}

export type LearnerEnrollment = {
  enrollmentId: string
  status: EnrollmentStatus
  enrollmentSource: EnrollmentSource
  enrolledAt: string
  completedAt: string | null
  revokedAt: string | null
}

export type LearnerCourseEnrollment = {
  enrollmentId: string
  enrollmentStatus: 'active' | 'completed'
  enrolledAt: string
  completedAt: string | null
  courseId: string
  slug: string
  title: string
  subtitle: string | null
  category: string
  level: CourseLevel
  language: string
  thumbnailPath: string | null
  courseFormat: CourseFormat
  certificateEnabled: boolean
  mentorName: string
  certificateId: string | null
  certificateVerificationCode: string | null
  totalLessons: number
  completedLessons: number
  progressPercent: number
}

function isoDateTime(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value
}

function nullableIsoDateTime(value: string | Date | null) {
  return value === null ? null : isoDateTime(value)
}

function asEnrollmentStatus(value: string): EnrollmentStatus {
  if (value === 'active' || value === 'completed' || value === 'revoked') return value
  throw new Error('enrollment_status_invalid')
}

function asEnrollmentSource(value: string): EnrollmentSource {
  if (value === 'free' || value === 'purchase' || value === 'admin') return value
  throw new Error('enrollment_source_invalid')
}

function mapEnrollment(row: EnrollmentRow): LearnerEnrollment {
  return {
    enrollmentId: row.id,
    status: asEnrollmentStatus(row.status),
    enrollmentSource: asEnrollmentSource(row.enrollment_source),
    enrolledAt: isoDateTime(row.enrolled_at),
    completedAt: nullableIsoDateTime(row.completed_at),
    revokedAt: nullableIsoDateTime(row.revoked_at),
  }
}

export function createEnrollmentRepository(input: { query?: EnrollmentQuery } = {}) {
  const queryRows: EnrollmentQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  async function getLearnerEnrollment(learnerId: string, courseId: string): Promise<LearnerEnrollment | null> {
    const rows = await queryRows(
      `select
         enrollment.id,
         enrollment.status,
         enrollment.enrollment_source,
         enrollment.enrolled_at,
         enrollment.completed_at,
         enrollment.revoked_at
       from public.learning_enrollments enrollment
       where enrollment.learner_id = $1
         and enrollment.course_id = $2
       limit 1`,
      [learnerId, courseId],
    ) as EnrollmentRow[]

    const row = rows[0]
    return row ? mapEnrollment(row) : null
  }

  async function enrollFreeCourse(learnerId: string, courseId: string) {
    const rows = await queryRows(
      `insert into public.learning_enrollments (
         course_id,
         learner_id,
         enrollment_source,
         status,
         enrolled_at,
         created_at,
         updated_at
       )
       select
         course.id,
         $1,
         'free',
         'active',
         now(),
         now(),
         now()
       from public.learning_courses course
       inner join public.learning_mentors mentor
         on mentor.id = course.mentor_id
       inner join public.learning_mentor_applications application
         on application.id = mentor.application_id
        and application.user_id = mentor.user_id
       where course.id = $2
         and course.status = 'published'
         and mentor.status = 'active'
         and application.status = 'approved'
         and course.access_type = 'free'
         and course.price_minor = 0
       on conflict (course_id, learner_id) do nothing
       returning
         id,
         status,
         enrollment_source,
         enrolled_at,
         completed_at,
         revoked_at`,
      [learnerId, courseId],
    ) as EnrollmentRow[]

    const created = rows[0]
    if (created) {
      const enrollment = mapEnrollment(created)
      return {
        enrollmentId: enrollment.enrollmentId,
        status: enrollment.status,
        enrolledAt: enrollment.enrolledAt,
        alreadyEnrolled: false,
      }
    }

    const existing = await getLearnerEnrollment(learnerId, courseId)
    if (!existing) throw new Error('course_not_enrollable')
    if (existing.status === 'revoked') throw new Error('enrollment_revoked')

    return {
      enrollmentId: existing.enrollmentId,
      status: existing.status,
      enrolledAt: existing.enrolledAt,
      alreadyEnrolled: true,
    }
  }

  async function listLearnerEnrollments(learnerId: string): Promise<LearnerCourseEnrollment[]> {
    const rows = await queryRows(
      `select
         enrollment.id as enrollment_id,
         enrollment.status as enrollment_status,
         enrollment.enrolled_at,
         enrollment.completed_at,
         course.id as course_id,
         course.slug,
         course.title,
         course.subtitle,
         course.category,
         course.level,
         course.language,
         course.thumbnail_path,
         course.course_format,
         course.certificate_enabled,
         application.applicant_name as mentor_name,
         certificate.id as certificate_id,
         certificate.verification_code as certificate_verification_code,
         count(distinct lesson.id)::bigint as total_lessons,
         count(distinct progress.lesson_id) filter (where progress.completed = true)::bigint as completed_lessons
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
       left join public.learning_course_sections section
         on section.course_id = course.id
       left join public.learning_lessons lesson
         on lesson.section_id = section.id
       left join public.learning_progress progress
         on progress.enrollment_id = enrollment.id
        and progress.lesson_id = lesson.id
       left join public.learning_certificates certificate
         on certificate.enrollment_id = enrollment.id
        and certificate.learner_id = enrollment.learner_id
       where enrollment.learner_id = $1
         and enrollment.status in ('active', 'completed')
       group by
         enrollment.id,
         enrollment.status,
         enrollment.enrolled_at,
         enrollment.completed_at,
         course.id,
         course.slug,
         course.title,
         course.subtitle,
         course.category,
         course.level,
         course.language,
         course.thumbnail_path,
         course.course_format,
         course.certificate_enabled,
         application.applicant_name,
         certificate.id,
         certificate.verification_code
       order by enrollment.updated_at desc, enrollment.id desc`,
      [learnerId],
    ) as LearnerCourseRow[]

    return rows.map((row) => {
      const enrollmentStatus = asEnrollmentStatus(row.enrollment_status)
      if (enrollmentStatus === 'revoked') throw new Error('learner_enrollment_visibility_invalid')

      const totalLessons = Number(row.total_lessons)
      const completedLessons = Number(row.completed_lessons)
      const progressPercent = totalLessons > 0
        ? Math.round((completedLessons / totalLessons) * 100)
        : 0

      return {
        enrollmentId: row.enrollment_id,
        enrollmentStatus,
        enrolledAt: isoDateTime(row.enrolled_at),
        completedAt: nullableIsoDateTime(row.completed_at),
        courseId: row.course_id,
        slug: row.slug,
        title: row.title,
        subtitle: row.subtitle,
        category: row.category,
        level: row.level,
        language: row.language,
        thumbnailPath: row.thumbnail_path,
        courseFormat: row.course_format,
        certificateEnabled: row.certificate_enabled,
        mentorName: row.mentor_name,
        certificateId: row.certificate_id,
        certificateVerificationCode: row.certificate_verification_code,
        totalLessons,
        completedLessons,
        progressPercent,
      }
    })
  }

  return {
    enrollFreeCourse,
    getLearnerEnrollment,
    listLearnerEnrollments,
  }
}

export const enrollmentRepository = createEnrollmentRepository()
