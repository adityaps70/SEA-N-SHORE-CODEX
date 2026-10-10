import type { QueryResultRow } from 'pg'
import {
  snapshotDetailsFromRow,
  snapshotSectionsFromRows,
  type CourseReviewSnapshot,
  type SnapshotCurriculumRow,
} from './course-review-snapshot'

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

/**
 * Every curriculum row a review snapshot (and the submission readiness check) is built from:
 * sections, materials and quiz content that are not removed, with each material's settings.
 * One query for both, so what a reviewer is shown is what was checked.
 */
export const COURSE_CURRICULUM_ROWS_SQL = `select
   section.id as section_id,
   section.title as section_title,
   section.position as section_position,
   lesson.id as lesson_id,
   lesson.title as lesson_title,
   lesson.lesson_type,
   lesson.position as lesson_position,
   lesson.article_body,
   lesson.article_format,
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
   lesson.completion_rule,
   lesson.completion_threshold,
   lesson.max_attempts,
   lesson.embed_kind,
   lesson.caption_path,
   assignment.instructions as assignment_instructions,
   assignment.accepted_extensions as assignment_extensions,
   assignment.max_upload_bytes as assignment_max_upload_bytes,
   assignment.max_files as assignment_max_files,
   assignment.max_points as assignment_max_points,
   assignment.passing_percentage as assignment_passing_percentage,
   scorm.status as scorm_status,
   scorm.source_zip_path as scorm_source_zip_path,
   scorm.launch_path as scorm_launch_path,
   scorm.processing_error as scorm_processing_error,
   quiz.id as quiz_id,
   quiz.pass_percentage,
   question.id as question_id,
   question.position as question_position,
   option.id as option_id,
   option.is_correct as option_is_correct,
   lesson.summary as lesson_summary,
   quiz.instructions as quiz_instructions,
   question.prompt as question_prompt,
   option.label as option_label,
   lesson.certificate_final,
   quiz.time_limit_minutes,
   quiz.shuffle_questions,
   quiz.shuffle_options,
   quiz.draw_count,
   quiz.answer_policy,
   question.question_type,
   question.marks,
   question.negative_marks,
   question.explanation,
   question.accepted_answers,
   question.answers_case_sensitive
 from public.learning_course_sections section
 left join public.learning_lessons lesson
   on lesson.section_id = section.id
  and lesson.removed_at is null
 left join public.learning_assignments assignment
   on assignment.lesson_id = lesson.id
 left join public.learning_scorm_packages scorm
   on scorm.lesson_id = lesson.id
 left join public.learning_quizzes quiz
   on quiz.lesson_id = lesson.id
 left join public.learning_quiz_questions question
   on question.quiz_id = quiz.id
  and question.removed_at is null
 left join public.learning_quiz_options option
   on option.question_id = question.id
  and option.removed_at is null
 where section.course_id = $1
   and section.removed_at is null
 order by
   section.position asc,
   section.id asc,
   lesson.position asc nulls last,
   lesson.id asc nulls last,
   question.position asc nulls last,
   question.id asc nulls last,
   option.position asc nulls last,
   option.id asc nulls last`

/** Course columns a snapshot's details are built from. */
export const COURSE_SNAPSHOT_DETAIL_COLUMNS = `course.slug, course.title, course.subtitle, course.description,
  course.category, course.level, course.language, course.thumbnail_path, course.trailer_path,
  course.learning_outcomes, course.requirements, course.target_audience, course.price_minor,
  course.discount_price_minor, course.currency, course.access_type, course.certificate_enabled,
  course.course_format, course.navigation_mode, course.certificate_template, course.certificate_logo_path,
  course.certificate_signature_path, course.certificate_signatory_name, course.certificate_signatory_title,
  course.certificate_serial_prefix, course.certificate_validity_months, course.certificate_issue_trigger,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'name', plan.name, 'priceMinor', plan.price_minor, 'discountPriceMinor', plan.discount_price_minor,
      'currency', plan.currency, 'accessMonths', plan.access_months
    ) order by plan.position, plan.id), '[]'::jsonb)
   from public.learning_course_plans plan
   where plan.course_id = course.id and plan.archived_at is null) as pricing_plans`

export async function loadCourseCurriculumRows<T extends QueryResultRow = SnapshotCurriculumRow & QueryResultRow>(
  query: Query,
  courseId: string,
) {
  return await query(COURSE_CURRICULUM_ROWS_SQL, [courseId]) as T[]
}

/** The current state of a course as a review snapshot (no lock; for showing a diff). */
export async function loadCourseSnapshot(query: Query, courseId: string): Promise<CourseReviewSnapshot | null> {
  const details = await query(
    `select ${COURSE_SNAPSHOT_DETAIL_COLUMNS} from public.learning_courses course where course.id = $1`,
    [courseId],
  )
  if (!details[0]) return null
  const rows = await loadCourseCurriculumRows(query, courseId)
  return {
    version: 1,
    details: snapshotDetailsFromRow(details[0]),
    sections: snapshotSectionsFromRows(rows),
  }
}
