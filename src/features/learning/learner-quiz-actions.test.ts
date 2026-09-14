import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  submitQuizAttempt: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./learner-quiz-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./learner-quiz-repository')>()
  return {
    ...original,
    learnerQuizRepository: {
      submitQuizAttempt: mocks.submitQuizAttempt,
    },
  }
})

import { submitLearningQuiz } from './learner-quiz-actions'

const slug = 'sire-2-readiness-for-tanker-officers'
const lessonId = '44444444-4444-4444-8444-444444444444'
const questionOneId = '66666666-6666-4666-8666-666666666666'
const questionTwoId = '77777777-7777-4777-8777-777777777777'
const optionOneId = '88888888-8888-4888-8888-888888888881'
const optionTwoId = '99999999-9999-4999-8999-999999999991'
const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const answers = [
  { questionId: questionOneId, optionId: optionOneId },
  { questionId: questionTwoId, optionId: optionTwoId },
]

const attemptResult = {
  attemptId,
  submittedAt: '2026-09-15T10:00:00.000Z',
  score: 2,
  totalQuestions: 2,
  percentage: 100,
  passPercentage: 70,
  passed: true,
  enrollmentCompleted: false,
  completedLessons: 3,
  totalLessons: 4,
  progressPercent: 75,
  answers: [
    { questionId: questionOneId, selectedOptionId: optionOneId, correctOptionId: optionOneId, isCorrect: true },
    { questionId: questionTwoId, selectedOptionId: optionTwoId, correctOptionId: optionTwoId, isCorrect: true },
  ],
}

describe('learner quiz server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'learner-1', cognitoSub: 'sub-1', email: 'learner@example.com' })
    mocks.submitQuizAttempt.mockResolvedValue(attemptResult)
  })

  it('rejects malformed course, lesson, or answer payloads before authentication or mutation', async () => {
    await expect(submitLearningQuiz('Invalid Slug', lessonId, answers)).resolves.toEqual({
      ok: false,
      error: 'Invalid quiz submission.',
    })
    await expect(submitLearningQuiz(slug, 'not-a-uuid', answers)).resolves.toEqual({
      ok: false,
      error: 'Invalid quiz submission.',
    })
    await expect(submitLearningQuiz(slug, lessonId, [])).resolves.toEqual({
      ok: false,
      error: 'Invalid quiz submission.',
    })
    await expect(submitLearningQuiz(slug, lessonId, [{ questionId: 'bad-id', optionId: optionOneId }])).resolves.toEqual({
      ok: false,
      error: 'Invalid quiz submission.',
    })

    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.submitQuizAttempt).not.toHaveBeenCalled()
  })

  it('submits only for the authenticated learner and returns the persisted server score', async () => {
    await expect(submitLearningQuiz(slug, lessonId, answers)).resolves.toEqual({
      ok: true,
      ...attemptResult,
    })

    expect(mocks.requireAwsUser).toHaveBeenCalledOnce()
    expect(mocks.submitQuizAttempt).toHaveBeenCalledWith('learner-1', slug, lessonId, answers)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/my-learning')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/learn/courses/${slug}/learn`)
  })

  it('returns the server-authored failed result as a valid immutable attempt', async () => {
    mocks.submitQuizAttempt.mockResolvedValueOnce({
      ...attemptResult,
      score: 1,
      percentage: 50,
      passed: false,
      enrollmentCompleted: false,
      completedLessons: null,
      totalLessons: null,
      progressPercent: null,
      answers: [
        { questionId: questionOneId, selectedOptionId: optionOneId, correctOptionId: '88888888-8888-4888-8888-888888888882', isCorrect: false },
        { questionId: questionTwoId, selectedOptionId: optionTwoId, correctOptionId: optionTwoId, isCorrect: true },
      ],
    })

    const result = await submitLearningQuiz(slug, lessonId, answers)
    expect(result).toMatchObject({ ok: true, attemptId, percentage: 50, passPercentage: 70, passed: false })
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/learn/courses/${slug}/learn`)
  })

  it('returns safe copy for inaccessible, invalid, or unpublished quiz definitions', async () => {
    mocks.submitQuizAttempt.mockRejectedValueOnce(new Error('quiz_not_accessible'))
    await expect(submitLearningQuiz(slug, lessonId, answers)).resolves.toEqual({
      ok: false,
      error: 'This quiz is not available in your learning enrollment.',
    })

    mocks.submitQuizAttempt.mockRejectedValueOnce(new Error('quiz_answers_invalid'))
    await expect(submitLearningQuiz(slug, lessonId, answers)).resolves.toEqual({
      ok: false,
      error: 'Please answer every quiz question with a valid option.',
    })

    mocks.submitQuizAttempt.mockRejectedValueOnce(new Error('quiz_not_ready'))
    await expect(submitLearningQuiz(slug, lessonId, answers)).resolves.toEqual({
      ok: false,
      error: 'This quiz is not ready for assessment yet.',
    })
  })

  it('returns safe generic copy for unexpected quiz submission failures', async () => {
    mocks.submitQuizAttempt.mockRejectedValueOnce(new Error('database_unavailable'))

    await expect(submitLearningQuiz(slug, lessonId, answers)).resolves.toEqual({
      ok: false,
      error: 'We could not submit this quiz. Please try again.',
    })
  })
})
