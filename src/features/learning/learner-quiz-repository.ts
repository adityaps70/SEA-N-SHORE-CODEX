import { randomInt, randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import {
  completeLearningLessonWithQuery,
  type LearnerProgressQuery,
} from './learner-progress-repository'
import { learnerCourseAccessSql } from './course-publication'
import { issueCertificateForFinalQuizWithQuery } from './certificate-repository'
import {
  QUIZ_SUBMIT_GRACE_SECONDS,
  QuizAnswerError,
  answerPolicyOf,
  attemptTotals,
  hasAnswer,
  mayRevealAnswers,
  questionTypeOf,
  scoreAnswer,
  shuffled,
  usesOptions,
  type AnswerPolicy,
  type QuestionType,
  type QuizAnswerInput,
  type ScoredAnswer,
  type ScoringQuestion,
} from './quiz-model'

export type LearnerQuizOption = { id: string; label: string; position: number }
export type LearnerQuizQuestion = {
  id: string
  prompt: string
  position: number
  options: LearnerQuizOption[]
  /** Round B: single-correct and 1 mark when absent. */
  type?: QuestionType
  marks?: number
}
export type LearnerQuizAttemptSummary = {
  attemptId: string
  attemptNumber: number
  submittedAt: string
  score: number
  totalQuestions: number
  percentage: number
  passPercentage: number
  passed: boolean
  /** Round B attempts carry marks; earlier attempts counted 1 per question. */
  scorePoints?: number
  maxPoints?: number
  /** A written answer is waiting for the trainer: pass/fail, completion and the certificate wait too. */
  awaitingGrading?: true
  /** The server submitted it when the time ran out. */
  autoSubmitted?: true
}
export type LearnerQuizSettings = {
  timeLimitMinutes: number | null
  shuffleQuestions: boolean
  shuffleOptions: boolean
  drawCount: number | null
  answerPolicy: AnswerPolicy
}
/** A started attempt of a timed, shuffled or drawn quiz: its questions are fixed until it is submitted. */
export type LearnerQuizSession = {
  id: string
  startedAt: string
  deadlineAt: string | null
  /** The server's clock when this was read, so the countdown never trusts the device's clock. */
  serverNow: string
  questions: LearnerQuizQuestion[]
  answers: Record<string, LearnerSavedAnswer>
}
export type LearnerSavedAnswer = { optionId?: string; optionIds?: string[]; text?: string }
export type LearnerQuiz = {
  id: string
  lessonId: string
  passPercentage: number
  instructions: string | null
  maxAttempts: number | null
  attemptsUsed: number
  /** All questions of a plain quiz; empty for a session quiz until an attempt is started. */
  questions: LearnerQuizQuestion[]
  attemptHistory?: LearnerQuizAttemptSummary[]
  // Round B (the repository always fills these; a quiz without them is a plain, untimed quiz).
  settings?: LearnerQuizSettings
  /** Timed, shuffled or drawn: attempts are started on the server, which fixes the questions and the clock. */
  usesSessions?: boolean
  /** Questions in each attempt (the draw size, or all of them). */
  questionCount?: number
  session?: LearnerQuizSession | null
  awaitingGrading?: boolean
}
export type LearnerQuizAnswerInput = QuizAnswerInput
export type LearnerQuizAttemptAnswerResult = {
  questionId: string
  selectedOptionId: string | null
  correctOptionId: string | null
  isCorrect: boolean
}
/** What the learner may see about one answer after submitting, when the answer policy allows it. */
export type LearnerQuizReviewItem = {
  questionId: string
  type: QuestionType
  isCorrect: boolean
  pointsAwarded: number | null
  maxPoints: number
  selectedOptionIds: string[]
  correctOptionIds: string[]
  textResponse: string | null
  acceptedAnswers: string[]
  explanation: string | null
  awaitingGrading: boolean
}
export type LearnerQuizAttemptResult = {
  attemptId: string
  attemptNumber: number
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
  /** Per-question results; empty when the answer policy does not show answers yet. */
  answers: LearnerQuizAttemptAnswerResult[]
  scorePoints?: number
  maxPoints?: number
  awaitingGrading?: boolean
  autoSubmitted?: boolean
  /** True when the time ran out: answers sent after the deadline were not counted. */
  lateAnswersIgnored?: boolean
  /** Correct answers and explanations, when the answer policy shows them. */
  review?: LearnerQuizReviewItem[]
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
  any_passed?: boolean | null
  awaiting_grading?: string | number | null
  time_limit_minutes?: string | number | null
  shuffle_questions?: boolean | null
  shuffle_options?: boolean | null
  draw_count?: string | number | null
  answer_policy?: string | null
}
type QuizQuestionRow = QueryResultRow & {
  id: string
  prompt: string
  position: string | number
  question_type?: string | null
  marks?: string | number | null
}
type QuizScoringQuestionRow = QuizQuestionRow & {
  negative_marks?: string | number | null
  accepted_answers?: string[] | null
  answers_case_sensitive?: boolean | null
  explanation?: string | null
}
type QuizOptionRow = QueryResultRow & { id: string; question_id: string; label: string; position: string | number }
type QuizScoringOptionRow = QuizOptionRow & { is_correct: boolean }
type QuizAttemptRow = QueryResultRow & {
  id: string
  attempt_number?: string | number
  submitted_at: string | Date
  score?: string | number
  total_questions?: string | number
  percentage?: string | number
  pass_percentage?: string | number
  passed?: boolean
  score_points?: string | number | null
  max_points?: string | number | null
  status?: string | null
  auto_submitted?: boolean | null
}
type QuizAttemptAnswerSnapshotRow = QueryResultRow & {
  question_id: string
  selected_option_id: string | null
  correct_option_id: string | null
  is_correct: boolean
}
type SessionRow = QueryResultRow & {
  id: string
  quiz_id: string
  enrollment_id: string
  learner_id: string
  question_ids: string[]
  option_order: Record<string, string[]> | null
  draft_answers: Record<string, LearnerSavedAnswer> | null
  started_at: string | Date
  deadline_at: string | Date | null
  closed_at: string | Date | null
  attempt_id: string | null
  server_now: string | Date
  expired: boolean
  stale?: boolean
}

function runtimeTransaction<T>(work: (query: QuizQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}
function isoDateTime(value: string | Date) { return value instanceof Date ? value.toISOString() : new Date(value).toISOString() }
function numberOrNull(value: string | number | null | undefined) { return value === null || value === undefined ? null : Number(value) }

function quizAccessQuery(lockEnrollment: boolean) {
  return `select
     enrollment.id as enrollment_id,
     course.id as course_id,
     lesson.id as lesson_id,
     lesson.max_attempts,
     quiz.id as quiz_id,
     quiz.pass_percentage,
     quiz.instructions,
     quiz.time_limit_minutes,
     quiz.shuffle_questions,
     quiz.shuffle_options,
     quiz.draw_count,
     quiz.answer_policy,
     coalesce(attempt_stats.attempts_used, 0)::bigint as attempts_used,
     coalesce(attempt_stats.any_passed, false) as any_passed,
     coalesce(attempt_stats.awaiting_grading, 0)::bigint as awaiting_grading
   from public.learning_quizzes quiz
   inner join public.learning_lessons lesson
     on lesson.id = quiz.lesson_id
    and lesson.lesson_type = 'quiz'
    and lesson.is_published = true
   inner join public.learning_course_sections section
     on section.id = lesson.section_id
   inner join public.learning_courses course
     on course.id = section.course_id
   left join public.learning_mentors mentor
     on mentor.id = course.mentor_id
   left join public.learning_mentor_applications application
     on application.id = mentor.application_id
    and application.user_id = mentor.user_id
   left join public.companies company
     on company.id = course.company_id
   inner join public.learning_enrollments enrollment
     on enrollment.course_id = course.id
    and enrollment.learner_id = $1
    and enrollment.status in ('active', 'completed')
   left join public.learning_progress prerequisite_progress
     on prerequisite_progress.enrollment_id = enrollment.id
    and prerequisite_progress.lesson_id = lesson.prerequisite_lesson_id
   left join lateral (
     select count(*)::bigint as attempts_used,
            bool_or(attempt.passed) as any_passed,
            count(*) filter (where attempt.status = 'awaiting_grading')::bigint as awaiting_grading
     from public.learning_quiz_attempts attempt
     where attempt.enrollment_id = enrollment.id
       and attempt.quiz_id = quiz.id
   ) attempt_stats on true
   where course.slug = $2
     and lesson.id = $3
     -- Published, or archived/removed with the learner already enrolled (shared learner access rule).
     and ${learnerCourseAccessSql()}
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

function settingsOf(access: QuizAccessRow): LearnerQuizSettings {
  return {
    timeLimitMinutes: numberOrNull(access.time_limit_minutes),
    shuffleQuestions: access.shuffle_questions ?? false,
    shuffleOptions: access.shuffle_options ?? false,
    drawCount: numberOrNull(access.draw_count),
    answerPolicy: answerPolicyOf(access.answer_policy),
  }
}

/** Timed, shuffled or drawn quizzes are taken through a server session. */
function needsSession(settings: LearnerQuizSettings) {
  return settings.timeLimitMinutes !== null || settings.shuffleQuestions || settings.shuffleOptions || settings.drawCount !== null
}

function maxAttemptsOf(access: QuizAccessRow) {
  return access.max_attempts === undefined || access.max_attempts === null ? null : Number(access.max_attempts)
}

async function loadQuestions(query: QuizQuery, quizId: string) {
  return query(
    `select question.id, question.prompt, question.position, question.question_type, question.marks
     from public.learning_quiz_questions question
     where question.quiz_id = $1
       and question.removed_at is null
     order by question.position asc, question.id asc`, [quizId]) as Promise<QuizQuestionRow[]>
}
/** The answer key of these questions (server only; never sent before the policy allows). */
async function loadScoringQuestions(query: QuizQuery, quizId: string, questionIds: string[]) {
  if (questionIds.length === 0) return []
  return query(
    `select question.id, question.prompt, question.position, question.question_type, question.marks,
            question.negative_marks, question.accepted_answers, question.answers_case_sensitive, question.explanation
     from public.learning_quiz_questions question
     where question.quiz_id = $1
       and question.id = any($2::uuid[])`, [quizId, questionIds]) as Promise<QuizScoringQuestionRow[]>
}
async function loadSafeOptions(query: QuizQuery, questionIds: string[]) {
  if (questionIds.length === 0) return []
  return query(
    `select option.id, option.question_id, option.label, option.position
     from public.learning_quiz_options option
     where option.question_id = any($1::uuid[])
       and option.removed_at is null
     order by option.question_id asc, option.position asc, option.id asc`, [questionIds]) as Promise<QuizOptionRow[]>
}
async function loadScoringOptions(query: QuizQuery, questionIds: string[]) {
  if (questionIds.length === 0) return []
  return query(
    `select option.id, option.question_id, option.label, option.position, option.is_correct
     from public.learning_quiz_options option
     where option.question_id = any($1::uuid[])
       and option.removed_at is null
     order by option.question_id asc, option.position asc, option.id asc`, [questionIds]) as Promise<QuizScoringOptionRow[]>
}
function summaryOf(attempt: QuizAttemptRow): LearnerQuizAttemptSummary {
  return {
    attemptId: attempt.id,
    attemptNumber: Number(attempt.attempt_number),
    submittedAt: isoDateTime(attempt.submitted_at),
    score: Number(attempt.score),
    totalQuestions: Number(attempt.total_questions),
    percentage: Number(attempt.percentage),
    passPercentage: Number(attempt.pass_percentage),
    passed: Boolean(attempt.passed),
    ...(attempt.score_points !== null && attempt.score_points !== undefined
      ? { scorePoints: Number(attempt.score_points), maxPoints: Number(attempt.max_points) }
      : {}),
    ...(attempt.status === 'awaiting_grading' ? { awaitingGrading: true as const } : {}),
    ...(attempt.auto_submitted ? { autoSubmitted: true as const } : {}),
  }
}
async function loadAttemptHistory(query: QuizQuery, enrollmentId: string, quizId: string, learnerId: string) {
  const rows = await query(
    `select
       attempt.id,
       attempt.attempt_number,
       attempt.submitted_at,
       attempt.score,
       attempt.total_questions,
       attempt.percentage,
       attempt.pass_percentage,
       attempt.passed,
       attempt.score_points,
       attempt.max_points,
       attempt.status,
       attempt.auto_submitted
     from public.learning_quiz_attempts attempt
     where attempt.enrollment_id = $1
       and attempt.quiz_id = $2
       and attempt.learner_id = $3
     order by attempt.attempt_number desc`,
    [enrollmentId, quizId, learnerId],
  ) as QuizAttemptRow[]
  return rows.map(summaryOf)
}
function learnerQuestion(question: QuizQuestionRow, options: LearnerQuizOption[]): LearnerQuizQuestion {
  return {
    id: question.id,
    prompt: question.prompt,
    position: Number(question.position),
    options,
    type: questionTypeOf(question.question_type),
    marks: question.marks === null || question.marks === undefined ? 1 : Number(question.marks),
  }
}
function buildLearnerQuestions(questionRows: QuizQuestionRow[], optionRows: QuizOptionRow[], optionOrder: Record<string, string[]> = {}) {
  const optionsByQuestion = new Map<string, LearnerQuizOption[]>()
  for (const option of optionRows) {
    const current = optionsByQuestion.get(option.question_id) ?? []
    current.push({ id: option.id, label: option.label, position: Number(option.position) })
    optionsByQuestion.set(option.question_id, current)
  }
  return questionRows.map((question) => {
    const options = optionsByQuestion.get(question.id) ?? []
    const order = optionOrder[question.id]
    if (order) {
      const rank = new Map(order.map((id, index) => [id, index]))
      options.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    }
    return learnerQuestion(question, options)
  })
}
function mapPersistedAnswers(rows: QuizAttemptAnswerSnapshotRow[]): LearnerQuizAttemptAnswerResult[] {
  return rows.map((answer) => ({
    questionId: answer.question_id,
    selectedOptionId: answer.selected_option_id,
    correctOptionId: answer.correct_option_id,
    isCorrect: answer.is_correct,
  }))
}
function scoringQuestion(row: QuizScoringQuestionRow, options: QuizScoringOptionRow[]): ScoringQuestion {
  return {
    id: row.id,
    type: questionTypeOf(row.question_type),
    marks: row.marks === null || row.marks === undefined ? 1 : Number(row.marks),
    negativeMarks: row.negative_marks === null || row.negative_marks === undefined ? 0 : Number(row.negative_marks),
    acceptedAnswers: row.accepted_answers ?? [],
    caseSensitive: row.answers_case_sensitive ?? false,
    options: options.map((option) => ({ id: option.id, isCorrect: option.is_correct })),
  }
}
function reviewItem(question: ScoringQuestion, explanation: string | null, scored: ScoredAnswer): LearnerQuizReviewItem {
  return {
    questionId: scored.questionId,
    type: question.type,
    isCorrect: scored.isCorrect,
    pointsAwarded: scored.pointsAwarded,
    maxPoints: scored.maxPoints,
    selectedOptionIds: scored.selectedOptionIds ?? (scored.selectedOptionId ? [scored.selectedOptionId] : []),
    correctOptionIds: scored.correctOptionIds ?? (scored.correctOptionId ? [scored.correctOptionId] : []),
    textResponse: scored.textResponse,
    acceptedAnswers: question.type === 'fill_blank' ? [...question.acceptedAnswers] : [],
    explanation,
    awaitingGrading: scored.gradingStatus === 'pending',
  }
}

/** Keeps only answers to the session's questions, with options that belong to them. */
function sanitiseAnswers(answers: readonly QuizAnswerInput[], questions: Map<string, { type: QuestionType; optionIds: Set<string> }>) {
  const clean = new Map<string, LearnerSavedAnswer>()
  for (const answer of answers) {
    const question = questions.get(answer.questionId)
    if (!question) throw new QuizAnswerError()
    if (question.type === 'multiple_choice') {
      const ids = [...new Set(answer.optionIds ?? [])]
      if (ids.some((id) => !question.optionIds.has(id))) throw new QuizAnswerError()
      clean.set(answer.questionId, { optionIds: ids })
    } else if (usesOptions(question.type)) {
      if (answer.optionId && !question.optionIds.has(answer.optionId)) throw new QuizAnswerError()
      clean.set(answer.questionId, answer.optionId ? { optionId: answer.optionId } : {})
    } else {
      const text = (answer.text ?? '').slice(0, 10000)
      clean.set(answer.questionId, text ? { text } : {})
    }
  }
  return clean
}

type ScoredAttempt = {
  questions: QuizScoringQuestionRow[]
  scoring: Map<string, ScoringQuestion>
  scored: ScoredAnswer[]
}

async function scoreQuestions(query: QuizQuery, quizId: string, questionIds: string[], answers: Map<string, QuizAnswerInput>): Promise<ScoredAttempt> {
  const rows = await loadScoringQuestions(query, quizId, questionIds)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const ordered = questionIds.map((id) => byId.get(id)).filter((row): row is QuizScoringQuestionRow => Boolean(row))
  if (ordered.length === 0 || ordered.length !== questionIds.length) throw new Error('quiz_not_ready')
  const options = await loadScoringOptions(query, questionIds)
  const scoring = new Map(ordered.map((row) => [row.id, scoringQuestion(row, options.filter((option) => option.question_id === row.id))]))
  for (const question of scoring.values()) {
    if (usesOptions(question.type) && question.options.length < 2) throw new Error('quiz_not_ready')
  }
  const scored = ordered.map((row) => scoreAnswer(scoring.get(row.id)!, answers.get(row.id)))
  return { questions: ordered, scoring, scored }
}

export function createLearnerQuizRepository(input: {
  query?: QuizQuery
  transaction?: QuizTransaction
  completeLesson?: CompleteLessonWithQuery
  /** Random integer source for draws and shuffles (tests pass a fixed one). */
  randomInt?: (n: number) => number
} = {}) {
  const queryRows: QuizQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction
  const completeLesson = input.completeLesson ?? completeLearningLessonWithQuery
  const random = input.randomInt ?? ((n: number) => randomInt(n))

  /**
   * Writes a scored attempt, its answers and the attempt count, closes the session (if any) and completes the
   * lesson when it passed. An attempt with a written answer waits for the trainer: it is not passed yet.
   */
  async function recordAttempt(query: QuizQuery, context: {
    access: QuizAccessRow
    learnerId: string
    slug: string
    lessonId: string
    submissionKey: string
    attempt: ScoredAttempt
    session?: { id: string; startedAt: string | Date; autoSubmitted: boolean }
  }): Promise<LearnerQuizAttemptResult> {
    const { access, learnerId, attempt } = context
    const attemptCountRows = await query(
      `select count(*)::bigint as attempts_used
       from public.learning_quiz_attempts attempt
       where attempt.enrollment_id = $1
         and attempt.quiz_id = $2
         and attempt.learner_id = $3`,
      [access.enrollment_id, access.quiz_id, learnerId],
    ) as Array<QueryResultRow & { attempts_used: string | number }>
    const attemptsUsed = Number(attemptCountRows[0]?.attempts_used ?? 0)
    const maxAttempts = maxAttemptsOf(access)
    // A started session already counted against the limit when it began.
    if (!context.session && maxAttempts !== null && attemptsUsed >= maxAttempts) throw new Error('learning_attempt_limit_reached')
    const attemptNumber = attemptsUsed + 1

    const totals = attemptTotals(attempt.scored)
    const totalQuestions = attempt.scored.length
    const passPercentage = Number(access.pass_percentage)
    const passed = !totals.awaitingGrading && totals.percentage >= passPercentage
    const status = totals.awaitingGrading ? 'awaiting_grading' : 'completed'
    const attemptRows = await query(
      `insert into public.learning_quiz_attempts (
         quiz_id, enrollment_id, learner_id, attempt_number, submission_key,
         score, total_questions, percentage, pass_percentage, passed, submitted_at,
         score_points, max_points, status, session_id, started_at, auto_submitted
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11, $12, $13, $14, $15, $16)
       returning id, attempt_number, submitted_at`,
      [
        access.quiz_id,
        access.enrollment_id,
        learnerId,
        attemptNumber,
        context.submissionKey,
        totals.correctCount,
        totalQuestions,
        totals.percentage,
        passPercentage,
        passed,
        totals.scorePoints,
        totals.maxPoints,
        status,
        context.session?.id ?? null,
        context.session ? isoDateTime(context.session.startedAt) : null,
        context.session?.autoSubmitted ?? false,
      ],
    ) as QuizAttemptRow[]
    const created = attemptRows[0]
    if (!created) throw new Error('quiz_attempt_create_failed')

    for (const answer of attempt.scored) {
      await query(
        `insert into public.learning_quiz_attempt_answers (
           attempt_id, question_id, selected_option_id, correct_option_id, is_correct, created_at,
           selected_option_ids, correct_option_ids, text_response, points_awarded, max_points, grading_status
         ) values ($1, $2, $3, $4, $5, now(), $6::uuid[], $7::uuid[], $8, $9, $10, $11)`,
        [
          created.id,
          answer.questionId,
          answer.selectedOptionId,
          answer.correctOptionId,
          answer.isCorrect,
          answer.selectedOptionIds,
          answer.correctOptionIds,
          answer.textResponse,
          answer.pointsAwarded,
          answer.maxPoints,
          answer.gradingStatus,
        ],
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
      [access.enrollment_id, access.lesson_id, attemptNumber],
    )

    if (context.session) {
      await query(
        `update public.learning_quiz_attempt_sessions
         set closed_at = now(), attempt_id = $2, updated_at = now()
         where id = $1 and closed_at is null`,
        [context.session.id, created.id],
      )
    }

    const completion = passed ? await completeLesson(query, learnerId, context.slug, context.lessonId) : null
    // A course that issues its certificate on this final quiz issues it now (round B, B4).
    if (passed) await issueCertificateForFinalQuizWithQuery(query, access.enrollment_id, access.lesson_id)
    const reveal = mayRevealAnswers(answerPolicyOf(access.answer_policy), {
      anyPassed: passed || Boolean(access.any_passed),
      attemptsUsed: attemptNumber,
      maxAttempts,
    })
    return {
      attemptId: created.id,
      attemptNumber: Number(created.attempt_number ?? attemptNumber),
      submittedAt: isoDateTime(created.submitted_at),
      score: totals.correctCount,
      totalQuestions,
      percentage: totals.percentage,
      passPercentage,
      passed,
      enrollmentCompleted: completion?.enrollmentCompleted ?? false,
      completedLessons: completion?.completedLessons ?? null,
      totalLessons: completion?.totalLessons ?? null,
      progressPercent: completion?.progressPercent ?? null,
      answers: reveal
        ? attempt.scored.map((answer) => ({
          questionId: answer.questionId,
          selectedOptionId: answer.selectedOptionId,
          correctOptionId: answer.correctOptionId,
          isCorrect: answer.isCorrect,
        }))
        : [],
      scorePoints: totals.scorePoints,
      maxPoints: totals.maxPoints,
      awaitingGrading: totals.awaitingGrading,
      autoSubmitted: context.session?.autoSubmitted ?? false,
      ...(reveal
        ? {
          review: attempt.questions.map((row, index) =>
            reviewItem(attempt.scoring.get(row.id)!, row.explanation ?? null, attempt.scored[index]!)),
        }
        : {}),
    }
  }

  async function loadOpenSession(query: QuizQuery, enrollmentId: string, quizId: string, lock: boolean) {
    const rows = await query(
      `select session.id, session.quiz_id, session.enrollment_id, session.learner_id, session.question_ids,
              session.option_order, session.draft_answers, session.started_at, session.deadline_at,
              session.closed_at, session.attempt_id, now() as server_now,
              (session.deadline_at is not null
                and now() > session.deadline_at + make_interval(secs => ${QUIZ_SUBMIT_GRACE_SECONDS})) as expired,
              -- A reviewed edit deleted one of its questions: the attempt is closed uncounted and started afresh.
              (select count(*) from public.learning_quiz_questions question where question.id = any(session.question_ids))
                < cardinality(session.question_ids) as stale
       from public.learning_quiz_attempt_sessions session
       where session.enrollment_id = $1
         and session.quiz_id = $2
         and session.closed_at is null
       limit 1${lock ? '\n       for update of session' : ''}`,
      [enrollmentId, quizId],
    ) as SessionRow[]
    return rows[0] ?? null
  }

  /** Closes an attempt whose questions changed under it, without recording (or counting) it. */
  async function closeStaleSession(query: QuizQuery, sessionId: string) {
    await query(
      `update public.learning_quiz_attempt_sessions set closed_at = now(), updated_at = now() where id = $1 and closed_at is null`,
      [sessionId],
    )
  }

  async function sessionView(query: QuizQuery, session: SessionRow): Promise<LearnerQuizSession> {
    const questionRows = await query(
      `select question.id, question.prompt, question.position, question.question_type, question.marks
       from public.learning_quiz_questions question
       where question.id = any($1::uuid[])`,
      [session.question_ids],
    ) as QuizQuestionRow[]
    const byId = new Map(questionRows.map((row) => [row.id, row]))
    const ordered = session.question_ids.map((id) => byId.get(id)).filter((row): row is QuizQuestionRow => Boolean(row))
    const options = await loadSafeOptions(query, session.question_ids)
    return {
      id: session.id,
      startedAt: isoDateTime(session.started_at),
      deadlineAt: session.deadline_at ? isoDateTime(session.deadline_at) : null,
      serverNow: isoDateTime(session.server_now),
      questions: buildLearnerQuestions(ordered, options, session.option_order ?? {}).map((question, index) => ({ ...question, position: index })),
      answers: session.draft_answers ?? {},
    }
  }

  /** Scores a session from its saved answers (plus, before the deadline, what was just sent) and closes it. */
  async function finalizeSession(query: QuizQuery, context: {
    access: QuizAccessRow
    learnerId: string
    slug: string
    lessonId: string
    session: SessionRow
    submitted?: readonly QuizAnswerInput[]
    submissionKey?: string
  }) {
    const { session } = context
    const saved = new Map<string, QuizAnswerInput>(
      Object.entries(session.draft_answers ?? {}).map(([questionId, answer]) => [questionId, { questionId, ...answer }]),
    )
    const late = session.expired
    if (!late && context.submitted) {
      for (const answer of context.submitted) saved.set(answer.questionId, answer)
    }
    const attempt = await scoreQuestions(query, context.access.quiz_id, session.question_ids, saved)
    const result = await recordAttempt(query, {
      access: context.access,
      learnerId: context.learnerId,
      slug: context.slug,
      lessonId: context.lessonId,
      submissionKey: context.submissionKey ?? randomUUID(),
      attempt,
      session: { id: session.id, startedAt: session.started_at, autoSubmitted: late || !context.submitted },
    })
    return { ...result, lateAnswersIgnored: late && Boolean(context.submitted?.length) }
  }

  async function getQuizForLearner(learnerId: string, slug: string, lessonId: string): Promise<LearnerQuiz | null> {
    const accessRows = await queryRows(quizAccessQuery(false), [learnerId, slug, lessonId]) as QuizAccessRow[]
    let access = accessRows[0]
    if (!access) return null
    const settings = settingsOf(access)
    const usesSessions = needsSession(settings)

    let session: LearnerQuizSession | null = null
    if (usesSessions) {
      const open = await loadOpenSession(queryRows, access.enrollment_id, access.quiz_id, false)
      if (open?.stale) {
        await closeStaleSession(queryRows, open.id)
      } else if (open?.expired) {
        // The time ran out while the learner was away: submit what was saved, then show the result in history.
        await transaction(async (query) => {
          const locked = (await query(quizAccessQuery(true), [learnerId, slug, lessonId]) as QuizAccessRow[])[0]
          const current = locked ? await loadOpenSession(query, locked.enrollment_id, locked.quiz_id, true) : null
          if (locked && current?.expired) await finalizeSession(query, { access: locked, learnerId, slug, lessonId, session: current })
        })
        access = (await queryRows(quizAccessQuery(false), [learnerId, slug, lessonId]) as QuizAccessRow[])[0] ?? access
      } else if (open) {
        session = await sessionView(queryRows, open)
      }
    }

    const questions = usesSessions ? [] : await loadQuestions(queryRows, access.quiz_id)
    const options = await loadSafeOptions(queryRows, questions.map((question) => question.id))
    const attemptHistory = await loadAttemptHistory(queryRows, access.enrollment_id, access.quiz_id, learnerId)
    const poolSize = usesSessions
      ? Number((await queryRows(
        `select count(*)::bigint as count from public.learning_quiz_questions where quiz_id = $1 and removed_at is null`,
        [access.quiz_id],
      ))[0]?.count ?? 0)
      : questions.length
    return {
      id: access.quiz_id,
      lessonId: access.lesson_id,
      passPercentage: Number(access.pass_percentage),
      instructions: access.instructions,
      maxAttempts: maxAttemptsOf(access),
      attemptsUsed: Number(access.attempts_used ?? 0),
      questions: buildLearnerQuestions(questions, options),
      ...(attemptHistory.length > 0 ? { attemptHistory } : {}),
      settings,
      usesSessions,
      questionCount: settings.drawCount !== null ? Math.min(settings.drawCount, poolSize) : poolSize,
      session,
      awaitingGrading: Number(access.awaiting_grading ?? 0) > 0,
    }
  }

  /**
   * Starts (or resumes) an attempt of a session quiz: draws its questions, fixes their order and option order,
   * and sets the server deadline. Starting counts against the attempt limit.
   */
  async function startQuizAttempt(learnerId: string, slug: string, lessonId: string): Promise<LearnerQuizSession> {
    return transaction(async (query) => {
      let access = (await query(quizAccessQuery(true), [learnerId, slug, lessonId]) as QuizAccessRow[])[0]
      if (!access) throw new Error('quiz_not_accessible')
      const settings = settingsOf(access)
      if (!needsSession(settings)) throw new Error('quiz_session_not_needed')

      const open = await loadOpenSession(query, access.enrollment_id, access.quiz_id, true)
      if (open?.stale) await closeStaleSession(query, open.id)
      else if (open && !open.expired) return sessionView(query, open)
      if (open?.expired && !open.stale) {
        await finalizeSession(query, { access, learnerId, slug, lessonId, session: open })
        access = (await query(quizAccessQuery(true), [learnerId, slug, lessonId]) as QuizAccessRow[])[0]
        if (!access) throw new Error('quiz_not_accessible')
      }
      const attemptsUsed = Number(access.attempts_used ?? 0)
      if (Number(access.awaiting_grading ?? 0) > 0) throw new Error('quiz_awaiting_grading')
      const maxAttempts = maxAttemptsOf(access)
      if (maxAttempts !== null && attemptsUsed >= maxAttempts) throw new Error('learning_attempt_limit_reached')

      const pool = await loadQuestions(query, access.quiz_id)
      if (pool.length === 0) throw new Error('quiz_not_ready')
      const drawn = settings.drawCount !== null && settings.drawCount < pool.length
        ? shuffled(pool, random).slice(0, settings.drawCount)
        : pool
      const ordered = settings.shuffleQuestions
        ? shuffled(drawn, random)
        : [...drawn].sort((a, b) => Number(a.position) - Number(b.position))
      const options = await loadSafeOptions(query, ordered.map((question) => question.id))
      const optionOrder: Record<string, string[]> = {}
      for (const question of ordered) {
        const ids = options.filter((option) => option.question_id === question.id).map((option) => option.id)
        // True/false keeps True first.
        optionOrder[question.id] = settings.shuffleOptions && questionTypeOf(question.question_type) !== 'true_false'
          ? shuffled(ids, random)
          : ids
      }
      const created = await query(
        `insert into public.learning_quiz_attempt_sessions (
           quiz_id, enrollment_id, learner_id, question_ids, option_order, started_at, deadline_at
         ) values (
           $1, $2, $3, $4::uuid[], $5::jsonb, now(),
           case when $6::integer is null then null else now() + make_interval(mins => $6::integer) end
         )
         returning id, quiz_id, enrollment_id, learner_id, question_ids, option_order, draft_answers, started_at,
                   deadline_at, closed_at, attempt_id, now() as server_now, false as expired`,
        [access.quiz_id, access.enrollment_id, learnerId, ordered.map((question) => question.id), JSON.stringify(optionOrder), settings.timeLimitMinutes],
      ) as SessionRow[]
      if (!created[0]) throw new Error('quiz_session_create_failed')
      return sessionView(query, created[0])
    })
  }

  async function lockedSession(query: QuizQuery, learnerId: string, slug: string, lessonId: string, sessionId: string) {
    const access = (await query(quizAccessQuery(true), [learnerId, slug, lessonId]) as QuizAccessRow[])[0]
    if (!access) throw new Error('quiz_not_accessible')
    const session = await loadOpenSession(query, access.enrollment_id, access.quiz_id, true)
    if (session?.stale) throw new Error('quiz_session_stale')
    return { access, session: session && session.id === sessionId && session.learner_id === learnerId ? session : null }
  }

  async function sessionQuestionShapes(query: QuizQuery, session: SessionRow) {
    const rows = await query(
      `select question.id, question.question_type
       from public.learning_quiz_questions question
       where question.id = any($1::uuid[])`,
      [session.question_ids],
    ) as Array<QueryResultRow & { id: string; question_type: string | null }>
    const options = await loadSafeOptions(query, session.question_ids)
    return new Map(rows.map((row) => [row.id, {
      type: questionTypeOf(row.question_type),
      optionIds: new Set(options.filter((option) => option.question_id === row.id).map((option) => option.id)),
    }]))
  }

  /**
   * Saves answers to a started attempt. After the deadline (plus a short network allowance) nothing is saved:
   * the attempt is submitted with what was saved before, and the result is returned instead.
   */
  async function saveQuizAnswers(learnerId: string, slug: string, lessonId: string, sessionId: string, answers: readonly QuizAnswerInput[]) {
    return transaction(async (query): Promise<{ saved: true; savedAt: string } | { saved: false; result: LearnerQuizAttemptResult }> => {
      const { access, session } = await lockedSession(query, learnerId, slug, lessonId, sessionId)
      if (!session) throw new Error('quiz_session_closed')
      if (session.expired) {
        return { saved: false, result: await finalizeSession(query, { access, learnerId, slug, lessonId, session, submitted: answers }) }
      }
      const clean = sanitiseAnswers(answers, await sessionQuestionShapes(query, session))
      const rows = await query(
        `update public.learning_quiz_attempt_sessions
         set draft_answers = draft_answers || $2::jsonb, updated_at = now()
         where id = $1 and closed_at is null
           and (deadline_at is null or now() <= deadline_at + make_interval(secs => ${QUIZ_SUBMIT_GRACE_SECONDS}))
         returning updated_at`,
        [session.id, JSON.stringify(Object.fromEntries(clean))],
      ) as Array<QueryResultRow & { updated_at: string | Date }>
      if (!rows[0]) throw new Error('quiz_time_up')
      return { saved: true, savedAt: isoDateTime(rows[0].updated_at) }
    })
  }

  async function submitQuizAttempt(
    learnerId: string,
    slug: string,
    lessonId: string,
    answers: LearnerQuizAnswerInput[],
    submissionKey: string = randomUUID(),
    sessionId?: string | null,
  ): Promise<LearnerQuizAttemptResult> {
    return transaction(async (query) => {
      const accessRows = await query(quizAccessQuery(true), [learnerId, slug, lessonId]) as QuizAccessRow[]
      const access = accessRows[0]
      if (!access) throw new Error('quiz_not_accessible')

      const existingAttempts = await query(
        `select
           attempt.id,
           attempt.attempt_number,
           attempt.submitted_at,
           attempt.score,
           attempt.total_questions,
           attempt.percentage,
           attempt.pass_percentage,
           attempt.passed,
           attempt.score_points,
           attempt.max_points,
           attempt.status,
           attempt.auto_submitted
         from public.learning_quiz_attempts attempt
         where attempt.enrollment_id = $1
           and attempt.quiz_id = $2
           and attempt.learner_id = $3
           and attempt.submission_key = $4
         limit 1`,
        [access.enrollment_id, access.quiz_id, learnerId, submissionKey],
      ) as QuizAttemptRow[]
      const existingAttempt = existingAttempts[0]
      if (existingAttempt) {
        const persistedAnswers = await query(
          `select
             answer.question_id,
             answer.selected_option_id,
             answer.correct_option_id,
             answer.is_correct
           from public.learning_quiz_attempt_answers answer
           where answer.attempt_id = $1
           order by answer.id asc`,
          [existingAttempt.id],
        ) as QuizAttemptAnswerSnapshotRow[]
        const summary = summaryOf(existingAttempt)
        const reveal = mayRevealAnswers(answerPolicyOf(access.answer_policy), {
          anyPassed: Boolean(existingAttempt.passed) || Boolean(access.any_passed),
          attemptsUsed: Number(access.attempts_used ?? summary.attemptNumber),
          maxAttempts: maxAttemptsOf(access),
        })
        return {
          attemptId: existingAttempt.id,
          attemptNumber: summary.attemptNumber,
          submittedAt: summary.submittedAt,
          score: summary.score,
          totalQuestions: summary.totalQuestions,
          percentage: summary.percentage,
          passPercentage: summary.passPercentage,
          passed: summary.passed,
          enrollmentCompleted: false,
          completedLessons: null,
          totalLessons: null,
          progressPercent: null,
          answers: reveal ? mapPersistedAnswers(persistedAnswers) : [],
          ...(summary.scorePoints !== undefined ? { scorePoints: summary.scorePoints, maxPoints: summary.maxPoints } : {}),
          ...(summary.awaitingGrading ? { awaitingGrading: true } : {}),
          ...(summary.autoSubmitted ? { autoSubmitted: true } : {}),
        }
      }

      if (needsSession(settingsOf(access))) {
        const session = sessionId ? await loadOpenSession(query, access.enrollment_id, access.quiz_id, true) : null
        if (session?.stale) throw new Error('quiz_session_stale')
        if (!session || session.id !== sessionId || session.learner_id !== learnerId) throw new Error('quiz_session_closed')
        sanitiseAnswers(answers, await sessionQuestionShapes(query, session))
        return finalizeSession(query, { access, learnerId, slug, lessonId, session, submitted: answers, submissionKey })
      }

      if (Number(access.awaiting_grading ?? 0) > 0) throw new Error('quiz_awaiting_grading')
      const attemptsUsed = Number(access.attempts_used ?? 0)
      const maxAttempts = maxAttemptsOf(access)
      if (maxAttempts !== null && attemptsUsed >= maxAttempts) throw new Error('learning_attempt_limit_reached')

      // A plain quiz: every question, every one answered.
      const questionRows = await loadQuestions(query, access.quiz_id)
      if (questionRows.length === 0) throw new Error('quiz_not_ready')
      const answersByQuestion = new Map<string, LearnerQuizAnswerInput>()
      if (answers.length !== questionRows.length) throw new Error('quiz_answers_invalid')
      for (const answer of answers) {
        if (answersByQuestion.has(answer.questionId)) throw new Error('quiz_answers_invalid')
        answersByQuestion.set(answer.questionId, answer)
      }
      for (const question of questionRows) {
        if (!hasAnswer(questionTypeOf(question.question_type), answersByQuestion.get(question.id))) throw new Error('quiz_answers_invalid')
      }
      const attempt = await scoreQuestions(query, access.quiz_id, questionRows.map((question) => question.id), answersByQuestion)
      return recordAttempt(query, { access, learnerId, slug, lessonId, submissionKey, attempt })
    })
  }

  return { getQuizForLearner, startQuizAttempt, saveQuizAnswers, submitQuizAttempt }
}

/**
 * Hourly: timed attempts whose time ran out while the learner was away are submitted with their saved
 * answers, so a result, the attempt count and (for a pass) completion never wait for the learner to return.
 */
export async function finalizeExpiredQuizSessions(transaction: QuizTransaction, input: { limit?: number; repository?: ReturnType<typeof createLearnerQuizRepository> } = {}) {
  const expired = await transaction(async (query) => query(
    `select session.id, session.learner_id, course.slug, lesson.id as lesson_id
     from public.learning_quiz_attempt_sessions session
     inner join public.learning_quizzes quiz on quiz.id = session.quiz_id
     inner join public.learning_lessons lesson on lesson.id = quiz.lesson_id
     inner join public.learning_course_sections section on section.id = lesson.section_id
     inner join public.learning_courses course on course.id = section.course_id
     where session.closed_at is null
       and session.deadline_at is not null
       and now() > session.deadline_at + make_interval(secs => ${QUIZ_SUBMIT_GRACE_SECONDS})
     order by session.deadline_at asc, session.id asc
     limit $1`,
    [input.limit ?? 200],
  )) as Array<QueryResultRow & { id: string; learner_id: string; slug: string; lesson_id: string }>
  const repository = input.repository ?? createLearnerQuizRepository({ transaction })
  let finalized = 0
  let closed = 0
  for (const row of expired) {
    try {
      // Reading the quiz submits an expired session, under the learner's own access rules.
      const quiz = await repository.getQuizForLearner(row.learner_id, row.slug, row.lesson_id)
      if (quiz) {
        finalized += 1
      } else {
        // The learner no longer has the quiz (enrolment ended, material unpublished): close it without an attempt.
        await transaction((query) => query(
          `update public.learning_quiz_attempt_sessions set closed_at = now(), updated_at = now() where id = $1 and closed_at is null`,
          [row.id],
        ))
        closed += 1
      }
    } catch (error) {
      console.error('[learning_quiz_session_finalize_error]', { code: error instanceof Error ? error.message.slice(0, 80) : 'unknown_error' })
    }
  }
  return { expired: expired.length, finalized, closed }
}

export const learnerQuizRepository = createLearnerQuizRepository()
