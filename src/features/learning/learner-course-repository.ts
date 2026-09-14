import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'

type LearnerCourseQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type EnrollmentStatus = 'active' | 'completed'
type CourseLevel = 'beginner' | 'intermediate' | 'advanced' | 'all_levels'
type CourseFormat = 'recorded' | 'live_cohort' | 'hybrid'
type LessonType =
  | 'video'
  | 'article'
  | 'pdf'
  | 'presentation_document'
  | 'audio'
  | 'quiz'
  | 'assignment'
  | 'downloadable_resource'
  | 'live_session'

type LearnerCourseRow = QueryResultRow & {
  enrollment_id: string
  enrollment_status: string
  course_id: string
  slug: string
  title: string
  subtitle: string | null
  category: string
  level: CourseLevel
  language: string
  course_format: CourseFormat
  certificate_enabled: boolean
  mentor_name: string
  section_id: string | null
  section_title: string | null
  section_position: number | null
  lesson_id: string | null
  lesson_title: string | null
  lesson_type: string | null
  lesson_position: number | null
  lesson_summary: string | null
  article_body: string | null
  asset_path: string | null
  external_url: string | null
  duration_seconds: number | null
  is_downloadable: boolean | null
  completed: boolean | null
  completed_at: string | Date | null
  last_position_seconds: number | null
}

export type LearnerLesson = {
  id: string
  title: string
  lessonType: LessonType
  position: number
  summary: string | null
  articleBody: string | null
  assetPath: string | null
  externalUrl: string | null
  durationSeconds: number | null
  isDownloadable: boolean
  completed: boolean
  completedAt: string | null
  lastPositionSeconds: number
}

export type LearnerCourseSection = {
  id: string
  title: string
  position: number
  lessons: LearnerLesson[]
}

export type LearnerCourse = {
  enrollmentId: string
  enrollmentStatus: EnrollmentStatus
  courseId: string
  slug: string
  title: string
  subtitle: string | null
  category: string
  level: CourseLevel
  language: string
  courseFormat: CourseFormat
  certificateEnabled: boolean
  mentorName: string
  totalLessons: number
  completedLessons: number
  progressPercent: number
  sections: LearnerCourseSection[]
}

function asEnrollmentStatus(value: string): EnrollmentStatus {
  if (value === 'active' || value === 'completed') return value
  throw new Error('learner_enrollment_status_invalid')
}

function asLessonType(value: string): LessonType {
  if (
    value === 'video'
    || value === 'article'
    || value === 'pdf'
    || value === 'presentation_document'
    || value === 'audio'
    || value === 'quiz'
    || value === 'assignment'
    || value === 'downloadable_resource'
    || value === 'live_session'
  ) return value
  throw new Error('learning_lesson_type_invalid')
}

function nullableIsoDateTime(value: string | Date | null) {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : value
}

export function createLearnerCourseRepository(input: { query?: LearnerCourseQuery } = {}) {
  const queryRows: LearnerCourseQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  async function getLearnerCourse(learnerId: string, slug: string): Promise<LearnerCourse | null> {
    const rows = await queryRows(
      `select
         enrollment.id as enrollment_id,
         enrollment.status as enrollment_status,
         course.id as course_id,
         course.slug,
         course.title,
         course.subtitle,
         course.category,
         course.level,
         course.language,
         course.course_format,
         course.certificate_enabled,
         application.applicant_name as mentor_name,
         section.id as section_id,
         section.title as section_title,
         section.position as section_position,
         lesson.id as lesson_id,
         lesson.title as lesson_title,
         lesson.lesson_type,
         lesson.position as lesson_position,
         lesson.summary as lesson_summary,
         lesson.article_body,
         lesson.asset_path,
         lesson.external_url,
         lesson.duration_seconds,
         lesson.is_downloadable,
         progress.completed,
         progress.completed_at,
         progress.last_position_seconds
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
       where enrollment.learner_id = $1
         and course.slug = $2
         and enrollment.status in ('active', 'completed')
       order by section.position asc, lesson.position asc`,
      [learnerId, slug],
    ) as LearnerCourseRow[]

    const first = rows[0]
    if (!first) return null

    const sections: LearnerCourseSection[] = []
    const sectionsById = new Map<string, LearnerCourseSection>()

    for (const row of rows) {
      if (!row.section_id || row.section_title === null || row.section_position === null) continue

      let section = sectionsById.get(row.section_id)
      if (!section) {
        section = {
          id: row.section_id,
          title: row.section_title,
          position: row.section_position,
          lessons: [],
        }
        sectionsById.set(row.section_id, section)
        sections.push(section)
      }

      if (
        !row.lesson_id
        || row.lesson_title === null
        || row.lesson_type === null
        || row.lesson_position === null
      ) continue

      section.lessons.push({
        id: row.lesson_id,
        title: row.lesson_title,
        lessonType: asLessonType(row.lesson_type),
        position: row.lesson_position,
        summary: row.lesson_summary,
        articleBody: row.article_body,
        assetPath: row.asset_path,
        externalUrl: row.external_url,
        durationSeconds: row.duration_seconds,
        isDownloadable: row.is_downloadable ?? false,
        completed: row.completed ?? false,
        completedAt: nullableIsoDateTime(row.completed_at),
        lastPositionSeconds: row.last_position_seconds ?? 0,
      })
    }

    const lessons = sections.flatMap((section) => section.lessons)
    const totalLessons = lessons.length
    const completedLessons = lessons.filter((lesson) => lesson.completed).length
    const progressPercent = totalLessons > 0
      ? Math.round((completedLessons / totalLessons) * 100)
      : 0

    return {
      enrollmentId: first.enrollment_id,
      enrollmentStatus: asEnrollmentStatus(first.enrollment_status),
      courseId: first.course_id,
      slug: first.slug,
      title: first.title,
      subtitle: first.subtitle,
      category: first.category,
      level: first.level,
      language: first.language,
      courseFormat: first.course_format,
      certificateEnabled: first.certificate_enabled,
      mentorName: first.mentor_name,
      totalLessons,
      completedLessons,
      progressPercent,
      sections,
    }
  }

  return { getLearnerCourse }
}

export const learnerCourseRepository = createLearnerCourseRepository()
