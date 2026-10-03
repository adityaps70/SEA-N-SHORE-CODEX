import type { QueryResultRow } from 'pg'
import {
  query as databaseQuery,
  withTransaction as databaseTransaction,
  type DatabaseQueryClient,
} from '@/lib/db/client'
import { canMentorEditCourse, type CourseStatus } from './course-workflow'
import { courseManagerAccessSql } from './course-access'

export type MentorLessonType =
  | 'video'
  | 'article'
  | 'pdf'
  | 'presentation_document'
  | 'audio'
  | 'quiz'
  | 'assignment'
  | 'downloadable_resource'
  | 'live_session'

export type MentorLessonDraft = {
  title: string
  lessonType: MentorLessonType
  summary: string | null
  articleBody: string | null
  assetPath: string | null
  externalUrl: string | null
  durationSeconds: number | null
  isPreview: boolean
  isDownloadable: boolean
}

export type MentorQuizDefinitionInput = {
  passPercentage: number
  instructions: string | null
  questions: Array<{
    prompt: string
    options: Array<{
      label: string
      isCorrect: boolean
    }>
  }>
}

export type MentorQuizOption = {
  id: string
  label: string
  position: number
  isCorrect: boolean
}

export type MentorQuizQuestion = {
  id: string
  prompt: string
  position: number
  options: MentorQuizOption[]
}

export type MentorQuizDefinition = {
  id: string
  passPercentage: number
  instructions: string | null
  questions: MentorQuizQuestion[]
}

export type MentorCurriculumLesson = MentorLessonDraft & {
  id: string
  position: number
  quiz: MentorQuizDefinition | null
}

export type MentorCurriculumSection = {
  id: string
  title: string
  position: number
  lessons: MentorCurriculumLesson[]
}

export type MentorCurriculum = {
  courseId: string
  status: CourseStatus
  sections: MentorCurriculumSection[]
}

type CurriculumQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type CurriculumTransaction = <T>(work: (query: CurriculumQuery) => Promise<T>) => Promise<T>

type CurriculumRow = QueryResultRow & {
  course_id: string
  course_status: string
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

type LockedCourseRow = QueryResultRow & {
  id: string
  mentor_id: string | null
  status: string
}

type IdRow = QueryResultRow & { id: string }
type PositionRow = QueryResultRow & { id: string; position: string | number }
type NextPositionRow = QueryResultRow & { next_position: string | number }
type LessonOwnershipRow = QueryResultRow & {
  id: string
  lesson_type: string
  section_id?: string
}

function runtimeTransaction<T>(work: (query: CurriculumQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
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

function asLessonType(value: string): MentorLessonType {
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

function numberOrNull(value: string | number | null) {
  return value === null ? null : Number(value)
}

function lessonDraftValues(draft: MentorLessonDraft) {
  return [
    draft.title,
    draft.lessonType,
    draft.summary,
    draft.articleBody,
    draft.assetPath,
    draft.externalUrl,
    draft.durationSeconds,
    draft.isPreview,
    draft.isDownloadable,
  ] as const
}

async function requireEditableOwnedCourse(
  query: CurriculumQuery,
  actorId: string,
  courseId: string,
) {
  const rows = await query(
    `select course.id, course.mentor_id, course.status
     from public.learning_courses course
     where course.id = $1
       and ${courseManagerAccessSql('course', '$2')}
     for update`,
    [courseId, actorId],
  ) as LockedCourseRow[]
  const course = rows[0]
  if (!course) throw new Error('course_not_found')
  if (!canMentorEditCourse(asCourseStatus(course.status))) throw new Error('course_edit_forbidden')
  return course
}

async function compactPositions(
  query: CurriculumQuery,
  table: 'learning_course_sections' | 'learning_lessons',
  rows: PositionRow[],
) {
  for (const [position, row] of rows.entries()) {
    if (Number(row.position) === position) continue
    await query(
      `update public.${table}
       set position = $2, updated_at = now()
       where id = $1
       returning id`,
      [row.id, position],
    )
  }
}

async function swapAdjacentPositions(
  query: CurriculumQuery,
  table: 'learning_course_sections' | 'learning_lessons',
  rows: PositionRow[],
  itemId: string,
  direction: 'up' | 'down',
  notFoundError: string,
) {
  const currentIndex = rows.findIndex((row) => row.id === itemId)
  if (currentIndex < 0) throw new Error(notFoundError)
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
  if (targetIndex < 0 || targetIndex >= rows.length) return false

  const current = rows[currentIndex]!
  const target = rows[targetIndex]!
  const currentPosition = Number(current.position)
  const targetPosition = Number(target.position)
  const temporaryPosition = Math.max(...rows.map((row) => Number(row.position))) + 1

  await query(
    `update public.${table}
     set position = $2, updated_at = now()
     where id = $1
     returning id`,
    [current.id, temporaryPosition],
  )
  await query(
    `update public.${table}
     set position = $2, updated_at = now()
     where id = $1
     returning id`,
    [target.id, currentPosition],
  )
  await query(
    `update public.${table}
     set position = $2, updated_at = now()
     where id = $1
     returning id`,
    [current.id, targetPosition],
  )
  return true
}

function buildCurriculum(rows: CurriculumRow[]): MentorCurriculum | null {
  const first = rows[0]
  if (!first) return null

  const sections: MentorCurriculumSection[] = []
  const sectionById = new Map<string, MentorCurriculumSection>()
  const lessonById = new Map<string, MentorCurriculumLesson>()
  const questionById = new Map<string, MentorQuizQuestion>()
  const seenOptions = new Set<string>()

  for (const row of rows) {
    if (!row.section_id || row.section_title === null || row.section_position === null) continue

    let section = sectionById.get(row.section_id)
    if (!section) {
      section = {
        id: row.section_id,
        title: row.section_title,
        position: Number(row.section_position),
        lessons: [],
      }
      sectionById.set(row.section_id, section)
      sections.push(section)
    }

    if (
      !row.lesson_id
      || row.lesson_title === null
      || row.lesson_type === null
      || row.lesson_position === null
    ) continue

    let lesson = lessonById.get(row.lesson_id)
    if (!lesson) {
      const quiz = row.quiz_id && row.pass_percentage !== null
        ? {
            id: row.quiz_id,
            passPercentage: Number(row.pass_percentage),
            instructions: row.quiz_instructions,
            questions: [],
          }
        : null
      lesson = {
        id: row.lesson_id,
        title: row.lesson_title,
        lessonType: asLessonType(row.lesson_type),
        position: Number(row.lesson_position),
        summary: row.lesson_summary,
        articleBody: row.article_body,
        assetPath: row.asset_path,
        externalUrl: row.external_url,
        durationSeconds: numberOrNull(row.duration_seconds),
        isPreview: row.is_preview ?? false,
        isDownloadable: row.is_downloadable ?? false,
        quiz,
      }
      lessonById.set(row.lesson_id, lesson)
      section.lessons.push(lesson)
    }

    if (
      !lesson.quiz
      || !row.question_id
      || row.question_prompt === null
      || row.question_position === null
    ) continue

    let question = questionById.get(row.question_id)
    if (!question) {
      question = {
        id: row.question_id,
        prompt: row.question_prompt,
        position: Number(row.question_position),
        options: [],
      }
      questionById.set(row.question_id, question)
      lesson.quiz.questions.push(question)
    }

    if (
      !row.option_id
      || row.option_label === null
      || row.option_position === null
      || row.option_is_correct === null
      || seenOptions.has(row.option_id)
    ) continue

    question.options.push({
      id: row.option_id,
      label: row.option_label,
      position: Number(row.option_position),
      isCorrect: row.option_is_correct,
    })
    seenOptions.add(row.option_id)
  }

  return {
    courseId: first.course_id,
    status: asCourseStatus(first.course_status),
    sections,
  }
}

export function createMentorCurriculumRepository(input: {
  query?: CurriculumQuery
  transaction?: CurriculumTransaction
} = {}) {
  const queryRows: CurriculumQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function getCurriculum(actorId: string, courseId: string): Promise<MentorCurriculum | null> {
    const rows = await queryRows(
      `select
         course.id as course_id,
         course.status as course_status,
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
         quiz.id as quiz_id,
         quiz.pass_percentage,
         quiz.instructions as quiz_instructions,
         question.id as question_id,
         question.prompt as question_prompt,
         question.position as question_position,
         option.id as option_id,
         option.label as option_label,
         option.position as option_position,
         option.is_correct as option_is_correct
       from public.learning_courses course
       left join public.learning_course_sections section
         on section.course_id = course.id
       left join public.learning_lessons lesson
         on lesson.section_id = section.id
       left join public.learning_quizzes quiz
         on quiz.lesson_id = lesson.id
       left join public.learning_quiz_questions question
         on question.quiz_id = quiz.id
       left join public.learning_quiz_options option
         on option.question_id = question.id
       where course.id = $2
         and ${courseManagerAccessSql('course', '$1')}
       order by
         section.position asc nulls last,
         section.id asc nulls last,
         lesson.position asc nulls last,
         lesson.id asc nulls last,
         question.position asc nulls last,
         question.id asc nulls last,
         option.position asc nulls last,
         option.id asc nulls last`,
      [actorId, courseId],
    ) as CurriculumRow[]

    return buildCurriculum(rows)
  }

  async function createSection(actorId: string, courseId: string, title: string) {
    return transaction(async (query) => {
      await requireEditableOwnedCourse(query, actorId, courseId)
      const positionRows = await query(
        `select coalesce(max(position), -1) + 1 as next_position
         from public.learning_course_sections
         where course_id = $1`,
        [courseId],
      ) as NextPositionRow[]
      const nextPosition = Number(positionRows[0]?.next_position ?? 0)
      const inserted = await query(
        `insert into public.learning_course_sections (course_id, title, position, created_at, updated_at)
         values ($1, $2, $3, now(), now())
         returning id`,
        [courseId, title, nextPosition],
      ) as IdRow[]
      if (!inserted[0]) throw new Error('section_create_failed')
      return { sectionId: inserted[0].id }
    })
  }

  async function updateSection(actorId: string, courseId: string, sectionId: string, title: string) {
    return transaction(async (query) => {
      await requireEditableOwnedCourse(query, actorId, courseId)
      const rows = await query(
        `update public.learning_course_sections as section
         set title = $3, updated_at = now()
         where section.id = $1
           and section.course_id = $2
         returning section.id`,
        [sectionId, courseId, title],
      ) as IdRow[]
      if (!rows[0]) throw new Error('section_not_found')
      return true
    })
  }

  async function deleteSection(actorId: string, courseId: string, sectionId: string) {
    return transaction(async (query) => {
      await requireEditableOwnedCourse(query, actorId, courseId)
      const deleted = await query(
        `delete from public.learning_course_sections
         where id = $1
           and course_id = $2
         returning id`,
        [sectionId, courseId],
      ) as IdRow[]
      if (!deleted[0]) throw new Error('section_not_found')

      const remaining = await query(
        `select id, position
         from public.learning_course_sections
         where course_id = $1
         order by position asc, id asc
         for update`,
        [courseId],
      ) as PositionRow[]
      await compactPositions(query, 'learning_course_sections', remaining)
      return true
    })
  }

  async function createLesson(
    actorId: string,
    courseId: string,
    sectionId: string,
    draft: MentorLessonDraft,
  ) {
    return transaction(async (query) => {
      await requireEditableOwnedCourse(query, actorId, courseId)
      const sectionRows = await query(
        `select id
         from public.learning_course_sections
         where course_id = $1
           and id = $2
         limit 1`,
        [courseId, sectionId],
      ) as IdRow[]
      if (!sectionRows[0]) throw new Error('section_not_found')

      const positionRows = await query(
        `select coalesce(max(position), -1) + 1 as next_position
         from public.learning_lessons
         where section_id = $1`,
        [sectionId],
      ) as NextPositionRow[]
      const nextPosition = Number(positionRows[0]?.next_position ?? 0)

      const inserted = await query(
        `insert into public.learning_lessons (
           section_id,
           title,
           lesson_type,
           position,
           summary,
           article_body,
           asset_path,
           external_url,
           duration_seconds,
           is_preview,
           is_downloadable,
           created_at,
           updated_at
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
         returning id`,
        [sectionId, draft.title, draft.lessonType, nextPosition, ...lessonDraftValues(draft).slice(2)],
      ) as IdRow[]
      if (!inserted[0]) throw new Error('lesson_create_failed')
      return { lessonId: inserted[0].id }
    })
  }

  async function updateLesson(
    actorId: string,
    courseId: string,
    lessonId: string,
    draft: MentorLessonDraft,
  ) {
    return transaction(async (query) => {
      await requireEditableOwnedCourse(query, actorId, courseId)
      const rows = await query(
        `update public.learning_lessons as lesson
         set title = $3,
             lesson_type = $4,
             summary = $5,
             article_body = $6,
             asset_path = $7,
             external_url = $8,
             duration_seconds = $9,
             is_preview = $10,
             is_downloadable = $11,
             updated_at = now()
         from public.learning_course_sections section
         where lesson.id = $1
           and section.course_id = $2
           and section.id = lesson.section_id
         returning lesson.id`,
        [lessonId, courseId, ...lessonDraftValues(draft)],
      ) as IdRow[]
      if (!rows[0]) throw new Error('lesson_not_found')
      return true
    })
  }

  async function deleteLesson(actorId: string, courseId: string, lessonId: string) {
    return transaction(async (query) => {
      await requireEditableOwnedCourse(query, actorId, courseId)
      const ownedRows = await query(
        `select lesson.id, lesson.section_id, lesson.lesson_type
         from public.learning_lessons lesson
         inner join public.learning_course_sections section
           on section.id = lesson.section_id
         where lesson.id = $1
           and section.course_id = $2
         for update`,
        [lessonId, courseId],
      ) as LessonOwnershipRow[]
      const lesson = ownedRows[0]
      if (!lesson?.section_id) throw new Error('lesson_not_found')

      const deleted = await query(
        `delete from public.learning_lessons
         where id = $1
         returning id`,
        [lessonId],
      ) as IdRow[]
      if (!deleted[0]) throw new Error('lesson_delete_failed')

      const remaining = await query(
        `select id, position
         from public.learning_lessons
         where section_id = $1
         order by position asc, id asc
         for update`,
        [lesson.section_id],
      ) as PositionRow[]
      await compactPositions(query, 'learning_lessons', remaining)
      return true
    })
  }

  async function moveSection(
    actorId: string,
    courseId: string,
    sectionId: string,
    direction: 'up' | 'down',
  ) {
    return transaction(async (query) => {
      await requireEditableOwnedCourse(query, actorId, courseId)
      const sections = await query(
        `select id, position
         from public.learning_course_sections
         where course_id = $1
         order by position asc, id asc
         for update`,
        [courseId],
      ) as PositionRow[]
      return swapAdjacentPositions(query, 'learning_course_sections', sections, sectionId, direction, 'section_not_found')
    })
  }

  async function moveLesson(
    actorId: string,
    courseId: string,
    lessonId: string,
    direction: 'up' | 'down',
  ) {
    return transaction(async (query) => {
      await requireEditableOwnedCourse(query, actorId, courseId)
      const ownedRows = await query(
        `select lesson.id, lesson.section_id, lesson.lesson_type
         from public.learning_lessons lesson
         inner join public.learning_course_sections section
           on section.id = lesson.section_id
         where lesson.id = $1
           and section.course_id = $2
         for update`,
        [lessonId, courseId],
      ) as LessonOwnershipRow[]
      const lesson = ownedRows[0]
      if (!lesson?.section_id) throw new Error('lesson_not_found')

      const lessons = await query(
        `select id, position
         from public.learning_lessons
         where section_id = $1
         order by position asc, id asc
         for update`,
        [lesson.section_id],
      ) as PositionRow[]
      return swapAdjacentPositions(query, 'learning_lessons', lessons, lessonId, direction, 'lesson_not_found')
    })
  }

  async function saveQuizDefinition(
    actorId: string,
    courseId: string,
    lessonId: string,
    definition: MentorQuizDefinitionInput,
  ) {
    return transaction(async (query) => {
      await requireEditableOwnedCourse(query, actorId, courseId)
      const lessonRows = await query(
        `select lesson.id, lesson.lesson_type
         from public.learning_lessons lesson
         inner join public.learning_course_sections section
           on section.id = lesson.section_id
         where lesson.id = $1
           and section.course_id = $2
         limit 1`,
        [lessonId, courseId],
      ) as LessonOwnershipRow[]
      const lesson = lessonRows[0]
      if (!lesson) throw new Error('lesson_not_found')
      if (lesson.lesson_type !== 'quiz') throw new Error('lesson_not_quiz')

      await query(
        `delete from public.learning_quizzes
         where lesson_id = $1`,
        [lessonId],
      )

      const quizRows = await query(
        `insert into public.learning_quizzes (
           lesson_id,
           pass_percentage,
           instructions,
           created_at,
           updated_at
         )
         values ($1, $2, $3, now(), now())
         returning id`,
        [lessonId, definition.passPercentage, definition.instructions],
      ) as IdRow[]
      const quiz = quizRows[0]
      if (!quiz) throw new Error('quiz_save_failed')

      for (const [questionPosition, question] of definition.questions.entries()) {
        const questionRows = await query(
          `insert into public.learning_quiz_questions (
             quiz_id,
             prompt,
             position,
             created_at,
             updated_at
           )
           values ($1, $2, $3, now(), now())
           returning id`,
          [quiz.id, question.prompt, questionPosition],
        ) as IdRow[]
        const savedQuestion = questionRows[0]
        if (!savedQuestion) throw new Error('quiz_question_save_failed')

        for (const [optionPosition, option] of question.options.entries()) {
          await query(
            `insert into public.learning_quiz_options (
               question_id,
               label,
               position,
               is_correct,
               created_at,
               updated_at
             )
             values ($1, $2, $3, $4, now(), now())
             returning id`,
            [savedQuestion.id, option.label, optionPosition, option.isCorrect],
          )
        }
      }

      return true
    })
  }

  return {
    getCurriculum,
    createSection,
    updateSection,
    deleteSection,
    createLesson,
    updateLesson,
    deleteLesson,
    moveSection,
    moveLesson,
    saveQuizDefinition,
  }
}

export const mentorCurriculumRepository = createMentorCurriculumRepository()
