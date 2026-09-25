import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import {
  evaluateMaterialAvailability,
  type MaterialCompletionRule,
  type MaterialLockReason,
  type MaterialReleaseMode,
} from './lms-material-policy'
import { coursePublisherNameSql, publishedCourseVisibilitySql } from './course-publication'

type LearnerCourseQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type EnrollmentStatus = 'active' | 'completed'
type CourseLevel = 'beginner' | 'intermediate' | 'advanced' | 'all_levels'
type CourseFormat = 'recorded' | 'live_cohort' | 'hybrid'
export type CourseNavigationMode = 'free' | 'sequential'
export type LessonType =
  | 'video'
  | 'article'
  | 'image'
  | 'pdf'
  | 'presentation_document'
  | 'audio'
  | 'external_embed'
  | 'quiz'
  | 'assignment'
  | 'downloadable_resource'
  | 'scorm'
  | 'live_session'

export type EmbedKind = 'youtube' | 'vimeo' | 'generic' | null

export type LearnerCourseRow = QueryResultRow & {
  enrollment_id: string
  enrollment_status: string
  enrolled_at: string | Date
  course_id: string
  slug: string
  title: string
  subtitle: string | null
  category: string
  level: CourseLevel
  language: string
  course_format: CourseFormat
  certificate_enabled: boolean
  navigation_mode: string
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
  is_preview: boolean | null
  is_downloadable: boolean | null
  is_published: boolean | null
  release_mode: string | null
  release_at: string | Date | null
  drip_delay_days: number | null
  prerequisite_lesson_id: string | null
  prerequisite_completed: boolean | null
  completion_rule: string | null
  completion_threshold: number | null
  max_attempts: number | null
  embed_kind: string | null
  completed: boolean | null
  completed_at: string | Date | null
  last_position_seconds: number | null
  viewed_at: string | Date | null
  media_percent: number | null
  attempts_used: number | null
  assignment_instructions: string | null
  assignment_accepted_extensions: string[] | null
  assignment_max_upload_bytes: string | number | null
  scorm_package_status: string | null
  scorm_version: string | null
  scorm_launch_path: string | null
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
  isPreview: boolean
  isDownloadable: boolean
  isPublished: boolean
  releaseMode: MaterialReleaseMode
  releaseAt: string | null
  dripDelayDays: number | null
  prerequisiteLessonId: string | null
  completionRule: MaterialCompletionRule
  completionThreshold: number | null
  maxAttempts: number | null
  embedKind: EmbedKind
  isAvailable: boolean
  lockReason: MaterialLockReason
  completed: boolean
  completedAt: string | null
  lastPositionSeconds: number
  viewedAt: string | null
  mediaPercent: number
  attemptsUsed: number
  assignment: null | {
    instructions: string
    acceptedExtensions: string[]
    maxUploadBytes: number
  }
  scorm: null | {
    status: 'processing' | 'ready' | 'error'
    version: '1.2' | '2004' | null
    launchPath: string | null
  }
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
  navigationMode: CourseNavigationMode
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

function asNavigationMode(value: string): CourseNavigationMode {
  if (value === 'free' || value === 'sequential') return value
  throw new Error('learning_navigation_mode_invalid')
}

function asLessonType(value: string): LessonType {
  if (
    value === 'video'
    || value === 'article'
    || value === 'image'
    || value === 'pdf'
    || value === 'presentation_document'
    || value === 'audio'
    || value === 'external_embed'
    || value === 'quiz'
    || value === 'assignment'
    || value === 'downloadable_resource'
    || value === 'scorm'
    || value === 'live_session'
  ) return value
  throw new Error('learning_lesson_type_invalid')
}

function asReleaseMode(value: string | null): MaterialReleaseMode {
  if (value === 'scheduled' || value === 'drip') return value
  return 'immediate'
}

function asCompletionRule(value: string | null, lessonType: LessonType): MaterialCompletionRule {
  if (
    value === 'manual'
    || value === 'view'
    || value === 'media_percentage'
    || value === 'quiz_pass'
    || value === 'assignment_submit'
    || value === 'scorm_completion'
  ) return value
  if (lessonType === 'video' || lessonType === 'audio') return 'media_percentage'
  if (lessonType === 'quiz') return 'quiz_pass'
  if (lessonType === 'assignment') return 'assignment_submit'
  if (lessonType === 'scorm') return 'scorm_completion'
  return 'manual'
}

function asEmbedKind(value: string | null): EmbedKind {
  if (value === 'youtube' || value === 'vimeo' || value === 'generic') return value
  return null
}

function nullableIsoDateTime(value: string | Date | null) {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : value
}

function asDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value)
}

function redactLockedMaterial(material: LearnerLesson) {
  if (material.isAvailable) return material
  material.articleBody = null
  material.assetPath = null
  material.externalUrl = null
  material.assignment = null
  material.scorm = material.scorm ? { ...material.scorm, launchPath: null } : null
  return material
}

export function createLearnerCourseRepository(input: {
  query?: LearnerCourseQuery
  now?: () => Date
} = {}) {
  const queryRows: LearnerCourseQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const now = input.now ?? (() => new Date())

  async function getLearnerCourse(learnerId: string, slug: string): Promise<LearnerCourse | null> {
    const rows = await queryRows(
      `select
         enrollment.id as enrollment_id,
         enrollment.status as enrollment_status,
         enrollment.enrolled_at,
         course.id as course_id,
         course.slug,
         course.title,
         course.subtitle,
         course.category,
         course.level,
         course.language,
         course.course_format,
         course.certificate_enabled,
         course.navigation_mode,
         ${coursePublisherNameSql()} as mentor_name,
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
         lesson.is_preview,
         lesson.is_downloadable,
         lesson.is_published,
         lesson.release_mode,
         lesson.release_at,
         lesson.drip_delay_days,
         lesson.prerequisite_lesson_id,
         prerequisite_progress.completed as prerequisite_completed,
         lesson.completion_rule,
         lesson.completion_threshold,
         lesson.max_attempts,
         lesson.embed_kind,
         progress.completed,
         progress.completed_at,
         progress.last_position_seconds,
         progress.viewed_at,
         progress.media_percent,
         progress.attempts_used,
         assignment.instructions as assignment_instructions,
         assignment.accepted_extensions as assignment_accepted_extensions,
         assignment.max_upload_bytes as assignment_max_upload_bytes,
         scorm.status as scorm_package_status,
         scorm.scorm_version,
         scorm.launch_path as scorm_launch_path
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
       left join public.learning_course_sections section
         on section.course_id = course.id
       left join public.learning_lessons lesson
         on lesson.section_id = section.id
        and lesson.is_published = true
       left join public.learning_progress progress
         on progress.enrollment_id = enrollment.id
        and progress.lesson_id = lesson.id
       left join public.learning_progress prerequisite_progress
         on prerequisite_progress.enrollment_id = enrollment.id
        and prerequisite_progress.lesson_id = lesson.prerequisite_lesson_id
       left join public.learning_assignments assignment
         on assignment.lesson_id = lesson.id
       left join public.learning_scorm_packages scorm
         on scorm.lesson_id = lesson.id
       where enrollment.learner_id = $1
         and course.slug = $2
         and enrollment.status in ('active', 'completed')
         and ${publishedCourseVisibilitySql()}
       order by section.position asc, lesson.position asc`,
      [learnerId, slug],
    ) as LearnerCourseRow[]

    const first = rows[0]
    if (!first) return null

    const navigationMode = asNavigationMode(first.navigation_mode ?? 'free')
    const enrolledAt = asDate(first.enrolled_at)
    const currentTime = now()
    const sections: LearnerCourseSection[] = []
    const sectionsById = new Map<string, LearnerCourseSection>()

    for (const row of rows) {
      if (!row.section_id || row.section_title === null || row.section_position === null) continue

      let section = sectionsById.get(row.section_id)
      if (!section) {
        section = {
          id: row.section_id,
          title: row.section_title,
          position: Number(row.section_position),
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

      const lessonType = asLessonType(row.lesson_type)
      const releaseMode = asReleaseMode(row.release_mode)
      const explicitPrerequisite = Boolean(row.prerequisite_lesson_id)
      const availability = evaluateMaterialAvailability({
        isPublished: row.is_published ?? true,
        releaseMode,
        releaseAt: row.release_at ? asDate(row.release_at) : null,
        dripDelayDays: row.drip_delay_days,
        enrolledAt,
        now: currentTime,
        prerequisiteRequired: explicitPrerequisite,
        prerequisiteCompleted: row.prerequisite_completed ?? false,
      })

      const scormStatus = row.scorm_package_status === 'processing'
        || row.scorm_package_status === 'ready'
        || row.scorm_package_status === 'error'
        ? row.scorm_package_status
        : null
      const scormVersion = row.scorm_version === '1.2' || row.scorm_version === '2004'
        ? row.scorm_version
        : null

      section.lessons.push({
        id: row.lesson_id,
        title: row.lesson_title,
        lessonType,
        position: Number(row.lesson_position),
        summary: row.lesson_summary,
        articleBody: row.article_body,
        assetPath: row.asset_path,
        externalUrl: row.external_url,
        durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
        isPreview: row.is_preview ?? false,
        isDownloadable: row.is_downloadable ?? false,
        isPublished: row.is_published ?? true,
        releaseMode,
        releaseAt: nullableIsoDateTime(row.release_at),
        dripDelayDays: row.drip_delay_days === null ? null : Number(row.drip_delay_days),
        prerequisiteLessonId: row.prerequisite_lesson_id,
        completionRule: asCompletionRule(row.completion_rule, lessonType),
        completionThreshold: row.completion_threshold === null ? null : Number(row.completion_threshold),
        maxAttempts: row.max_attempts === null ? null : Number(row.max_attempts),
        embedKind: asEmbedKind(row.embed_kind),
        isAvailable: availability.available,
        lockReason: availability.reason,
        completed: row.completed ?? false,
        completedAt: nullableIsoDateTime(row.completed_at),
        lastPositionSeconds: Number(row.last_position_seconds ?? 0),
        viewedAt: nullableIsoDateTime(row.viewed_at),
        mediaPercent: Number(row.media_percent ?? 0),
        attemptsUsed: Number(row.attempts_used ?? 0),
        assignment: row.assignment_instructions === null
          ? null
          : {
              instructions: row.assignment_instructions,
              acceptedExtensions: row.assignment_accepted_extensions ?? [],
              maxUploadBytes: Number(row.assignment_max_upload_bytes ?? 10485760),
            },
        scorm: scormStatus === null
          ? null
          : {
              status: scormStatus,
              version: scormVersion,
              launchPath: row.scorm_launch_path,
            },
      })
    }

    const orderedLessons = sections.flatMap((section) => section.lessons)
    if (navigationMode === 'sequential') {
      for (let index = 1; index < orderedLessons.length; index += 1) {
        const lesson = orderedLessons[index]!
        if (lesson.prerequisiteLessonId || !lesson.isAvailable) continue
        const previous = orderedLessons[index - 1]!
        if (!previous.completed) {
          lesson.isAvailable = false
          lesson.lockReason = 'prerequisite'
        }
      }
    }
    orderedLessons.forEach(redactLockedMaterial)

    const totalLessons = orderedLessons.length
    const completedLessons = orderedLessons.filter((lesson) => lesson.completed).length
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
      navigationMode,
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
