import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  completeLesson: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./learner-progress-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./learner-progress-repository')>()
  return {
    ...original,
    learnerProgressRepository: {
      completeLesson: mocks.completeLesson,
    },
  }
})

import { completeLearningLesson } from './learner-progress-actions'

const slug = 'sire-2-readiness-for-tanker-officers'
const lessonId = '66666666-6666-4666-8666-666666666666'
const enrollmentId = '22222222-2222-4222-8222-222222222222'

describe('learner progress server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'learner-1', cognitoSub: 'sub-1', email: 'learner@example.com' })
    mocks.completeLesson.mockResolvedValue({
      enrollmentId,
      lessonId,
      completedAt: '2026-09-15T09:00:00.000Z',
      totalLessons: 5,
      completedLessons: 3,
      progressPercent: 60,
      enrollmentCompleted: false,
    })
  })

  it('rejects invalid course or lesson identifiers before authentication or mutation', async () => {
    await expect(completeLearningLesson('Invalid Slug', lessonId)).resolves.toEqual({
      ok: false,
      error: 'Invalid course or lesson.',
    })
    await expect(completeLearningLesson(slug, 'not-a-uuid')).resolves.toEqual({
      ok: false,
      error: 'Invalid course or lesson.',
    })

    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.completeLesson).not.toHaveBeenCalled()
  })

  it('completes progress only for the authenticated learner and refreshes learner views', async () => {
    await expect(completeLearningLesson(slug, lessonId)).resolves.toEqual({
      ok: true,
      lessonId,
      completedLessons: 3,
      totalLessons: 5,
      progressPercent: 60,
      enrollmentCompleted: false,
    })

    expect(mocks.requireAwsUser).toHaveBeenCalledOnce()
    expect(mocks.completeLesson).toHaveBeenCalledWith('learner-1', slug, lessonId)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/my-learning')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/learn/courses/${slug}/learn`)
  })

  it('returns completed enrollment state without inventing a separate completion flow', async () => {
    mocks.completeLesson.mockResolvedValueOnce({
      enrollmentId,
      lessonId,
      completedAt: '2026-09-15T09:00:00.000Z',
      totalLessons: 5,
      completedLessons: 5,
      progressPercent: 100,
      enrollmentCompleted: true,
    })

    await expect(completeLearningLesson(slug, lessonId)).resolves.toEqual({
      ok: true,
      lessonId,
      completedLessons: 5,
      totalLessons: 5,
      progressPercent: 100,
      enrollmentCompleted: true,
    })
  })

  it('returns safe copy when the lesson is outside the learner enrollment', async () => {
    mocks.completeLesson.mockRejectedValueOnce(new Error('lesson_not_accessible'))

    await expect(completeLearningLesson(slug, lessonId)).resolves.toEqual({
      ok: false,
      error: 'This lesson is not available in your learning enrollment.',
    })
  })

  it('returns safe generic copy for unexpected progress failures', async () => {
    mocks.completeLesson.mockRejectedValueOnce(new Error('database_unavailable'))

    await expect(completeLearningLesson(slug, lessonId)).resolves.toEqual({
      ok: false,
      error: 'We could not update your lesson progress. Please try again.',
    })
  })
})
