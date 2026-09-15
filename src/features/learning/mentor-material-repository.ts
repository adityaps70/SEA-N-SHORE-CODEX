import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { canMentorEditCourse, type CourseStatus } from './course-workflow'
import type { MentorQuizDefinition } from './mentor-curriculum-repository'

export type MaterialType =
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

export type MaterialReleaseMode = 'immediate' | 'scheduled' | 'drip'
export type MaterialCompletionRule = 'manual' | 'view' | 'media_percentage' | 'quiz_pass' | 'assignment_submit' | 'scorm_completion'
export type MaterialEmbedKind = 'youtube' | 'vimeo' | 'generic'

export type AssignmentDefinitionInput = {
  instructions: string
  acceptedExtensions: string[]
  maxUploadBytes: number
}

export type MentorMaterialDraft = {
  title: string
  materialType: MaterialType
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
  embedKind: MaterialEmbedKind | null
  assignment: AssignmentDefinitionInput | null
}

export type MentorMaterial = MentorMaterialDraft & {
  id: string
  position: number
  quiz: MentorQuizDefinition | null
  scorm: null | {
    status: 'processing' | 'ready' | 'error'
    version: '1.2' | '2004' | null
    sourceZipPath: string
    launchPath: string | null
    processingError: string | null
  }
}

export type MentorMaterialSection = {
  id: string
  title: string
  position: number
  materials: MentorMaterial[]
}

export type MentorMaterialCurriculum = {
  courseId: string
  status: CourseStatus
  navigationMode: 'free' | 'sequential'
  sections: MentorMaterialSection[]
}

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

type Row = QueryResultRow & {
  course_id: string
  course_status: string
  navigation_mode: string
  section_id: string | null
  section_title: string | null
  section_position: string | number | null
  lesson_id: string | null
  lesson_title: string | null
  lesson_type: string | null
  lesson_position: string | number | null
  lesson_summary: string | null
  article_body: string | null
  asset_path: string | null
  external_url: string | null
  duration_seconds: string | number | null
  is_preview: boolean | null
  is_downloadable: boolean | null
  is_published: boolean | null
  release_mode: string | null
  release_at: string | Date | null
  drip_delay_days: string | number | null
  prerequisite_lesson_id: string | null
  completion_rule: string | null
  completion_threshold: string | number | null
  max_attempts: string | number | null
  embed_kind: string | null
  assignment_instructions: string | null
  assignment_extensions: string[] | null
  assignment_max_upload_bytes: string | number | null
  scorm_status: string | null
  scorm_version: string | null
  scorm_source_zip_path: string | null
  scorm_launch_path: string | null
  scorm_processing_error: string | null
  quiz_id: string | null
  pass_percentage: string | number | null
  quiz_instructions: string | null
  question_id: string | null
  question_prompt: string | null
  question_position: string | number | null
  option_id: string | null
  option_label: string | null
  option_position: string | number | null
  option_is_correct: boolean | null
}

type IdRow = QueryResultRow & { id: string }
type NextPositionRow = QueryResultRow & { next_position: string | number }
type LockedCourseRow = QueryResultRow & { id: string; status: string; mentor_id: string }

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function courseStatus(value: string): CourseStatus {
  if (['draft', 'submitted', 'changes_requested', 'approved', 'published', 'archived'].includes(value)) return value as CourseStatus
  throw new Error('course_status_invalid')
}

function materialType(value: string): MaterialType {
  if (['video', 'article', 'image', 'pdf', 'presentation_document', 'audio', 'external_embed', 'quiz', 'assignment', 'downloadable_resource', 'scorm', 'live_session'].includes(value)) return value as MaterialType
  throw new Error('learning_material_type_invalid')
}

function iso(value: string | Date | null) {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : value
}

async function requireEditableCourse(query: Query, actorId: string, courseId: string) {
  const rows = await query(
    `select course.id, course.status, course.mentor_id
     from public.learning_courses course
     inner join public.learning_mentors mentor on mentor.id = course.mentor_id
     where course.id = $1 and mentor.user_id = $2 and mentor.status = 'active'
     for update`,
    [courseId, actorId],
  ) as LockedCourseRow[]
  const row = rows[0]
  if (!row) throw new Error('course_not_found')
  if (!canMentorEditCourse(courseStatus(row.status))) throw new Error('course_edit_forbidden')
  return row
}

function build(rows: Row[]): MentorMaterialCurriculum | null {
  const first = rows[0]
  if (!first) return null
  const sections: MentorMaterialSection[] = []
  const sectionMap = new Map<string, MentorMaterialSection>()
  const materialMap = new Map<string, MentorMaterial>()
  const questionMap = new Map<string, NonNullable<MentorQuizDefinition>['questions'][number]>()
  const seenOptions = new Set<string>()

  for (const row of rows) {
    if (!row.section_id || row.section_title === null || row.section_position === null) continue
    let section = sectionMap.get(row.section_id)
    if (!section) {
      section = { id: row.section_id, title: row.section_title, position: Number(row.section_position), materials: [] }
      sectionMap.set(row.section_id, section)
      sections.push(section)
    }
    if (!row.lesson_id || row.lesson_title === null || row.lesson_type === null || row.lesson_position === null) continue

    let material = materialMap.get(row.lesson_id)
    if (!material) {
      const quiz: MentorQuizDefinition | null = row.quiz_id && row.pass_percentage !== null
        ? { id: row.quiz_id, passPercentage: Number(row.pass_percentage), instructions: row.quiz_instructions, questions: [] }
        : null
      material = {
        id: row.lesson_id,
        title: row.lesson_title,
        materialType: materialType(row.lesson_type),
        position: Number(row.lesson_position),
        summary: row.lesson_summary,
        articleBody: row.article_body,
        assetPath: row.asset_path,
        externalUrl: row.external_url,
        durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
        isPreview: row.is_preview ?? false,
        isDownloadable: row.is_downloadable ?? false,
        isPublished: row.is_published ?? true,
        releaseMode: (row.release_mode ?? 'immediate') as MaterialReleaseMode,
        releaseAt: iso(row.release_at),
        dripDelayDays: row.drip_delay_days === null ? null : Number(row.drip_delay_days),
        prerequisiteLessonId: row.prerequisite_lesson_id,
        completionRule: (row.completion_rule ?? 'manual') as MaterialCompletionRule,
        completionThreshold: row.completion_threshold === null ? null : Number(row.completion_threshold),
        maxAttempts: row.max_attempts === null ? null : Number(row.max_attempts),
        embedKind: row.embed_kind as MaterialEmbedKind | null,
        assignment: row.assignment_instructions
          ? {
              instructions: row.assignment_instructions,
              acceptedExtensions: row.assignment_extensions ?? [],
              maxUploadBytes: Number(row.assignment_max_upload_bytes ?? 10485760),
            }
          : null,
        scorm: row.scorm_status && row.scorm_source_zip_path
          ? {
              status: row.scorm_status as 'processing' | 'ready' | 'error',
              version: row.scorm_version as '1.2' | '2004' | null,
              sourceZipPath: row.scorm_source_zip_path,
              launchPath: row.scorm_launch_path,
              processingError: row.scorm_processing_error,
            }
          : null,
        quiz,
      }
      materialMap.set(row.lesson_id, material)
      section.materials.push(material)
    }

    if (!material.quiz || !row.question_id || row.question_prompt === null || row.question_position === null) continue
    let question = questionMap.get(row.question_id)
    if (!question) {
      question = { id: row.question_id, prompt: row.question_prompt, position: Number(row.question_position), options: [] }
      questionMap.set(row.question_id, question)
      material.quiz.questions.push(question)
    }
    if (!row.option_id || row.option_label === null || row.option_position === null || row.option_is_correct === null || seenOptions.has(row.option_id)) continue
    question.options.push({ id: row.option_id, label: row.option_label, position: Number(row.option_position), isCorrect: row.option_is_correct })
    seenOptions.add(row.option_id)
  }

  return {
    courseId: first.course_id,
    status: courseStatus(first.course_status),
    navigationMode: first.navigation_mode === 'sequential' ? 'sequential' : 'free',
    sections,
  }
}

async function syncAssignment(query: Query, lessonId: string, assignment: AssignmentDefinitionInput | null) {
  if (!assignment) {
    await query(`delete from public.learning_assignments where lesson_id = $1`, [lessonId])
    return
  }
  await query(
    `insert into public.learning_assignments (lesson_id, instructions, accepted_extensions, max_upload_bytes, created_at, updated_at)
     values ($1, $2, $3, $4, now(), now())
     on conflict (lesson_id) do update
     set instructions = excluded.instructions,
         accepted_extensions = excluded.accepted_extensions,
         max_upload_bytes = excluded.max_upload_bytes,
         updated_at = now()`,
    [lessonId, assignment.instructions, assignment.acceptedExtensions, assignment.maxUploadBytes],
  )
}

function settingsValues(draft: MentorMaterialDraft) {
  return [
    draft.title,
    draft.materialType,
    draft.summary,
    draft.articleBody,
    draft.assetPath,
    draft.externalUrl,
    draft.durationSeconds,
    draft.isPreview,
    draft.isDownloadable,
    draft.isPublished,
    draft.releaseMode,
    draft.releaseAt,
    draft.dripDelayDays,
    draft.prerequisiteLessonId,
    draft.completionRule,
    draft.completionThreshold,
    draft.maxAttempts,
    draft.embedKind,
  ] as const
}

export function createMentorMaterialRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function getCurriculum(actorId: string, courseId: string): Promise<MentorMaterialCurriculum | null> {
    const rows = await queryRows(
      `select
         course.id as course_id, course.status as course_status, course.navigation_mode,
         section.id as section_id, section.title as section_title, section.position as section_position,
         lesson.id as lesson_id, lesson.title as lesson_title, lesson.lesson_type, lesson.position as lesson_position,
         lesson.summary as lesson_summary, lesson.article_body, lesson.asset_path, lesson.external_url,
         lesson.duration_seconds, lesson.is_preview, lesson.is_downloadable, lesson.is_published,
         lesson.release_mode, lesson.release_at, lesson.drip_delay_days, lesson.prerequisite_lesson_id,
         lesson.completion_rule, lesson.completion_threshold, lesson.max_attempts, lesson.embed_kind,
         assignment.instructions as assignment_instructions, assignment.accepted_extensions as assignment_extensions,
         assignment.max_upload_bytes as assignment_max_upload_bytes,
         package.status as scorm_status, package.scorm_version, package.source_zip_path as scorm_source_zip_path,
         package.launch_path as scorm_launch_path, package.processing_error as scorm_processing_error,
         quiz.id as quiz_id, quiz.pass_percentage, quiz.instructions as quiz_instructions,
         question.id as question_id, question.prompt as question_prompt, question.position as question_position,
         option.id as option_id, option.label as option_label, option.position as option_position, option.is_correct as option_is_correct
       from public.learning_courses course
       inner join public.learning_mentors mentor on mentor.id = course.mentor_id
       left join public.learning_course_sections section on section.course_id = course.id
       left join public.learning_lessons lesson on lesson.section_id = section.id
       left join public.learning_assignments assignment on assignment.lesson_id = lesson.id
       left join public.learning_scorm_packages package on package.lesson_id = lesson.id
       left join public.learning_quizzes quiz on quiz.lesson_id = lesson.id
       left join public.learning_quiz_questions question on question.quiz_id = quiz.id
       left join public.learning_quiz_options option on option.question_id = question.id
       where mentor.user_id = $1 and mentor.status = 'active' and course.id = $2
       order by section.position asc nulls last, section.id asc nulls last,
                lesson.position asc nulls last, lesson.id asc nulls last,
                question.position asc nulls last, question.id asc nulls last,
                option.position asc nulls last, option.id asc nulls last`,
      [actorId, courseId],
    ) as Row[]
    return build(rows)
  }

  async function createMaterial(actorId: string, courseId: string, sectionId: string, draft: MentorMaterialDraft) {
    return transaction(async (query) => {
      await requireEditableCourse(query, actorId, courseId)
      const section = await query(
        `select id from public.learning_course_sections where id = $1 and course_id = $2 limit 1`,
        [sectionId, courseId],
      ) as IdRow[]
      if (!section[0]) throw new Error('section_not_found')
      if (draft.prerequisiteLessonId) {
        const prerequisite = await query(
          `select lesson.id from public.learning_lessons lesson
           inner join public.learning_course_sections section on section.id = lesson.section_id
           where lesson.id = $1 and section.course_id = $2 limit 1`,
          [draft.prerequisiteLessonId, courseId],
        ) as IdRow[]
        if (!prerequisite[0]) throw new Error('prerequisite_not_found')
      }
      const positions = await query(
        `select coalesce(max(position), -1) + 1 as next_position from public.learning_lessons where section_id = $1`,
        [sectionId],
      ) as NextPositionRow[]
      const nextPosition = Number(positions[0]?.next_position ?? 0)
      const inserted = await query(
        `insert into public.learning_lessons (
           section_id, title, lesson_type, position, summary, article_body, asset_path, external_url,
           duration_seconds, is_preview, is_downloadable, is_published, release_mode, release_at,
           drip_delay_days, prerequisite_lesson_id, completion_rule, completion_threshold, max_attempts, embed_kind,
           created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
           now(), now()
         ) returning id`,
        [sectionId, draft.title, draft.materialType, nextPosition, ...settingsValues(draft).slice(2)],
      ) as IdRow[]
      const material = inserted[0]
      if (!material) throw new Error('material_create_failed')
      await syncAssignment(query, material.id, draft.materialType === 'assignment' ? draft.assignment : null)
      return { materialId: material.id }
    })
  }

  async function updateMaterial(actorId: string, courseId: string, materialId: string, draft: MentorMaterialDraft) {
    return transaction(async (query) => {
      await requireEditableCourse(query, actorId, courseId)
      if (draft.prerequisiteLessonId === materialId) throw new Error('prerequisite_self')
      if (draft.prerequisiteLessonId) {
        const prerequisite = await query(
          `select lesson.id from public.learning_lessons lesson
           inner join public.learning_course_sections section on section.id = lesson.section_id
           where lesson.id = $1 and section.course_id = $2 limit 1`,
          [draft.prerequisiteLessonId, courseId],
        ) as IdRow[]
        if (!prerequisite[0]) throw new Error('prerequisite_not_found')
      }
      const rows = await query(
        `update public.learning_lessons as lesson
         set title = $3, lesson_type = $4, summary = $5, article_body = $6, asset_path = $7,
             external_url = $8, duration_seconds = $9, is_preview = $10, is_downloadable = $11,
             is_published = $12, release_mode = $13, release_at = $14, drip_delay_days = $15,
             prerequisite_lesson_id = $16, completion_rule = $17, completion_threshold = $18,
             max_attempts = $19, embed_kind = $20, updated_at = now()
         from public.learning_course_sections section
         where lesson.id = $1 and section.course_id = $2 and section.id = lesson.section_id
         returning lesson.id`,
        [materialId, courseId, ...settingsValues(draft)],
      ) as IdRow[]
      if (!rows[0]) throw new Error('material_not_found')
      await syncAssignment(query, materialId, draft.materialType === 'assignment' ? draft.assignment : null)
      if (draft.materialType !== 'scorm') {
        await query(`delete from public.learning_scorm_packages where lesson_id = $1`, [materialId])
      }
      return true
    })
  }

  async function updateNavigationMode(actorId: string, courseId: string, navigationMode: 'free' | 'sequential') {
    return transaction(async (query) => {
      await requireEditableCourse(query, actorId, courseId)
      const rows = await query(
        `update public.learning_courses set navigation_mode = $3, updated_at = now()
         where id = $1 and mentor_id = (select id from public.learning_mentors where user_id = $2 and status = 'active' limit 1)
         returning id`,
        [courseId, actorId, navigationMode],
      ) as IdRow[]
      if (!rows[0]) throw new Error('course_update_failed')
      return true
    })
  }

  return { getCurriculum, createMaterial, updateMaterial, updateNavigationMode }
}

export const mentorMaterialRepository = createMentorMaterialRepository()
