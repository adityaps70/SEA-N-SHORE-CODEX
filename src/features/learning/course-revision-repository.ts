import type { QueryResultRow } from 'pg'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { courseManagerAccessSql } from './course-access'
import { diffCourseSnapshots, type CourseReviewSnapshot } from './course-review-snapshot'
import { loadCourseSnapshot } from './course-snapshot-query'
import { questionDetailsFromRow, quizSettingsFromRow, saveQuizSettings } from './quiz-definition'
import { MOVE_ASIDE_OFFSET, retireLessons, retireSection, writeQuizQuestions } from './curriculum-history'
import { finalizeEnrollmentIfComplete } from './learner-progress-repository'
import { applyRevisionPlansWithQuery, clonePlansIntoRevisionWithQuery } from './course-plan-repository'

/**
 * Editing a published course without touching what learners see.
 *
 * Starting an edit copies the live course into a draft revision: a private learning_courses row
 * (revision_of_course_id = the live course) with copies of its sections, materials, quizzes,
 * assignments and SCORM packages. Every copied row records the live row it came from in
 * revision_source_id. The trainer edits the revision with the ordinary draft editor and submits it
 * through the ordinary review workflow.
 *
 * When a reviewer approves it, the revision is applied onto the live course in place: rows with a
 * source are updated (their ids, and the learner progress and attempts keyed by them, never
 * change), new rows are inserted, and live rows the revision no longer has are retired (hidden,
 * unpublished, history kept). Already-issued certificates are never touched; a price change only
 * affects new purchases (orders store the price they were paid at).
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>
type IdRow = QueryResultRow & { id: string }

type RevisionCourseRow = QueryResultRow & {
  id: string
  status: string
  revision_of_course_id: string | null
  revision_closed_at: string | Date | null
  removed_at?: string | Date | null
}

type SectionRow = QueryResultRow & { id: string; title: string; revision_source_id: string | null }
type LessonRow = QueryResultRow & {
  id: string
  section_id: string
  revision_source_id: string | null
  prerequisite_lesson_id: string | null
}
type QuestionRow = QueryResultRow & { id: string; quiz_id: string; prompt: string; revision_source_id: string | null }
type OptionRow = QueryResultRow & {
  id: string
  question_id: string
  label: string
  is_correct: boolean
  revision_source_id: string | null
}

export class CourseRevisionError extends Error {
  constructor(code:
    | 'course_not_found'
    | 'course_revision_not_published'
    | 'course_revision_of_revision'
    | 'course_revision_not_found'
    | 'course_revision_closed'
    | 'course_revision_in_review') {
    super(code)
    this.name = 'CourseRevisionError'
  }
}

/** Material columns copied from the live course into a revision, and back on approval. */
const LESSON_CONTENT_COLUMNS = [
  'title', 'lesson_type', 'summary', 'article_body', 'article_format', 'asset_path', 'external_url',
  'duration_seconds', 'is_preview', 'is_downloadable', 'is_published', 'release_mode', 'release_at',
  'drip_delay_days', 'completion_rule', 'completion_threshold', 'max_attempts', 'embed_kind', 'caption_path',
  'certificate_final',
] as const

/** Course detail columns a revision edits; the slug, owner and status stay with the live course. */
const COURSE_DETAIL_COLUMNS = [
  'title', 'subtitle', 'description', 'category', 'level', 'language', 'thumbnail_path', 'trailer_path',
  'learning_outcomes', 'requirements', 'target_audience', 'price_minor', 'discount_price_minor', 'currency',
  'access_type', 'certificate_enabled', 'course_format', 'navigation_mode',
  'certificate_template', 'certificate_logo_path', 'certificate_signature_path', 'certificate_signatory_name',
  'certificate_signatory_title', 'certificate_serial_prefix', 'certificate_validity_months', 'certificate_issue_trigger',
] as const

/** Round B quiz settings, copied with the quiz. */
const QUIZ_SETTING_COLUMNS = ['time_limit_minutes', 'shuffle_questions', 'shuffle_options', 'draw_count', 'answer_policy'] as const

/** Round B question columns, copied with each question. */
const QUESTION_DETAIL_COLUMNS = [
  'question_type', 'marks', 'negative_marks', 'explanation', 'accepted_answers', 'answers_case_sensitive',
  'topic', 'difficulty', 'department_key', 'role_key', 'source_question_id',
] as const

const ASSIGNMENT_COLUMNS = [
  'instructions', 'accepted_extensions', 'max_upload_bytes', 'max_files', 'max_points', 'passing_percentage',
] as const

const SCORM_COLUMNS = [
  'source_zip_path', 'extracted_prefix', 'manifest_path', 'launch_path', 'scorm_version', 'status',
  'processing_error', 'manifest_metadata',
] as const

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

/** Copies a live course into a new draft revision. Returns the revision's course id. */
async function cloneCourseIntoRevision(query: Query, liveCourseId: string) {
  const inserted = await query(
    `insert into public.learning_courses (
       mentor_id, created_by_user_id, company_id, slug, status, revision_of_course_id,
       ${COURSE_DETAIL_COLUMNS.join(', ')},
       created_at, updated_at
     )
     select
       live.mentor_id, live.created_by_user_id, live.company_id,
       rtrim(left(live.slug, 100), '-') || '-draft-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
       'draft', live.id,
       ${COURSE_DETAIL_COLUMNS.map((column) => `live.${column}`).join(', ')},
       now(), now()
     from public.learning_courses live
     where live.id = $1
     returning id`,
    [liveCourseId],
  ) as IdRow[]
  const revisionId = inserted[0]?.id
  if (!revisionId) throw new Error('course_revision_create_failed')

  await query(
    `insert into public.learning_course_sections (course_id, title, position, revision_source_id, created_at, updated_at)
     select $2, section.title,
            (row_number() over (order by section.position, section.id) - 1)::integer,
            section.id, now(), now()
     from public.learning_course_sections section
     where section.course_id = $1
       and section.removed_at is null`,
    [liveCourseId, revisionId],
  )

  await query(
    `insert into public.learning_lessons (
       section_id, position, revision_source_id, ${LESSON_CONTENT_COLUMNS.join(', ')}, created_at, updated_at
     )
     select revision_section.id,
            (row_number() over (partition by lesson.section_id order by lesson.position, lesson.id) - 1)::integer,
            lesson.id,
            ${LESSON_CONTENT_COLUMNS.map((column) => `lesson.${column}`).join(', ')},
            now(), now()
     from public.learning_lessons lesson
     inner join public.learning_course_sections live_section
       on live_section.id = lesson.section_id
      and live_section.course_id = $1
     inner join public.learning_course_sections revision_section
       on revision_section.revision_source_id = live_section.id
      and revision_section.course_id = $2
     where lesson.removed_at is null`,
    [liveCourseId, revisionId],
  )

  // Prerequisites point at the revision's own copy of the prerequisite material.
  await query(
    `update public.learning_lessons revision_lesson
     set prerequisite_lesson_id = revision_prerequisite.id
     from public.learning_course_sections revision_section,
          public.learning_lessons live_lesson,
          public.learning_lessons revision_prerequisite,
          public.learning_course_sections prerequisite_section
     where revision_section.id = revision_lesson.section_id
       and revision_section.course_id = $1
       and live_lesson.id = revision_lesson.revision_source_id
       and revision_prerequisite.revision_source_id = live_lesson.prerequisite_lesson_id
       and prerequisite_section.id = revision_prerequisite.section_id
       and prerequisite_section.course_id = $1`,
    [revisionId],
  )

  await query(
    `insert into public.learning_quizzes (lesson_id, pass_percentage, instructions, ${QUIZ_SETTING_COLUMNS.join(', ')}, created_at, updated_at)
     select revision_lesson.id, quiz.pass_percentage, quiz.instructions, ${QUIZ_SETTING_COLUMNS.map((column) => `quiz.${column}`).join(', ')}, now(), now()
     from public.learning_quizzes quiz
     inner join public.learning_lessons revision_lesson on revision_lesson.revision_source_id = quiz.lesson_id
     inner join public.learning_course_sections revision_section
       on revision_section.id = revision_lesson.section_id
      and revision_section.course_id = $1`,
    [revisionId],
  )

  await query(
    `insert into public.learning_quiz_questions (quiz_id, prompt, position, revision_source_id, ${QUESTION_DETAIL_COLUMNS.join(', ')}, created_at, updated_at)
     select revision_quiz.id, question.prompt,
            (row_number() over (partition by question.quiz_id order by question.position, question.id) - 1)::integer,
            question.id, ${QUESTION_DETAIL_COLUMNS.map((column) => `question.${column}`).join(', ')}, now(), now()
     from public.learning_quiz_questions question
     inner join public.learning_quizzes live_quiz on live_quiz.id = question.quiz_id
     inner join public.learning_lessons revision_lesson on revision_lesson.revision_source_id = live_quiz.lesson_id
     inner join public.learning_course_sections revision_section
       on revision_section.id = revision_lesson.section_id
      and revision_section.course_id = $1
     inner join public.learning_quizzes revision_quiz on revision_quiz.lesson_id = revision_lesson.id
     where question.removed_at is null`,
    [revisionId],
  )

  await query(
    `insert into public.learning_quiz_options (question_id, label, position, is_correct, revision_source_id, created_at, updated_at)
     select revision_question.id, option.label,
            (row_number() over (partition by option.question_id order by option.position, option.id) - 1)::integer,
            option.is_correct, option.id, now(), now()
     from public.learning_quiz_options option
     inner join public.learning_quiz_questions revision_question on revision_question.revision_source_id = option.question_id
     inner join public.learning_quizzes revision_quiz on revision_quiz.id = revision_question.quiz_id
     inner join public.learning_lessons revision_lesson on revision_lesson.id = revision_quiz.lesson_id
     inner join public.learning_course_sections revision_section
       on revision_section.id = revision_lesson.section_id
      and revision_section.course_id = $1
     where option.removed_at is null`,
    [revisionId],
  )

  await query(
    `insert into public.learning_assignments (lesson_id, ${ASSIGNMENT_COLUMNS.join(', ')}, created_at, updated_at)
     select revision_lesson.id, ${ASSIGNMENT_COLUMNS.map((column) => `assignment.${column}`).join(', ')}, now(), now()
     from public.learning_assignments assignment
     inner join public.learning_lessons revision_lesson on revision_lesson.revision_source_id = assignment.lesson_id
     inner join public.learning_course_sections revision_section
       on revision_section.id = revision_lesson.section_id
      and revision_section.course_id = $1
     where revision_lesson.lesson_type = 'assignment'`,
    [revisionId],
  )

  await query(
    `insert into public.learning_scorm_packages (lesson_id, ${SCORM_COLUMNS.join(', ')}, created_at, updated_at)
     select revision_lesson.id, ${SCORM_COLUMNS.map((column) => `package.${column}`).join(', ')}, now(), now()
     from public.learning_scorm_packages package
     inner join public.learning_lessons revision_lesson on revision_lesson.revision_source_id = package.lesson_id
     inner join public.learning_course_sections revision_section
       on revision_section.id = revision_lesson.section_id
      and revision_section.course_id = $1
     where revision_lesson.lesson_type = 'scorm'`,
    [revisionId],
  )

  // Round C (C3): pricing plans travel with the revision (each copy remembers the live plan it came from).
  await clonePlansIntoRevisionWithQuery(query, liveCourseId, revisionId)

  return revisionId
}

/**
 * Applies an approved revision onto its live course, in place, inside the caller's transaction.
 * Returns the live course id.
 */
export async function applyCourseRevisionWithQuery(query: Query, revisionCourseId: string) {
  const revisionRows = await query(
    `select id, status, revision_of_course_id, revision_closed_at
     from public.learning_courses
     where id = $1
     for update`,
    [revisionCourseId],
  ) as RevisionCourseRow[]
  const revision = revisionRows[0]
  if (!revision?.revision_of_course_id) throw new CourseRevisionError('course_revision_not_found')
  if (revision.revision_closed_at) throw new CourseRevisionError('course_revision_closed')
  const liveCourseId = revision.revision_of_course_id

  const liveRows = await query(
    `select id, status, revision_of_course_id, revision_closed_at, removed_at
     from public.learning_courses
     where id = $1
     for update`,
    [liveCourseId],
  ) as RevisionCourseRow[]
  if (!liveRows[0]) throw new CourseRevisionError('course_not_found')

  // 1. Course details. Slug, owner, status and publication dates stay with the live course.
  await query(
    `update public.learning_courses live
     set ${COURSE_DETAIL_COLUMNS.map((column) => `${column} = revision.${column}`).join(',\n         ')},
         details_revision = live.details_revision + 1,
         updated_at = now()
     from public.learning_courses revision
     where live.id = $1
       and revision.id = $2`,
    [liveCourseId, revisionCourseId],
  )

  // 1b. Pricing plans (round C). Live plan ids never change; dropped plans are archived for the orders that bought them.
  await applyRevisionPlansWithQuery(query, revisionCourseId, liveCourseId)

  // 2. Sections. Live sections move aside first so final positions are free to take.
  const liveSections = await query(
    `select id from public.learning_course_sections where course_id = $1 and removed_at is null for update`,
    [liveCourseId],
  ) as IdRow[]
  const liveSectionIds = new Set(liveSections.map((row) => row.id))
  await query(
    `update public.learning_course_sections
     set position = position + $2
     where course_id = $1 and removed_at is null and position < $2`,
    [liveCourseId, MOVE_ASIDE_OFFSET],
  )
  const revisionSections = await query(
    `select id, title, revision_source_id
     from public.learning_course_sections
     where course_id = $1 and removed_at is null
     order by position asc, id asc`,
    [revisionCourseId],
  ) as SectionRow[]
  const sectionMap = new Map<string, string>()
  for (const [position, section] of revisionSections.entries()) {
    const source = section.revision_source_id
    if (source && liveSectionIds.has(source) && ![...sectionMap.values()].includes(source)) {
      await query(
        `update public.learning_course_sections set title = $2, position = $3, updated_at = now() where id = $1 returning id`,
        [source, section.title, position],
      )
      sectionMap.set(section.id, source)
    } else {
      const inserted = await query(
        `insert into public.learning_course_sections (course_id, title, position, created_at, updated_at)
         values ($1, $2, $3, now(), now())
         returning id`,
        [liveCourseId, section.title, position],
      ) as IdRow[]
      if (!inserted[0]) throw new Error('course_revision_apply_failed')
      sectionMap.set(section.id, inserted[0].id)
    }
  }
  const keptSections = new Set(sectionMap.values())

  // 3. Materials, the same way. Live materials stay where they are until renumbered.
  const liveLessons = await query(
    `select lesson.id, lesson.section_id, lesson.revision_source_id, lesson.prerequisite_lesson_id
     from public.learning_lessons lesson
     inner join public.learning_course_sections section on section.id = lesson.section_id
     where section.course_id = $1 and lesson.removed_at is null
     for update of lesson`,
    [liveCourseId],
  ) as LessonRow[]
  const liveLessonIds = new Set(liveLessons.map((row) => row.id))
  await query(
    `update public.learning_lessons lesson
     set position = lesson.position + $2
     from public.learning_course_sections section
     where section.id = lesson.section_id
       and section.course_id = $1
       and lesson.removed_at is null
       and lesson.position < $2`,
    [liveCourseId, MOVE_ASIDE_OFFSET],
  )
  const revisionLessons = await query(
    `select lesson.id, lesson.section_id, lesson.revision_source_id, lesson.prerequisite_lesson_id
     from public.learning_lessons lesson
     inner join public.learning_course_sections section on section.id = lesson.section_id
     where section.course_id = $1 and section.removed_at is null and lesson.removed_at is null
     order by section.position asc, section.id asc, lesson.position asc, lesson.id asc`,
    [revisionCourseId],
  ) as LessonRow[]
  const lessonMap = new Map<string, string>()
  const nextPosition = new Map<string, number>()
  for (const lesson of revisionLessons) {
    const liveSectionId = sectionMap.get(lesson.section_id)
    if (!liveSectionId) continue
    const position = nextPosition.get(liveSectionId) ?? 0
    nextPosition.set(liveSectionId, position + 1)
    const source = lesson.revision_source_id
    if (source && liveLessonIds.has(source) && ![...lessonMap.values()].includes(source)) {
      await query(
        `update public.learning_lessons live
         set section_id = $3,
             position = $4,
             ${LESSON_CONTENT_COLUMNS.map((column) => `${column} = revision.${column}`).join(',\n             ')},
             updated_at = now()
         from public.learning_lessons revision
         where live.id = $1
           and revision.id = $2
         returning live.id`,
        [source, lesson.id, liveSectionId, position],
      )
      lessonMap.set(lesson.id, source)
    } else {
      const inserted = await query(
        `insert into public.learning_lessons (section_id, position, ${LESSON_CONTENT_COLUMNS.join(', ')}, created_at, updated_at)
         select $2, $3, ${LESSON_CONTENT_COLUMNS.map((column) => `revision.${column}`).join(', ')}, now(), now()
         from public.learning_lessons revision
         where revision.id = $1
         returning id`,
        [lesson.id, liveSectionId, position],
      ) as IdRow[]
      if (!inserted[0]) throw new Error('course_revision_apply_failed')
      lessonMap.set(lesson.id, inserted[0].id)
    }
  }

  // Materials the revision no longer has are retired; sections too.
  const keptLessons = new Set(lessonMap.values())
  await retireLessons(query, liveLessons.filter((lesson) => !keptLessons.has(lesson.id)).map((lesson) => lesson.id))
  for (const sectionId of liveSectionIds) {
    if (!keptSections.has(sectionId)) await retireSection(query, sectionId)
  }

  // Prerequisites, mapped onto live ids.
  for (const lesson of revisionLessons) {
    const liveId = lessonMap.get(lesson.id)
    if (!liveId) continue
    const prerequisite = lesson.prerequisite_lesson_id ? lessonMap.get(lesson.prerequisite_lesson_id) ?? null : null
    await query(
      `update public.learning_lessons set prerequisite_lesson_id = $2 where id = $1 returning id`,
      [liveId, prerequisite],
    )
  }

  // 4. Quizzes, assignments and SCORM packages of each material, updated in place.
  for (const [revisionLessonId, liveLessonId] of lessonMap) {
    await applyQuiz(query, revisionLessonId, liveLessonId)
    await query(
      `insert into public.learning_assignments (lesson_id, ${ASSIGNMENT_COLUMNS.join(', ')}, created_at, updated_at)
       select $2, ${ASSIGNMENT_COLUMNS.map((column) => `revision.${column}`).join(', ')}, now(), now()
       from public.learning_assignments revision
       where revision.lesson_id = $1
       on conflict (lesson_id) do update
       set ${ASSIGNMENT_COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')},
           updated_at = now()`,
      [revisionLessonId, liveLessonId],
    )
    await query(
      `insert into public.learning_scorm_packages (lesson_id, ${SCORM_COLUMNS.join(', ')}, created_at, updated_at)
       select $2, ${SCORM_COLUMNS.map((column) => `revision.${column}`).join(', ')}, now(), now()
       from public.learning_scorm_packages revision
       where revision.lesson_id = $1
       on conflict (lesson_id) do update
       set ${SCORM_COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')},
           updated_at = now()`,
      [revisionLessonId, liveLessonId],
    )
  }

  // 5. The revision is done; it stays as a read-only record.
  await query(
    `update public.learning_courses
     set status = 'archived',
         revision_closed_at = now(),
         revision_outcome = 'merged',
         updated_at = now()
     where id = $1
     returning id`,
    [revisionCourseId],
  )

  // 6. A learner who has now completed every remaining material (for example because the one
  // they had left was removed) completes the course and gets their certificate.
  const finishing = await query(
    `select enrollment.id
     from public.learning_enrollments enrollment
     where enrollment.course_id = $1
       and enrollment.status = 'active'
       and exists (
         select 1
         from public.learning_lessons lesson
         inner join public.learning_course_sections section on section.id = lesson.section_id
         where section.course_id = $1 and lesson.is_published = true
       )
       and not exists (
         select 1
         from public.learning_lessons lesson
         inner join public.learning_course_sections section on section.id = lesson.section_id
         left join public.learning_progress progress
           on progress.lesson_id = lesson.id
          and progress.enrollment_id = enrollment.id
         where section.course_id = $1
           and lesson.is_published = true
           and coalesce(progress.completed, false) = false
       )`,
    [liveCourseId],
  ) as IdRow[]
  for (const enrollment of finishing) {
    await finalizeEnrollmentIfComplete(query, enrollment.id, liveCourseId)
  }

  return { liveCourseId }
}

async function applyQuiz(query: Query, revisionLessonId: string, liveLessonId: string) {
  const revisionQuiz = await query(
    `select id, pass_percentage, instructions, ${QUIZ_SETTING_COLUMNS.join(', ')} from public.learning_quizzes where lesson_id = $1`,
    [revisionLessonId],
  ) as Array<IdRow & { pass_percentage: number; instructions: string | null } & Parameters<typeof quizSettingsFromRow>[0]>
  const quiz = revisionQuiz[0]
  if (!quiz) return

  const liveQuiz = await query(
    `insert into public.learning_quizzes (lesson_id, pass_percentage, instructions, created_at, updated_at)
     values ($1, $2, $3, now(), now())
     on conflict (lesson_id) do update
     set pass_percentage = excluded.pass_percentage,
         instructions = excluded.instructions,
         updated_at = now()
     returning id`,
    [liveLessonId, quiz.pass_percentage, quiz.instructions],
  ) as IdRow[]
  const liveQuizId = liveQuiz[0]?.id
  if (!liveQuizId) throw new Error('course_revision_apply_failed')
  await saveQuizSettings(query, liveQuizId, quizSettingsFromRow(quiz))

  const liveQuestions = await query(
    `select id from public.learning_quiz_questions where quiz_id = $1 and removed_at is null`,
    [liveQuizId],
  ) as IdRow[]
  const liveQuestionIds = new Set(liveQuestions.map((row) => row.id))
  const liveOptions = await query(
    `select option.id
     from public.learning_quiz_options option
     inner join public.learning_quiz_questions question on question.id = option.question_id
     where question.quiz_id = $1 and option.removed_at is null`,
    [liveQuizId],
  ) as IdRow[]
  const liveOptionIds = new Set(liveOptions.map((row) => row.id))

  const questions = await query(
    `select id, quiz_id, prompt, revision_source_id, ${QUESTION_DETAIL_COLUMNS.join(', ')}
     from public.learning_quiz_questions
     where quiz_id = $1 and removed_at is null
     order by position asc, id asc`,
    [quiz.id],
  ) as QuestionRow[]
  const options = await query(
    `select option.id, option.question_id, option.label, option.is_correct, option.revision_source_id
     from public.learning_quiz_options option
     inner join public.learning_quiz_questions question on question.id = option.question_id
     where question.quiz_id = $1 and question.removed_at is null and option.removed_at is null
     order by option.position asc, option.id asc`,
    [quiz.id],
  ) as OptionRow[]

  // A question keeps its live id when it came from this live quiz; an option keeps its live id when
  // it came from the same live question.
  await writeQuizQuestions(query, liveQuizId, questions.map((question) => {
    const liveQuestionId = question.revision_source_id && liveQuestionIds.has(question.revision_source_id)
      ? question.revision_source_id
      : null
    return {
      id: liveQuestionId,
      prompt: question.prompt,
      ...questionDetailsFromRow(question),
      options: options
        .filter((option) => option.question_id === question.id)
        .map((option) => ({
          id: liveQuestionId && option.revision_source_id && liveOptionIds.has(option.revision_source_id)
            ? option.revision_source_id
            : null,
          label: option.label,
          isCorrect: option.is_correct,
        })),
    }
  }))
}

export function createCourseRevisionRepository(input: { transaction?: Transaction } = {}) {
  const transaction = input.transaction ?? runtimeTransaction

  /**
   * Opens (or reopens) the draft revision of a published course the actor manages. Only one draft
   * revision is open per course at a time.
   */
  async function startRevision(actorId: string, liveCourseId: string) {
    return transaction(async (query) => {
      const rows = await query(
        `select course.id, course.status, course.revision_of_course_id, course.revision_closed_at, course.removed_at
         from public.learning_courses course
         where course.id = $1
           and ${courseManagerAccessSql('course', '$2')}
         for update`,
        [liveCourseId, actorId],
      ) as RevisionCourseRow[]
      const live = rows[0]
      if (!live) throw new CourseRevisionError('course_not_found')
      if (live.revision_of_course_id) throw new CourseRevisionError('course_revision_of_revision')
      if (live.status !== 'published' || live.removed_at) throw new CourseRevisionError('course_revision_not_published')

      const open = await query(
        `select id from public.learning_courses where revision_of_course_id = $1 and revision_closed_at is null limit 1`,
        [liveCourseId],
      ) as IdRow[]
      if (open[0]) return { revisionCourseId: open[0].id, created: false }

      const revisionCourseId = await cloneCourseIntoRevision(query, liveCourseId)
      return { revisionCourseId, created: true }
    })
  }

  /** Throws away a draft revision. The live course is untouched; the copy is kept read-only. */
  async function discardRevision(actorId: string, revisionCourseId: string) {
    return transaction(async (query) => {
      const rows = await query(
        `select course.id, course.status, course.revision_of_course_id, course.revision_closed_at
         from public.learning_courses course
         where course.id = $1
           and ${courseManagerAccessSql('course', '$2')}
         for update`,
        [revisionCourseId, actorId],
      ) as RevisionCourseRow[]
      const revision = rows[0]
      if (!revision?.revision_of_course_id) throw new CourseRevisionError('course_revision_not_found')
      if (revision.revision_closed_at) throw new CourseRevisionError('course_revision_closed')
      if (revision.status === 'submitted') throw new CourseRevisionError('course_revision_in_review')

      await query(
        `update public.learning_courses
         set status = 'archived',
             revision_closed_at = now(),
             revision_outcome = 'discarded',
             updated_at = now()
         where id = $1
         returning id`,
        [revisionCourseId],
      )
      return { liveCourseId: revision.revision_of_course_id }
    })
  }

  return { startRevision, discardRevision }
}

export const courseRevisionRepository = createCourseRevisionRepository()

/**
 * What a revision changes compared with its live course, for the reviewer. Revision rows are
 * mapped back to the live rows they were copied from, so an untouched material is not reported.
 */
export async function revisionChangesFromLiveCourse(query: Query, revisionCourseId: string, liveCourseId: string) {
  const [live, revision] = await Promise.all([
    loadCourseSnapshot(query, liveCourseId),
    loadCourseSnapshot(query, revisionCourseId),
  ])
  if (!live || !revision) return null

  const sources = await query(
    `select section.id, section.revision_source_id from public.learning_course_sections section where section.course_id = $1
     union all
     select lesson.id, lesson.revision_source_id
     from public.learning_lessons lesson
     inner join public.learning_course_sections section on section.id = lesson.section_id
     where section.course_id = $1`,
    [revisionCourseId],
  ) as Array<IdRow & { revision_source_id: string | null }>
  const sourceOf = new Map(sources.filter((row) => row.revision_source_id).map((row) => [row.id, row.revision_source_id!]))
  const mapId = (id: string | null | undefined) => (id ? sourceOf.get(id) ?? id : id ?? null)

  const mapped: CourseReviewSnapshot = {
    ...revision,
    // A revision has its own private slug; the live address never changes through an edit.
    details: { ...revision.details, slug: live.details.slug },
    sections: revision.sections.map((section) => ({
      ...section,
      id: mapId(section.id)!,
      materials: section.materials.map((material) => ({
        ...material,
        id: mapId(material.id)!,
        prerequisiteId: mapId(material.prerequisiteId),
      })),
    })),
  }
  return diffCourseSnapshots(live, mapped)
}
