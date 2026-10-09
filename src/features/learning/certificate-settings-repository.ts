import type { QueryResultRow } from 'pg'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { courseManagerAccessSql } from './course-access'
import { canMentorEditCourse, type CourseStatus } from './course-workflow'
import type { CourseCertificateSettings } from './certificate-settings'

/**
 * Learning round B (B4): saves a course's certificate settings. Like every course edit, it works on a draft (or a
 * draft revision of a published course), so changes to a live course go through review.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

export function createCertificateSettingsRepository(input: { transaction?: Transaction } = {}) {
  const transaction = input.transaction ?? runtimeTransaction

  async function save(actorId: string, courseId: string, settings: CourseCertificateSettings) {
    return transaction(async (query) => {
      const rows = await query(
        `select course.id, course.status, course.revision_closed_at
         from public.learning_courses course
         where course.id = $1 and ${courseManagerAccessSql('course', '$2')}
         for update`,
        [courseId, actorId],
      )
      const course = rows[0]
      if (!course) throw new Error('course_not_found')
      if (!canMentorEditCourse(course.status as CourseStatus) || course.revision_closed_at) throw new Error('course_edit_forbidden')

      if (settings.finalLessonId) {
        const lesson = await query(
          `select lesson.id
           from public.learning_lessons lesson
           inner join public.learning_course_sections section on section.id = lesson.section_id
           where lesson.id = $1 and section.course_id = $2 and lesson.lesson_type = 'quiz' and lesson.removed_at is null
           limit 1`,
          [settings.finalLessonId, courseId],
        )
        if (!lesson[0]) throw new Error('certificate_final_quiz_invalid')
      }

      await query(
        `update public.learning_courses
         set certificate_template = $2, certificate_logo_path = $3, certificate_signature_path = $4,
             certificate_signatory_name = $5, certificate_signatory_title = $6, certificate_serial_prefix = $7,
             certificate_validity_months = $8, certificate_issue_trigger = $9, updated_at = now()
         where id = $1`,
        [
          courseId,
          settings.template,
          settings.logoPath,
          settings.signaturePath,
          settings.signatoryName,
          settings.signatoryTitle,
          settings.serialPrefix,
          settings.validityMonths,
          settings.issueTrigger,
        ],
      )
      // One final quiz per course (only meaningful when the trigger is final_quiz).
      const finalLessonId = settings.issueTrigger === 'final_quiz' ? settings.finalLessonId : null
      await query(
        `update public.learning_lessons lesson
         set certificate_final = (lesson.id is not distinct from $2::uuid), updated_at = now()
         from public.learning_course_sections section
         where section.id = lesson.section_id
           and section.course_id = $1
           and lesson.certificate_final is distinct from (lesson.id is not distinct from $2::uuid)`,
        [courseId, finalLessonId],
      )
      return true
    })
  }

  return { save }
}

export const certificateSettingsRepository = createCertificateSettingsRepository()
