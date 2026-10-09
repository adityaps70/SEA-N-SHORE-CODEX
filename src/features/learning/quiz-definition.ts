import type { QueryResultRow } from 'pg'
import {
  answerPolicyOf,
  questionTypeOf,
  type Difficulty,
  type QuestionType,
} from './quiz-model'
import type { QuizSettingsInput } from './quiz-question-schema'

/**
 * Round B quiz settings and question details for Studio (trainers and admins only: it reads the answer key's
 * companions, accepted answers and explanations). Kept apart from the curriculum's flat query so that query
 * stays as it was.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export type MentorQuizQuestionDetails = {
  type: QuestionType
  marks: number
  negativeMarks: number
  explanation: string | null
  acceptedAnswers: string[]
  caseSensitive: boolean
  topic: string | null
  difficulty: Difficulty | null
  departmentKey: string | null
  roleKey: string | null
  sourceQuestionId: string | null
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettingsInput = {
  timeLimitMinutes: null,
  shuffleQuestions: false,
  shuffleOptions: false,
  drawCount: null,
  answerPolicy: 'after_each_attempt',
}

export const DEFAULT_QUESTION_DETAILS: MentorQuizQuestionDetails = {
  type: 'single_choice',
  marks: 1,
  negativeMarks: 0,
  explanation: null,
  acceptedAnswers: [],
  caseSensitive: false,
  topic: null,
  difficulty: null,
  departmentKey: null,
  roleKey: null,
  sourceQuestionId: null,
}

type QuizSettingsRow = QueryResultRow & {
  id: string
  time_limit_minutes: string | number | null
  shuffle_questions: boolean | null
  shuffle_options: boolean | null
  draw_count: string | number | null
  answer_policy: string | null
}

export type QuestionDetailsRow = QueryResultRow & {
  id: string
  question_type?: string | null
  marks?: string | number | null
  negative_marks?: string | number | null
  explanation?: string | null
  accepted_answers?: string[] | null
  answers_case_sensitive?: boolean | null
  topic?: string | null
  difficulty?: string | null
  department_key?: string | null
  role_key?: string | null
  source_question_id?: string | null
}

function numberOrNull(value: string | number | null | undefined) {
  return value === null || value === undefined ? null : Number(value)
}

export function quizSettingsFromRow(row: Partial<QuizSettingsRow> | undefined): QuizSettingsInput {
  if (!row) return { ...DEFAULT_QUIZ_SETTINGS }
  return {
    timeLimitMinutes: numberOrNull(row.time_limit_minutes),
    shuffleQuestions: row.shuffle_questions ?? false,
    shuffleOptions: row.shuffle_options ?? false,
    drawCount: numberOrNull(row.draw_count),
    answerPolicy: answerPolicyOf(row.answer_policy),
  }
}

export function questionDetailsFromRow(row: QuestionDetailsRow | undefined): MentorQuizQuestionDetails {
  if (!row) return { ...DEFAULT_QUESTION_DETAILS, acceptedAnswers: [] }
  const difficulty = row.difficulty === 'easy' || row.difficulty === 'medium' || row.difficulty === 'hard' ? row.difficulty : null
  return {
    type: questionTypeOf(row.question_type),
    marks: row.marks === null || row.marks === undefined ? 1 : Number(row.marks),
    negativeMarks: row.negative_marks === null || row.negative_marks === undefined ? 0 : Number(row.negative_marks),
    explanation: row.explanation ?? null,
    acceptedAnswers: row.accepted_answers ?? [],
    caseSensitive: row.answers_case_sensitive ?? false,
    topic: row.topic ?? null,
    difficulty,
    departmentKey: row.department_key ?? null,
    roleKey: row.role_key ?? null,
    sourceQuestionId: row.source_question_id ?? null,
  }
}

export const QUESTION_DETAIL_COLUMNS = `question.question_type, question.marks, question.negative_marks, question.explanation,
       question.accepted_answers, question.answers_case_sensitive, question.topic, question.difficulty,
       question.department_key, question.role_key, question.source_question_id`

type DetailedQuiz = {
  id: string
  questions: Array<{ id: string } & Partial<MentorQuizQuestionDetails>>
} & Partial<QuizSettingsInput>

/** Fills each quiz's settings and each question's details in place. */
export async function loadQuizDetails(query: Query, quizzes: ReadonlyArray<DetailedQuiz | null>) {
  const present = quizzes.filter((quiz): quiz is DetailedQuiz => quiz !== null)
  if (present.length === 0) return
  const quizIds = present.map((quiz) => quiz.id)
  const questionIds = present.flatMap((quiz) => quiz.questions.map((question) => question.id))
  const settings = await query(
    `select quiz.id, quiz.time_limit_minutes, quiz.shuffle_questions, quiz.shuffle_options, quiz.draw_count, quiz.answer_policy
     from public.learning_quizzes quiz
     where quiz.id = any($1::uuid[])`,
    [quizIds],
  ) as QuizSettingsRow[]
  const details = questionIds.length
    ? await query(
      `select question.id, ${QUESTION_DETAIL_COLUMNS}
       from public.learning_quiz_questions question
       where question.id = any($1::uuid[])`,
      [questionIds],
    ) as QuestionDetailsRow[]
    : []
  const settingsById = new Map(settings.map((row) => [row.id, row]))
  const detailsById = new Map(details.map((row) => [row.id, row]))
  for (const quiz of present) {
    Object.assign(quiz, quizSettingsFromRow(settingsById.get(quiz.id)))
    for (const question of quiz.questions) Object.assign(question, questionDetailsFromRow(detailsById.get(question.id)))
  }
}

/** Saves a quiz's round B settings; a definition without them keeps the defaults. */
export async function saveQuizSettings(query: Query, quizId: string, settings: Partial<QuizSettingsInput>) {
  const value = { ...DEFAULT_QUIZ_SETTINGS, ...settings }
  await query(
    `update public.learning_quizzes
     set time_limit_minutes = $2, shuffle_questions = $3, shuffle_options = $4, draw_count = $5, answer_policy = $6,
         updated_at = now()
     where id = $1`,
    [quizId, value.timeLimitMinutes, value.shuffleQuestions, value.shuffleOptions, value.drawCount, value.answerPolicy],
  )
}
