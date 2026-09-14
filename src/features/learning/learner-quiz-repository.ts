import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import {
  completeLearningLessonWithQuery,
  type LearnerProgressQuery,
} from './learner-progress-repository'

export type LearnerQuizOption = {
  id: string
  label: string
  position: number
}

export type LearnerQuizQuestion = {
  id: string
  prompt: string
  position: number
  options: LearnerQuizOption[]
}

export type LearnerQuiz = {
  id: string
  lessonId: string
  passPercentage: number
  instructions: string | null
  questions: LearnerQuizQuestion[]
}

export type LearnerQuizAnswerInput = {
  questionId: string
  optionId: string
}

export type LearnerQuizAttemptAnswerResult = {
  questionId: string
  selectedOptionId: string
  correctOptionId: string
  isCorrect: boolean
}

export type LearnerQuizAttemptResult = {
  attemptId: string
  submittedAt: string
  score: number
  totalQuestions: number
  percentage: number
  passPercentage: number
  passed: boolean
  enrollmentCompleted: boolean
  completedLessons: number | null
  totalLessons: number | null
  progressPercent: number | null
  answers: LearnerQuizAttemptAnswerResult[]
}

type QuizQuery = LearnerProgressQuery
type QuizTransaction = <T>(work: (query: QuizQuery) => Promise<T>) => Promise<T>
type CompleteLessonWithQuery = typeof completeLearningLessonWithQuery

type QuizAccessRow = QueryResultRow & {
  enrollment_id: string
  course_id: string
  lesson_id: string
  quiz_id: string
  pass_percentage: string | number
  instructions: string | null
}

type QuizQuestionRow = QueryResultRow & {
  id: string
  prompt: string
  position: string | number
}

type QuizOptionRow = QueryResultRow & {
  id: string
  question_id: string
  label: string
  position: string | number
}

type QuizScoringOptionRow = QuizOptionRow & {
  is_correct: boolean
}

type QuizAttemptRow = QueryResultRow & {
  id: string
  submitted_at: string | Date
}

function runtimeTransaction<T>(work: (query: QuizQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function isoDateTime(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value
}

function quizAccessQuery(lockEnrollment: boolean) {
  return `select
     enrollment.id as enrollment_id,
     course.id as course_id,
     lesson.id as lesson_id,
     quiz.id as quiz_id,
     quiz.pass_percentage,
     quiz.instructions
   from public.learning_quizzes quiz
   inner join public.learning_lessons lesson
     on lesson.id = quiz.lesson_id
    and lesson.lesson_type = 'quiz'
   inner join public.learning_course_sections section
     on section.id = lesson.section_id
   inner join public.learning_courses course
     on course.id = section.course_id
    and course.status = 'published'
   inner join public.learning_mentors mentor
     on mentor.id = course.mentor_id
    and mentor.status = 'active'
   inner join public.learning_mentor_applications application
     on application.id = mentor.application_id
    and application.user_id = mentor.user_id
    and application.status = 'approved'
   inner join public.learning_enrollments enrollment
     on enrollment.course_id = course.id
    and enrollment.learner_id = $1
    and enrollment.status in ('active', 'completed')
   where course.slug = $2
     and lesson.id = $3
   limit 1${lockEnrollment ? '\n   for update of enrollment' : ''}`
}

async function loadQuestions(query: QuizQuery, quizId: string) {
  return query(
    `select question.id, question.prompt, question.position
     from public.learning_quiz_questions question
     where question.quiz_id = $1
     order by question.position asc, question.id asc`,
    [quizId],
  ) as Promise<QuizQuestionRow[]>
}

async function loadSafeOptions(query: QuizQuery, questionIds: string[]) {
  if (questionIds.length === 0) return []
  return query(
    `select option.id, option.question_id, option.label, option.position
     from public.learning_quiz_options option
     where option.question_id = any($1::uuid[])
     order by option.question_id asc, option.position asc, option.id asc`,
    [questionIds],
  ) as Promise<QuizOptionRow[]>
}

async function loadScoringOptions(query: QuizQuery, questionIds: string[]) {
  if (questionIds.length === 0) return []
  return query(
    `select option.id, option.question_id, option.label, option.position, option.is_correct
     from public.learning_quiz_options option
     where option.question_id = any($1::uuid[])
     order by option.question_id asc, option.position asc, option.id asc`,
    [questionIds],
  ) as Promise<QuizScoringOptionRow[]>
}

function buildLearnerQuestions(questionRows: QuizQuestionRow[], optionRows: QuizOptionRow[]) {
  const optionsByQuestion = new Map<string, LearnerQuizOption[]>()
  for (const option of optionRows) {
    const current = optionsByQuestion.get(option.question_id) ?? []
    current.push({
      id: option.id,
      label: option.label,
      position: Number(option.position),
    })
    optionsByQuestion.set(option.question_id, current)
  }

  return questionRows.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    position: Number(question.position),
    options: optionsByQuestion.get(question.id) ?? [],
  }))
}

export function createLearnerQuizRepository(input: {
  query?: QuizQuery
  transaction?: QuizTransaction
  completeLesson?: CompleteLessonWithQuery
} = {}) {
  const queryRows: QuizQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction
  const completeLesson = input.completeLesson ?? completeLearningLessonWithQuery

  async function getQuizForLearner(
    learnerId: string,
    slug: string,
    lessonId: string,
  ): Promise<LearnerQuiz | null> {
    const accessRows = await queryRows(
      quizAccessQuery(false),
      [learnerId, slug, lessonId],
    ) as QuizAccessRow[]
    const access = accessRows[0]
    if (!access) return null

    const questions = await loadQuestions(queryRows, access.quiz_id)
    const options = await loadSafeOptions(queryRows, questions.map((question) => question.id))

    return {
      id: access.quiz_id,
      lessonId: access.lesson_id,
      passPercentage: Number(access.pass_percentage),
      instructions: access.instructions,
      questions: buildLearnerQuestions(questions, options),
    }
  }

  async function submitQuizAttempt(
    learnerId: string,
    slug: string,
    lessonId: string,
    answers: LearnerQuizAnswerInput[],
  ): Promise<LearnerQuizAttemptResult> {
    return transaction(async (query) => {
      const accessRows = await query(
        quizAccessQuery(true),
        [learnerId, slug, lessonId],
      ) as QuizAccessRow[]
      const access = accessRows[0]
      if (!access) throw new Error('quiz_not_accessible')

      const questionRows = await loadQuestions(query, access.quiz_id)
      if (questionRows.length === 0) throw new Error('quiz_not_ready')

      const questionIds = questionRows.map((question) => question.id)
      const scoringOptions = await loadScoringOptions(query, questionIds)
      const answersByQuestion = new Map<string, LearnerQuizAnswerInput>()

      if (answers.length !== questionRows.length) throw new Error('quiz_answers_invalid')
      for (const answer of answers) {
        if (answersByQuestion.has(answer.questionId)) throw new Error('quiz_answers_invalid')
        answersByQuestion.set(answer.questionId, answer)
      }

      const optionsByQuestion = new Map<string, QuizScoringOptionRow[]>()
      for (const option of scoringOptions) {
        const current = optionsByQuestion.get(option.question_id) ?? []
        current.push(option)
        optionsByQuestion.set(option.question_id, current)
      }

      const answerResults: LearnerQuizAttemptAnswerResult[] = []
      let score = 0

      for (const question of questionRows) {
        const answer = answersByQuestion.get(question.id)
        if (!answer) throw new Error('quiz_answers_invalid')

        const options = optionsByQuestion.get(question.id) ?? []
        const correctOptions = options.filter((option) => option.is_correct)
        if (options.length < 2 || correctOptions.length !== 1) throw new Error('quiz_not_ready')

        const selectedOption = options.find((option) => option.id === answer.optionId)
        if (!selectedOption) throw new Error('quiz_answers_invalid')

        const correctOption = correctOptions[0]
        const isCorrect = selectedOption.id === correctOption.id
        if (isCorrect) score += 1

        answerResults.push({
          questionId: question.id,
          selectedOptionId: selectedOption.id,
          correctOptionId: correctOption.id,
          isCorrect,
        })
      }

      if (answersByQuestion.size !== questionRows.length) throw new Error('quiz_answers_invalid')

      const totalQuestions = questionRows.length
      const percentage = Math.round((score / totalQuestions) * 100)
      const passPercentage = Number(access.pass_percentage)
      const passed = percentage >= passPercentage

      const attemptRows = await query(
        `insert into public.learning_quiz_attempts (
           quiz_id,
           enrollment_id,
           learner_id,
           score,
           total_questions,
           percentage,
           pass_percentage,
           passed,
           submitted_at
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, now())
         returning id, submitted_at`,
        [
          access.quiz_id,
          access.enrollment_id,
          learnerId,
          score,
          totalQuestions,
          percentage,
          passPercentage,
          passed,
        ],
      ) as QuizAttemptRow[]
      const attempt = attemptRows[0]
      if (!attempt) throw new Error('quiz_attempt_create_failed')

      for (const answer of answerResults) {
        await query(
          `insert into public.learning_quiz_attempt_answers (
             attempt_id,
             question_id,
             selected_option_id,
             is_correct,
             created_at
           )
           values ($1, $2, $3, $4, now())`,
          [attempt.id, answer.questionId, answer.selectedOptionId, answer.isCorrect],
        )
      }

      const completion = passed
        ? await completeLesson(query, learnerId, slug, lessonId)
        : null

      return {
        attemptId: attempt.id,
        submittedAt: isoDateTime(attempt.submitted_at),
        score,
        totalQuestions,
        percentage,
        passPercentage,
        passed,
        enrollmentCompleted: completion?.enrollmentCompleted ?? false,
        completedLessons: completion?.completedLessons ?? null,
        totalLessons: completion?.totalLessons ?? null,
        progressPercent: completion?.progressPercent ?? null,
        answers: answerResults,
      }
    })
  }

  return {
    getQuizForLearner,
    submitQuizAttempt,
  }
}

export const learnerQuizRepository = createLearnerQuizRepository()
