import type { QueryResultRow } from 'pg'
import type { Difficulty, QuestionType } from './quiz-model'

/**
 * Learner history is never deleted. A section, material, quiz question or answer option that
 * learners have progress, attempts or answers for is retired instead: hidden (removed_at), and for
 * materials unpublished, so it stops counting toward completion while its history stays.
 *
 * Positions are unique per parent, so rows are moved out of the way in two ranges that never meet
 * the live range (0 ..< 500000):
 * - MOVE_ASIDE_OFFSET: a temporary range while a parent's children are renumbered.
 * - RETIRED_POSITION_BASE: where retired rows stay, one slot each.
 */
export const MOVE_ASIDE_OFFSET = 500_000
export const RETIRED_POSITION_BASE = 1_000_000

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type IdRow = QueryResultRow & { id: string }

/** Lessons (of the given ids) that any learner has progress or an attempt for. */
export async function lessonsWithLearnerHistory(query: Query, lessonIds: readonly string[]) {
  if (lessonIds.length === 0) return new Set<string>()
  const rows = await query(
    `select lesson.id
     from public.learning_lessons lesson
     where lesson.id = any($1::uuid[])
       and (
         exists (select 1 from public.learning_progress progress where progress.lesson_id = lesson.id)
         or exists (select 1 from public.learning_assignment_attempts attempt where attempt.lesson_id = lesson.id)
         or exists (select 1 from public.learning_scorm_attempts attempt where attempt.lesson_id = lesson.id)
         or exists (
           select 1
           from public.learning_quizzes quiz
           inner join public.learning_quiz_attempts attempt on attempt.quiz_id = quiz.id
           where quiz.lesson_id = lesson.id
         )
       )`,
    [lessonIds],
  ) as IdRow[]
  return new Set(rows.map((row) => row.id))
}

/** Retires lessons: unpublished, hidden, and parked in their section's retired range. */
export async function retireLessons(query: Query, lessonIds: readonly string[]) {
  for (const lessonId of lessonIds) {
    await query(
      `update public.learning_lessons lesson
       set removed_at = coalesce(lesson.removed_at, now()),
           is_published = false,
           position = (
             select greatest(coalesce(max(sibling.position), $2 - 1), $2 - 1) + 1
             from public.learning_lessons sibling
             where sibling.section_id = lesson.section_id
               and sibling.position >= $2
           ),
           updated_at = now()
       where lesson.id = $1
         and lesson.removed_at is null
       returning lesson.id`,
      [lessonId, RETIRED_POSITION_BASE],
    )
  }
}

/** Retires a section and every material in it. */
export async function retireSection(query: Query, sectionId: string) {
  const lessons = await query(
    `select id from public.learning_lessons where section_id = $1 and removed_at is null order by position asc, id asc`,
    [sectionId],
  ) as IdRow[]
  await retireLessons(query, lessons.map((lesson) => lesson.id))
  await query(
    `update public.learning_course_sections section
     set removed_at = coalesce(section.removed_at, now()),
         position = (
           select greatest(coalesce(max(sibling.position), $2 - 1), $2 - 1) + 1
           from public.learning_course_sections sibling
           where sibling.course_id = section.course_id
             and sibling.position >= $2
         ),
         updated_at = now()
     where section.id = $1
       and section.removed_at is null
     returning section.id`,
    [sectionId, RETIRED_POSITION_BASE],
  )
}

/** Questions (of the given ids) that any learner has answered. */
export async function questionsWithAnswers(query: Query, questionIds: readonly string[]) {
  if (questionIds.length === 0) return new Set<string>()
  const rows = await query(
    `select distinct answer.question_id as id
     from public.learning_quiz_attempt_answers answer
     where answer.question_id = any($1::uuid[])`,
    [questionIds],
  ) as IdRow[]
  return new Set(rows.map((row) => row.id))
}

/** Options (of the given ids) that any answer selected or recorded as the correct one. */
export async function optionsWithAnswers(query: Query, optionIds: readonly string[]) {
  if (optionIds.length === 0) return new Set<string>()
  const rows = await query(
    `select option.id
     from public.learning_quiz_options option
     where option.id = any($1::uuid[])
       and exists (
         select 1 from public.learning_quiz_attempt_answers answer
         where answer.selected_option_id = option.id
            or answer.correct_option_id = option.id
            or option.id = any(answer.selected_option_ids)
            or option.id = any(answer.correct_option_ids)
       )`,
    [optionIds],
  ) as IdRow[]
  return new Set(rows.map((row) => row.id))
}

/**
 * Removes answer options: retired (kept, hidden, never correct) when an answer references them,
 * deleted otherwise.
 */
export async function removeQuizOptions(query: Query, optionIds: readonly string[]) {
  const answered = await optionsWithAnswers(query, optionIds)
  for (const optionId of optionIds) {
    if (answered.has(optionId)) {
      await query(
        `update public.learning_quiz_options option
         set removed_at = coalesce(option.removed_at, now()),
             is_correct = false,
             position = (
               select greatest(coalesce(max(sibling.position), $2 - 1), $2 - 1) + 1
               from public.learning_quiz_options sibling
               where sibling.question_id = option.question_id
                 and sibling.position >= $2
             ),
             updated_at = now()
         where option.id = $1
         returning option.id`,
        [optionId, RETIRED_POSITION_BASE],
      )
    } else {
      await query(`delete from public.learning_quiz_options where id = $1 returning id`, [optionId])
    }
  }
}

/**
 * Removes quiz questions: retired with their options when any answer references them, deleted
 * otherwise.
 */
export async function removeQuizQuestions(query: Query, questionIds: readonly string[]) {
  const answered = await questionsWithAnswers(query, questionIds)
  for (const questionId of questionIds) {
    if (answered.has(questionId)) {
      const options = await query(
        `select id from public.learning_quiz_options where question_id = $1 and removed_at is null`,
        [questionId],
      ) as IdRow[]
      await removeQuizOptions(query, options.map((option) => option.id))
      await query(
        `update public.learning_quiz_questions question
         set removed_at = coalesce(question.removed_at, now()),
             position = (
               select greatest(coalesce(max(sibling.position), $2 - 1), $2 - 1) + 1
               from public.learning_quiz_questions sibling
               where sibling.quiz_id = question.quiz_id
                 and sibling.position >= $2
             ),
             updated_at = now()
         where question.id = $1
         returning question.id`,
        [questionId, RETIRED_POSITION_BASE],
      )
    } else {
      await query(`delete from public.learning_quiz_questions where id = $1 returning id`, [questionId])
    }
  }
}

export type QuizQuestionInput = {
  id?: string | null
  prompt: string
  options: Array<{ id?: string | null; label: string; isCorrect: boolean }>
  /** Round B fields; a question saved without them is single-correct, 1 mark, untagged. */
  type?: QuestionType
  marks?: number
  negativeMarks?: number
  explanation?: string | null
  acceptedAnswers?: readonly string[]
  caseSensitive?: boolean
  topic?: string | null
  difficulty?: Difficulty | null
  departmentKey?: string | null
  roleKey?: string | null
  sourceQuestionId?: string | null
}

type ExistingQuestionRow = IdRow & { question_type: string | null }

/** The round B columns of a question, in the order the write statements use them ($4 onward). */
function questionColumns(question: QuizQuestionInput) {
  return [
    question.type ?? 'single_choice',
    question.marks ?? 1,
    question.negativeMarks ?? 0,
    question.explanation ?? null,
    [...(question.acceptedAnswers ?? [])],
    question.caseSensitive ?? false,
    question.topic ?? null,
    question.difficulty ?? null,
    question.departmentKey ?? null,
    question.roleKey ?? null,
    question.sourceQuestionId ?? null,
  ]
}

/**
 * Writes a quiz's questions and options in place: items with a known id are updated (so attempts
 * and answers that reference them stay valid), new items are inserted, and items no longer listed
 * are removed (retired if answered). Applying a revision passes the live ids, so the same path
 * updates the live quiz in place. A question whose type changes after learners answered it is
 * retired and saved as a new question, so earlier answers keep the meaning they were scored with.
 */
export async function writeQuizQuestions(
  query: Query,
  quizId: string,
  questions: readonly QuizQuestionInput[],
) {
  const existing = await query(
    `select id, question_type from public.learning_quiz_questions where quiz_id = $1 and removed_at is null for update`,
    [quizId],
  ) as ExistingQuestionRow[]
  const existingIds = new Set(existing.map((row) => row.id))
  const existingTypes = new Map(existing.map((row) => [row.id, row.question_type ?? 'single_choice']))
  const typeChanged = questions
    .filter((question) => question.id && existingIds.has(question.id) && (question.type ?? 'single_choice') !== existingTypes.get(question.id))
    .map((question) => question.id!)
  const answeredTypeChanges = await questionsWithAnswers(query, typeChanged)
  await query(
    `update public.learning_quiz_questions
     set position = position + $2
     where quiz_id = $1 and removed_at is null and position < $2`,
    [quizId, MOVE_ASIDE_OFFSET],
  )

  const kept = new Set<string>()
  for (const [position, question] of questions.entries()) {
    let questionId: string
    if (question.id && existingIds.has(question.id) && !kept.has(question.id) && !answeredTypeChanges.has(question.id)) {
      questionId = question.id
      await query(
        `update public.learning_quiz_questions
         set prompt = $2, position = $3, updated_at = now(),
             question_type = $4, marks = $5, negative_marks = $6, explanation = $7, accepted_answers = $8::text[],
             answers_case_sensitive = $9, topic = $10, difficulty = $11, department_key = $12, role_key = $13,
             source_question_id = $14
         where id = $1
         returning id`,
        [questionId, question.prompt, position, ...questionColumns(question)],
      )
    } else {
      const inserted = await query(
        `insert into public.learning_quiz_questions (
           quiz_id, prompt, position, created_at, updated_at,
           question_type, marks, negative_marks, explanation, accepted_answers,
           answers_case_sensitive, topic, difficulty, department_key, role_key, source_question_id
         )
         values ($1, $2, $3, now(), now(), $4, $5, $6, $7, $8::text[], $9, $10, $11, $12, $13, $14)
         returning id`,
        [quizId, question.prompt, position, ...questionColumns(question)],
      ) as IdRow[]
      if (!inserted[0]) throw new Error('quiz_question_save_failed')
      questionId = inserted[0].id
    }
    kept.add(questionId)
    await writeQuizOptions(query, questionId, question.options)
  }

  const removed = [...existingIds].filter((id) => !kept.has(id))
  await removeQuizQuestions(query, removed)
}

async function writeQuizOptions(query: Query, questionId: string, options: QuizQuestionInput['options']) {
  const existing = await query(
    `select id from public.learning_quiz_options where question_id = $1 and removed_at is null for update`,
    [questionId],
  ) as IdRow[]
  const existingIds = new Set(existing.map((row) => row.id))
  // Correct answers are cleared first and set below (single-answer types allow one at a time).
  await query(
    `update public.learning_quiz_options
     set position = case when removed_at is null and position < $2 then position + $2 else position end,
         is_correct = false
     where question_id = $1`,
    [questionId, MOVE_ASIDE_OFFSET],
  )

  const kept = new Set<string>()
  for (const [position, option] of options.entries()) {
    if (option.id && existingIds.has(option.id) && !kept.has(option.id)) {
      kept.add(option.id)
      await query(
        `update public.learning_quiz_options
         set label = $2, position = $3, is_correct = $4, updated_at = now()
         where id = $1
         returning id`,
        [option.id, option.label, position, option.isCorrect],
      )
    } else {
      const inserted = await query(
        `insert into public.learning_quiz_options (question_id, label, position, is_correct, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())
         returning id`,
        [questionId, option.label, position, option.isCorrect],
      ) as IdRow[]
      if (!inserted[0]) throw new Error('quiz_option_save_failed')
      kept.add(inserted[0].id)
    }
  }

  await removeQuizOptions(query, [...existingIds].filter((id) => !kept.has(id)))
}
