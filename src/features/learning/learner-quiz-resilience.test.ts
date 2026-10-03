import { describe, expect, it } from 'vitest'
import { createLearnerQuizRepository } from './learner-quiz-repository'

const learnerId = '11111111-1111-4111-8111-111111111111'
const enrollmentId = '22222222-2222-4222-8222-222222222222'
const lessonId = '44444444-4444-4444-8444-444444444444'
const quizId = '55555555-5555-4555-8555-555555555555'
const questionOneId = '66666666-6666-4666-8666-666666666666'
const questionTwoId = '77777777-7777-4777-8777-777777777777'
const optionOneCorrectId = '88888888-8888-4888-8888-888888888881'
const optionOneWrongId = '88888888-8888-4888-8888-888888888882'
const optionTwoCorrectId = '99999999-9999-4999-8999-999999999991'
const optionTwoWrongId = '99999999-9999-4999-8999-999999999992'
const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const submissionKey = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const slug = 'sire-2-readiness-for-tanker-officers'

function accessRow(overrides: Record<string, unknown> = {}) {
  return [{
    enrollment_id: enrollmentId,
    course_id: '33333333-3333-4333-8333-333333333333',
    lesson_id: lessonId,
    quiz_id: quizId,
    pass_percentage: 70,
    instructions: 'Choose the best answer for each question.',
    max_attempts: 3,
    attempts_used: 1,
    ...overrides,
  }]
}

function questionRows() {
  return [
    { id: questionOneId, prompt: 'What is the first priority before a SIRE 2.0 inspection?', position: 0 },
    { id: questionTwoId, prompt: 'Who owns operational readiness onboard?', position: 1 },
  ]
}

function scoringOptionRows() {
  return [
    { id: optionOneCorrectId, question_id: questionOneId, label: 'Verify evidence and actual practice', position: 0, is_correct: true },
    { id: optionOneWrongId, question_id: questionOneId, label: 'Prepare paperwork only', position: 1, is_correct: false },
    { id: optionTwoCorrectId, question_id: questionTwoId, label: 'The whole shipboard team', position: 0, is_correct: true },
    { id: optionTwoWrongId, question_id: questionTwoId, label: 'Only the Master', position: 1, is_correct: false },
  ]
}

type QuizWithHistory = {
  attemptHistory: Array<{
    attemptId: string
    attemptNumber: number
    submittedAt: string
    percentage: number
    passed: boolean
  }>
}

type ResilientAttemptResult = {
  attemptId: string
  attemptNumber: number
  submittedAt: string
  score: number
  totalQuestions: number
  percentage: number
  passPercentage: number
  passed: boolean
  answers: Array<{
    questionId: string
    selectedOptionId: string
    correctOptionId: string
    isCorrect: boolean
  }>
}

type ResilientSubmit = (
  learnerId: string,
  slug: string,
  lessonId: string,
  answers: Array<{ questionId: string; optionId: string }>,
  submissionKey: string,
) => Promise<ResilientAttemptResult>

describe('learner quiz resilience', () => {
  it('loads persisted attempt history scoped to the authenticated learner and enrollment', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createLearnerQuizRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('from public.learning_quizzes quiz')) return accessRow()
        if (text.includes('from public.learning_quiz_questions question')) return []
        if (text.includes('from public.learning_quiz_attempts attempt')) {
          return [
            {
              id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              attempt_number: 2,
              submitted_at: new Date('2026-09-16T09:00:00.000Z'),
              score: 2,
              total_questions: 2,
              percentage: 100,
              pass_percentage: 70,
              passed: true,
            },
            {
              id: attemptId,
              attempt_number: 1,
              submitted_at: new Date('2026-09-15T09:00:00.000Z'),
              score: 1,
              total_questions: 2,
              percentage: 50,
              pass_percentage: 70,
              passed: false,
            },
          ]
        }
        return []
      },
    })

    const quiz = await repository.getQuizForLearner(learnerId, slug, lessonId) as (QuizWithHistory & object) | null

    expect(quiz?.attemptHistory).toEqual([
      {
        attemptId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        attemptNumber: 2,
        submittedAt: '2026-09-16T09:00:00.000Z',
        score: 2,
        totalQuestions: 2,
        percentage: 100,
        passPercentage: 70,
        passed: true,
      },
      {
        attemptId,
        attemptNumber: 1,
        submittedAt: '2026-09-15T09:00:00.000Z',
        score: 1,
        totalQuestions: 2,
        percentage: 50,
        passPercentage: 70,
        passed: false,
      },
    ])

    const historyQuery = seen.find(({ text }) => text.includes('order by attempt.attempt_number desc'))
    expect(historyQuery?.values).toEqual([enrollmentId, quizId, learnerId])
    expect(historyQuery?.text).toContain('attempt.learner_id = $3')
  })

  it('persists attempt number, submission key, and the correct-option snapshot for a new attempt', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createLearnerQuizRepository({
      transaction: async (work) => work(async (text, values) => {
        seen.push({ text, values })
        if (text.includes('from public.learning_quizzes quiz')) return accessRow()
        if (text.includes('submission_key = $4')) return []
        if (text.includes('count(*)::bigint as attempts_used')) return [{ attempts_used: 1 }]
        if (text.includes('from public.learning_quiz_questions question')) return questionRows()
        if (text.includes('from public.learning_quiz_options option')) return scoringOptionRows()
        if (text.includes('insert into public.learning_quiz_attempts')) {
          return [{ id: attemptId, attempt_number: 2, submitted_at: new Date('2026-09-16T10:00:00.000Z') }]
        }
        return []
      }),
    })

    const submit = repository.submitQuizAttempt as unknown as ResilientSubmit
    const result = await submit(learnerId, slug, lessonId, [
      { questionId: questionOneId, optionId: optionOneCorrectId },
      { questionId: questionTwoId, optionId: optionTwoWrongId },
    ], submissionKey)

    expect(result.attemptNumber).toBe(2)
    const attemptInsert = seen.find(({ text }) => text.includes('insert into public.learning_quiz_attempts'))
    expect(attemptInsert?.text).toContain('attempt_number')
    expect(attemptInsert?.text).toContain('submission_key')
    expect(attemptInsert?.values).toContain(2)
    expect(attemptInsert?.values).toContain(submissionKey)

    const answerInserts = seen.filter(({ text }) => text.includes('insert into public.learning_quiz_attempt_answers'))
    expect(answerInserts).toHaveLength(2)
    expect(answerInserts.every(({ text }) => text.includes('correct_option_id'))).toBe(true)
    expect(answerInserts[0]?.values).toContain(optionOneCorrectId)
    expect(answerInserts[1]?.values).toContain(optionTwoCorrectId)
  })

  it('returns the original immutable attempt for a duplicate submission key before consuming the attempt limit', async () => {
    const writes: string[] = []
    const repository = createLearnerQuizRepository({
      transaction: async (work) => work(async (text) => {
        if (/^(insert|update)/i.test(text.trim())) writes.push(text)
        if (text.includes('from public.learning_quizzes quiz')) {
          return accessRow({ max_attempts: 1, attempts_used: 1 })
        }
        if (text.includes('submission_key = $4')) {
          return [{
            id: attemptId,
            attempt_number: 1,
            submitted_at: new Date('2026-09-15T10:00:00.000Z'),
            score: 1,
            total_questions: 2,
            percentage: 50,
            pass_percentage: 70,
            passed: false,
          }]
        }
        if (text.includes('from public.learning_quiz_attempt_answers answer')) {
          return [
            {
              question_id: questionOneId,
              selected_option_id: optionOneWrongId,
              correct_option_id: optionOneCorrectId,
              is_correct: false,
            },
            {
              question_id: questionTwoId,
              selected_option_id: optionTwoCorrectId,
              correct_option_id: optionTwoCorrectId,
              is_correct: true,
            },
          ]
        }
        return []
      }),
    })

    const submit = repository.submitQuizAttempt as unknown as ResilientSubmit
    const result = await submit(learnerId, slug, lessonId, [
      { questionId: questionOneId, optionId: optionOneWrongId },
      { questionId: questionTwoId, optionId: optionTwoCorrectId },
    ], submissionKey)

    expect(result).toMatchObject({
      attemptId,
      attemptNumber: 1,
      percentage: 50,
      passed: false,
    })
    expect(result.answers).toEqual([
      {
        questionId: questionOneId,
        selectedOptionId: optionOneWrongId,
        correctOptionId: optionOneCorrectId,
        isCorrect: false,
      },
      {
        questionId: questionTwoId,
        selectedOptionId: optionTwoCorrectId,
        correctOptionId: optionTwoCorrectId,
        isCorrect: true,
      },
    ])
    expect(writes).toEqual([])
  })
})
