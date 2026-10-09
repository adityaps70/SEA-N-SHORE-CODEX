/**
 * Learning round B: the quiz question model shared by Studio, the learner player and the server.
 * Pure and client-safe; the server is the only place that scores (it alone sees the answer key).
 */

export const QUESTION_TYPES = ['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'subjective'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: 'Single correct answer',
  multiple_choice: 'Multiple correct answers',
  true_false: 'True or false',
  fill_blank: 'Fill in the blank',
  subjective: 'Written answer (graded by the trainer)',
}

/** Short labels for chips and tables. */
export const QUESTION_TYPE_SHORT_LABELS: Record<QuestionType, string> = {
  single_choice: 'Single correct',
  multiple_choice: 'Multiple correct',
  true_false: 'True / false',
  fill_blank: 'Fill in the blank',
  subjective: 'Written answer',
}

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]
export const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

export const ANSWER_POLICIES = ['never', 'after_each_attempt', 'after_pass', 'after_last_attempt'] as const
export type AnswerPolicy = (typeof ANSWER_POLICIES)[number]
export const ANSWER_POLICY_LABELS: Record<AnswerPolicy, string> = {
  never: 'Never show correct answers',
  after_each_attempt: 'After each attempt',
  after_pass: 'After the learner passes',
  after_last_attempt: 'After the last attempt',
}

/** The two options of a true/false question, in this order. */
export const TRUE_FALSE_LABELS = ['True', 'False'] as const

/** Network allowance after a timed attempt's deadline; anything later is refused by the server. */
export const QUIZ_SUBMIT_GRACE_SECONDS = 15

export const QUESTION_LIMITS = {
  prompt: 4000,
  option: 2000,
  options: 20,
  explanation: 4000,
  acceptedAnswer: 200,
  acceptedAnswers: 20,
  topic: 80,
  marks: 100,
  textResponse: 10000,
} as const

export const QUIZ_LIMITS = {
  questions: 200,
  timeLimitMinutes: 600,
  drawCount: 200,
} as const

export function isQuestionType(value: unknown): value is QuestionType {
  return typeof value === 'string' && (QUESTION_TYPES as readonly string[]).includes(value)
}

export function isAnswerPolicy(value: unknown): value is AnswerPolicy {
  return typeof value === 'string' && (ANSWER_POLICIES as readonly string[]).includes(value)
}

export function questionTypeOf(value: unknown): QuestionType {
  return isQuestionType(value) ? value : 'single_choice'
}

export function answerPolicyOf(value: unknown): AnswerPolicy {
  return isAnswerPolicy(value) ? value : 'after_each_attempt'
}

/** Types answered by picking options. */
export function usesOptions(type: QuestionType) {
  return type === 'single_choice' || type === 'multiple_choice' || type === 'true_false'
}

/** Types with exactly one correct option. */
export function singleAnswer(type: QuestionType) {
  return type === 'single_choice' || type === 'true_false'
}

/** Rounds marks to hundredths (numeric(…, 2) in the database). */
export function roundMarks(value: number) {
  return Math.round(value * 100) / 100
}

/** Fill-in-the-blank matching: surrounding and repeated spaces never matter; case matters only when asked. */
export function normaliseFillAnswer(value: string, caseSensitive: boolean) {
  const spaced = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return caseSensitive ? spaced : spaced.toLocaleLowerCase('en')
}

export type ScoringOption = { id: string; isCorrect: boolean }
export type ScoringQuestion = {
  id: string
  type: QuestionType
  marks: number
  negativeMarks: number
  acceptedAnswers: readonly string[]
  caseSensitive: boolean
  options: readonly ScoringOption[]
}

/** What a learner sent for one question. Only the field for the question's type is read. */
export type QuizAnswerInput = {
  questionId: string
  optionId?: string | null
  optionIds?: readonly string[] | null
  text?: string | null
}

export type ScoredAnswer = {
  questionId: string
  answered: boolean
  selectedOptionId: string | null
  selectedOptionIds: string[] | null
  textResponse: string | null
  correctOptionId: string | null
  correctOptionIds: string[] | null
  isCorrect: boolean
  /** Null while a written answer waits for the trainer. */
  pointsAwarded: number | null
  maxPoints: number
  gradingStatus: 'auto' | 'pending'
}

export class QuizAnswerError extends Error {
  constructor() {
    super('quiz_answers_invalid')
  }
}

/** True when the input holds an answer for a question of this type. */
export function hasAnswer(type: QuestionType, answer: QuizAnswerInput | undefined) {
  if (!answer) return false
  if (type === 'multiple_choice') return Boolean(answer.optionIds && answer.optionIds.length > 0)
  if (usesOptions(type)) return Boolean(answer.optionId)
  return Boolean(answer.text && answer.text.trim())
}

/**
 * Scores one answer against the key. An option that does not belong to the question is refused (never
 * silently scored). A wrong answer costs the question's negative marks; an unanswered one scores 0. A written
 * answer is never scored here: it waits for the trainer.
 */
export function scoreAnswer(question: ScoringQuestion, answer: QuizAnswerInput | undefined): ScoredAnswer {
  const maxPoints = roundMarks(question.marks)
  const optionIds = new Set(question.options.map((option) => option.id))
  const correct = question.options.filter((option) => option.isCorrect).map((option) => option.id)
  const answered = hasAnswer(question.type, answer)
  const base = {
    questionId: question.id,
    answered,
    selectedOptionId: null,
    selectedOptionIds: null,
    textResponse: null,
    correctOptionId: null,
    correctOptionIds: null,
    maxPoints,
  } satisfies Partial<ScoredAnswer>
  const wrongPoints = answered ? -roundMarks(question.negativeMarks) : 0

  switch (question.type) {
    case 'single_choice':
    case 'true_false': {
      const correctOptionId = correct[0] ?? null
      if (!correctOptionId || correct.length !== 1) throw new Error('quiz_not_ready')
      const selected = answered ? answer!.optionId! : null
      if (selected !== null && !optionIds.has(selected)) throw new QuizAnswerError()
      const isCorrect = selected === correctOptionId
      return { ...base, selectedOptionId: selected, correctOptionId, isCorrect, pointsAwarded: isCorrect ? maxPoints : wrongPoints, gradingStatus: 'auto' }
    }
    case 'multiple_choice': {
      if (correct.length === 0) throw new Error('quiz_not_ready')
      const selected = answered ? [...new Set(answer!.optionIds!)] : []
      if (selected.some((id) => !optionIds.has(id))) throw new QuizAnswerError()
      // All or nothing: exactly the correct options, no more and no fewer.
      const isCorrect = answered && selected.length === correct.length && selected.every((id) => correct.includes(id))
      return {
        ...base,
        selectedOptionIds: answered ? sortedLike(selected, question.options) : null,
        correctOptionIds: correct,
        isCorrect,
        pointsAwarded: isCorrect ? maxPoints : wrongPoints,
        gradingStatus: 'auto',
      }
    }
    case 'fill_blank': {
      if (question.acceptedAnswers.length === 0) throw new Error('quiz_not_ready')
      const text = answered ? answer!.text!.trim().slice(0, 200) : null
      const accepted = new Set(question.acceptedAnswers.map((value) => normaliseFillAnswer(value, question.caseSensitive)))
      const isCorrect = text !== null && accepted.has(normaliseFillAnswer(text, question.caseSensitive))
      return { ...base, textResponse: text, isCorrect, pointsAwarded: isCorrect ? maxPoints : wrongPoints, gradingStatus: 'auto' }
    }
    case 'subjective': {
      const text = answered ? answer!.text!.trim().slice(0, QUESTION_LIMITS.textResponse) : null
      // An empty written answer needs no trainer: it scores 0.
      return answered
        ? { ...base, textResponse: text, isCorrect: false, pointsAwarded: null, gradingStatus: 'pending' }
        : { ...base, isCorrect: false, pointsAwarded: 0, gradingStatus: 'auto' }
    }
  }
}

function sortedLike(ids: string[], options: readonly ScoringOption[]) {
  const order = new Map(options.map((option, index) => [option.id, index]))
  return [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
}

export type AttemptTotals = {
  scorePoints: number
  maxPoints: number
  correctCount: number
  percentage: number
  awaitingGrading: boolean
}

/** Totals for an attempt. Negative marks never take the total below 0. */
export function attemptTotals(answers: ReadonlyArray<Pick<ScoredAnswer, 'pointsAwarded' | 'maxPoints' | 'isCorrect'> & { gradingStatus: string }>): AttemptTotals {
  const maxPoints = roundMarks(answers.reduce((sum, answer) => sum + answer.maxPoints, 0))
  const raw = answers.reduce((sum, answer) => sum + (answer.pointsAwarded ?? 0), 0)
  const scorePoints = roundMarks(Math.max(0, raw))
  const percentage = maxPoints > 0 ? Math.min(100, Math.max(0, Math.round((scorePoints / maxPoints) * 100))) : 0
  return {
    scorePoints,
    maxPoints,
    correctCount: answers.filter((answer) => answer.isCorrect).length,
    percentage,
    awaitingGrading: answers.some((answer) => answer.gradingStatus === 'pending'),
  }
}

/**
 * Whether a learner may see the correct answers and explanations, by the quiz's answer policy. Never before
 * the attempt is submitted (the caller only asks after one).
 */
export function mayRevealAnswers(policy: AnswerPolicy, input: { anyPassed: boolean; attemptsUsed: number; maxAttempts: number | null }) {
  switch (policy) {
    case 'never':
      return false
    case 'after_each_attempt':
      return true
    case 'after_pass':
      return input.anyPassed
    case 'after_last_attempt':
      return input.maxAttempts !== null && input.attemptsUsed >= input.maxAttempts
  }
}

/** Fisher–Yates with an injected random integer source (`randomInt(n)` returns 0 ..< n). */
export function shuffled<T>(items: readonly T[], randomInt: (n: number) => number): T[] {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1)
    const current = next[index]!
    next[index] = next[swap]!
    next[swap] = current
  }
  return next
}

/** Formats marks for display: "1", "0.5", "2.25". */
export function marksLabel(value: number) {
  return Number.isInteger(value) ? String(value) : String(roundMarks(value))
}
