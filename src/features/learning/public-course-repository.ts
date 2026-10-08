import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { courseOpenToNewLearnersSql } from './course-publication'

/**
 * What anyone (signed out included) may see of a course: its curriculum outline, and the materials
 * the trainer marked "Free preview". Only courses open to new learners qualify: published by an
 * active publisher, not archived, not removed, not a draft revision. Lesson content never leaves
 * here unless the lesson is a published, previewable free-preview material, checked in SQL.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

/** Material types a visitor can read or watch without enrolling. Activities need an enrolment. */
export const PREVIEWABLE_LESSON_TYPES = [
  'video', 'audio', 'article', 'image', 'pdf', 'presentation_document', 'external_embed', 'downloadable_resource',
] as const

export type PublicCurriculumLesson = {
  id: string
  title: string
  lessonType: string
  durationSeconds: number | null
  /** The trainer marked it "Free preview" and it is a type a visitor can open. */
  preview: boolean
}

export type PublicCurriculumSection = {
  title: string
  lessons: PublicCurriculumLesson[]
}

export type PreviewLesson = {
  course: { id: string; slug: string; title: string }
  lesson: {
    id: string
    title: string
    lessonType: (typeof PREVIEWABLE_LESSON_TYPES)[number]
    summary: string | null
    articleBody: string | null
    articleFormat: 'plain' | 'html'
    assetPath: string | null
    externalUrl: string | null
    embedKind: 'youtube' | 'vimeo' | 'generic' | null
    durationSeconds: number | null
    isDownloadable: boolean
    captionPath: string | null
  }
}

type CurriculumRow = QueryResultRow & {
  section_id: string
  section_title: string
  lesson_id: string
  lesson_title: string
  lesson_type: string
  duration_seconds: string | number | null
  is_preview: boolean
}

type PreviewRow = QueryResultRow & {
  course_id: string
  course_slug: string
  course_title: string
  lesson_id: string
  lesson_title: string
  lesson_type: PreviewLesson['lesson']['lessonType']
  summary: string | null
  article_body: string | null
  article_format: string | null
  asset_path: string | null
  external_url: string | null
  embed_kind: PreviewLesson['lesson']['embedKind']
  duration_seconds: string | number | null
  is_downloadable: boolean
  caption_path: string | null
}

const PUBLIC_COURSE_FROM = `from public.learning_courses course
  left join public.learning_mentors mentor on mentor.id = course.mentor_id
  left join public.learning_mentor_applications application
    on application.id = mentor.application_id
   and application.user_id = mentor.user_id
  left join public.companies company on company.id = course.company_id`

export function createPublicCourseRepository(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  /** Section and material titles, types and lengths (no content), in course order. */
  async function getPublicCurriculum(courseId: string): Promise<PublicCurriculumSection[]> {
    const rows = await queryRows(
      `select section.id as section_id, section.title as section_title,
              lesson.id as lesson_id, lesson.title as lesson_title, lesson.lesson_type,
              lesson.duration_seconds, lesson.is_preview
       ${PUBLIC_COURSE_FROM}
       inner join public.learning_course_sections section
         on section.course_id = course.id
        and section.removed_at is null
       inner join public.learning_lessons lesson
         on lesson.section_id = section.id
        and lesson.is_published = true
        and lesson.removed_at is null
       where course.id = $1
         and course.revision_of_course_id is null
         and ${courseOpenToNewLearnersSql()}
       order by section.position asc, section.id asc, lesson.position asc, lesson.id asc`,
      [courseId],
    ) as CurriculumRow[]

    const sections: PublicCurriculumSection[] = []
    const byId = new Map<string, PublicCurriculumSection>()
    for (const row of rows) {
      let section = byId.get(row.section_id)
      if (!section) {
        section = { title: row.section_title, lessons: [] }
        byId.set(row.section_id, section)
        sections.push(section)
      }
      section.lessons.push({
        id: row.lesson_id,
        title: row.lesson_title,
        lessonType: row.lesson_type,
        durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
        preview: row.is_preview && (PREVIEWABLE_LESSON_TYPES as readonly string[]).includes(row.lesson_type),
      })
    }
    return sections
  }

  /**
   * A free-preview material, for anyone. Null unless the course is open to new learners and the
   * material is published, not removed, marked "Free preview" and a read-or-watch type.
   */
  async function getPreviewLesson(slug: string, lessonId: string): Promise<PreviewLesson | null> {
    const rows = await queryRows(
      `select course.id as course_id, course.slug as course_slug, course.title as course_title,
              lesson.id as lesson_id, lesson.title as lesson_title, lesson.lesson_type, lesson.summary,
              lesson.article_body, lesson.article_format, lesson.asset_path, lesson.external_url,
              lesson.embed_kind, lesson.duration_seconds, lesson.is_downloadable, lesson.caption_path
       ${PUBLIC_COURSE_FROM}
       inner join public.learning_course_sections section
         on section.course_id = course.id
        and section.removed_at is null
       inner join public.learning_lessons lesson
         on lesson.section_id = section.id
       where course.slug = $1
         and lesson.id = $2
         and course.revision_of_course_id is null
         and ${courseOpenToNewLearnersSql()}
         and lesson.is_preview = true
         and lesson.is_published = true
         and lesson.removed_at is null
         and lesson.lesson_type = any($3::text[])
       limit 1`,
      [slug, lessonId, [...PREVIEWABLE_LESSON_TYPES]],
    ) as PreviewRow[]
    const row = rows[0]
    if (!row) return null
    return {
      course: { id: row.course_id, slug: row.course_slug, title: row.course_title },
      lesson: {
        id: row.lesson_id,
        title: row.lesson_title,
        lessonType: row.lesson_type,
        summary: row.summary,
        articleBody: row.article_body,
        articleFormat: row.article_format === 'html' ? 'html' : 'plain',
        assetPath: row.asset_path,
        externalUrl: row.external_url,
        embedKind: row.embed_kind,
        durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
        isDownloadable: row.is_downloadable,
        captionPath: row.caption_path,
      },
    }
  }

  /** Whether a storage path is the thumbnail of a course anyone can see (for the public cover image). */
  async function isPublicCourseThumbnail(storagePath: string) {
    const rows = await queryRows(
      `select 1 as found
       ${PUBLIC_COURSE_FROM}
       where course.thumbnail_path = $1
         and course.revision_of_course_id is null
         and ${courseOpenToNewLearnersSql()}
       limit 1`,
      [storagePath],
    )
    return rows.length > 0
  }

  /** Public courses for the sitemap: address and last change. */
  async function listPublicCourseUrls(limit = 5000) {
    const rows = await queryRows(
      `select course.slug, course.updated_at
       ${PUBLIC_COURSE_FROM}
       where course.revision_of_course_id is null
         and course.is_discoverable = true
         and ${courseOpenToNewLearnersSql()}
       order by course.published_at desc nulls last, course.id desc
       limit $1`,
      [limit],
    ) as Array<QueryResultRow & { slug: string; updated_at: string | Date }>
    return rows.map((row) => ({
      slug: row.slug,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    }))
  }

  return { getPublicCurriculum, getPreviewLesson, isPublicCourseThumbnail, listPublicCourseUrls }
}

export const publicCourseRepository = createPublicCourseRepository()
