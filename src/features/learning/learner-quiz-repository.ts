import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import {
  completeLearningLessonWithQuery,
  type LearnerProgressQuery,
} from './learner-progress-repository'

export type LearnerQuizOption = { id: string; label: string; position: number }
export type LearnerQuizQuestion = { id: string; prompt: string; position: number; options: LearnerQuizOption[] }
export type LearnerQuiz = {
  id: string
  lessonId: string
  passPercentage: number
  instructions: string | null
  maxAttempts: number | null
  attemptsUsed: number
  questions: LearnerQuizQuestion[]
}
export type LearnerQuizAnswerInput = { questionId: string; optionId: string }
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
  max_attempts?: string | number | null
  attempts_used?: string | number
}
type QuizQuestionRow = QueryResultRow & { id: string; prompt: string; position: string | number }
type QuizOptionRow = QueryResultRow & { id: string; question_id: string; label: string; position: string | number }
type QuizScoringOptionRow = QuizOptionRow & { is_correct: boolean }
type QuizAttemptRow = QueryResultRow & { id: string; submitted_at: string | Date }

function runtimeTransaction<T>(work: (query: QuizQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}
function isoDateTime(value: string | Date) { return value instanceof Date ? value.toISOString() : value }

function quizAccessQuery(lockEnrollment: boolean) {
  return `select
     enrollment.id as enrollment_id,
     course.id as course_id,
     lesson.id as lesson_id,
     lesson.max_attempts,
     quiz.id as quiz_id,
     quiz.pass_percentage,
     quiz.instructions,
     coalesce(attempt_stats.attempts_used, 0)::bigint as attempts_used
   from public.learning_quizzes quiz
   inner join public.learning_lessons lesson
     on lesson.id = quiz.lesson_id
    and lesson.lesson_type = 'quiz'
    and lesson.is_published = true
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
   left join public.learning_progress prerequisite_progress
     on prerequisite_progress.enrollment_id = enrollment.id
    and prerequisite_progress.lesson_id = lesson.prerequisite_lesson_id
   left join lateral (
     select count(*)::bigint as attempts_used
     from public.learning_quiz_attempts attempt
     where attempt.enrollment_id = enrollment.id
       and attempt.quiz_id = quiz.id
   ) attempt_stats on true
   where course.slug = $2
     and lesson.id = $3
     and (
       lesson.release_mode = 'immediate'
       or (lesson.release_mode = 'scheduled' and lesson.release_at <= now())
       or (lesson.release_mode = 'drip' and enrollment.enrolled_at + make_interval(days => lesson.drip_delay_days) <= now())
     )
     and (lesson.prerequisite_lesson_id is null or prerequisite_progress.completed = true)
     and (
       course.navigation_mode = 'free'
       or lesson.prerequisite_lesson_id is not null
       or not exists (
         select 1
         from public.learning_course_sections previous_section
         inner join public.learning_lessons previous_lesson
           on previous_lesson.section_id = previous_section.id
          and previous_lesson.is_published = true
         left join public.learning_progress previous_progress
           on previous_progress.enrollment_id = enrollment.id
          and previous_progress.lesson_id = previous_lesson.id
         where previous_section.course_id = course.id
           and (
             previous_section.position < section.position
             or (previous_section.position = section.position and previous_lesson.position < lesson.position)
           )
           and coalesce(previous_progress.completed, false) = false
       )
     )
   limit 1${lockEnrollment ? '\n   for update of enrollment' : ''}`
}

async function loadQuestions(query: QuizQuery, quizId: string) {
  return query(
    `select question.id, question.prompt, question.position
     from public.learning_quiz_questions question
     where question.quiz_id = $1
     order by question.position asc, question.id asc`, [quizId]) as Promise<QuizQuestionRow[]>
}
async function loadSafeOptions(query: QuizQuery, questionIds: string[]) {
  if (questionIds.length === 0) return []
  return query(
    `select option.id, option.question_id, option.label, option.position
     from public.learning_quiz_options option
     where option.question_id = any($1::uuid[])
     order by option.question_id asc, option.position asc, option.id asc`, [questionIds]) as Promise<QuizOptionRow[]>
}
async function loadScoringOptions(query: QuizQuery, questionIds: string[]) {
  if (questionIds.length === 0) return []
  return query(
    `select option.id, option.question_id, option.label, option.position, option.is_correct
     from public.learning_quiz_options option
     where option.question_id = any($1::uuid[])
     order by option.question_id asc, option.position asc, option.id asc`, [questionIds]) as Promise<QuizScoringOptionRow[]>
}
function buildLearnerQuestions(questionRows: QuizQuestionRow[], optionRows: QuizOptionRow[]) {
  const optionsByQuestion = new Map<string, LearnerQuizOption[]>()
  for (const option of optionRows) {
    const current = optionsByQuestion.get(option.question_id) ?? []
    current.push({ id: option.id, label: option.label, position: Number(option.position) })
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

  async function getQuizForLearner(learnerId: string, slug: string, lessonId: string): Promise<LearnerQuiz | null> {
    const accessRows = await queryRows(quizAccessQuery(false), [learnerId, slug, lessonId]) as QuizAccessRow[]
    const access = accessRows[0]
    if (!access) return null
    const questions = await loadQuestions(queryRows, access.quiz_id)
    const options = await loadSafeOptions(queryRows, questions.map((question) => question.id))
    return {
      id: access.quiz_id,
      lessonId: access.lesson_id,
      passPercentage: Number(access.pass_percentage),
      instructions: access.instructions,
      maxAttempts: access.max_attempts === undefined || access.max_attempts === null ? null : Number(access.max_attempts),
      attemptsUsed: Number(access.attempts_used ?? 0),
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
      const accessRows = await query(quizAccessQuery(true), [learnerId, slug, lessonId]) as QuizAccessRow[]
      const access = accessRows[0]
      if (!access) throw new Error('quiz_not_accessible')
      const attemptsUsed = Number(access.attempts_used ?? 0)
      const maxAttempts = access.max_attempts === undefined || access.max_attempts === null ? null : Number(access.max_attempts)
      if (maxAttempts !== null && attemptsUsed >= maxAttempts) throw new Error('learning_attempt_limit_reached')

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
        const correctOption = correctOptions[0]!
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
           quiz_id, enrollment_id, learner_id, score, total_questions, percentage, pass_percentage, passed, submitted_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, now())
         returning id, submitted_at`,
        [access.quiz_id, access.enrollment_id, learnerId, score, totalQuestions, percentage, passPercentage, passed],
      ) as QuizAttemptRow[]
      const attempt = attemptRows[0]
      if (!attempt) throw new Error('quiz_attempt_create_failed')

      for (const answer of answerResults) {
        await query(
          `insert into public.learning_quiz_attempt_answers (
             attempt_id, question_id, selected_option_id, is_correct, created_at
           ) values ($1, $2, $3, $4, now())`,
          [attempt.id, answer.questionId, answer.selectedOptionId, answer.isCorrect],
        )
      }

      await query(
        `insert into public.learning_progress (
           enrollment_id, lesson_id, first_started_at, viewed_at, attempts_used, updated_at
         ) values ($1, $2, now(), now(), $3, now())
         on conflict (enrollment_id, lesson_id) do update
         set first_started_at = coalesce(public.learning_progress.first_started_at, excluded.first_started_at),
             viewed_at = coalesce(public.learning_progress.viewed_at, excluded.viewed_at),
             attempts_used = greatest(public.learning_progress.attempts_used, excluded.attempts_used),
             updated_at = now()`,
        [access.enrollment_id, access.lesson_id, attemptsUsed + 1],
      )

      const completion = passed ? await completeLesson(query, learnerId, slug, lessonId) : null
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

  return { getQuizForLearner, submitQuizAttempt }
}

export const learnerQuizRepository = createLearnerQuizRepository()
