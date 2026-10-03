import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  completeLesson: vi.fn(),
  savePlaybackPosition: vi.fn(),
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
      savePlaybackPosition: mocks.savePlaybackPosition,
    },
  }
})

import * as learnerProgressActions from './learner-progress-actions'

const completeLearningLesson = learnerProgressActions.completeLearningLesson
const saveLearningPlaybackPosition = (
  learnerProgressActions as typeof learnerProgressActions & {
    saveLearningPlaybackPosition: (
      slug: string,
      lessonId: string,
      positionSeconds: number,
    ) => Promise<
      | { ok: true; lessonId: string; lastPositionSeconds: number }
      | { ok: false; error: string }
    >
  }
).saveLearningPlaybackPosition

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
    mocks.savePlaybackPosition.mockResolvedValue({
      enrollmentId,
      lessonId,
      lastPositionSeconds: 125,
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

  it('rejects invalid playback position before authentication or mutation', async () => {
    await expect(saveLearningPlaybackPosition(slug, lessonId, -1)).resolves.toEqual({
      ok: false,
      error: 'Invalid playback position.',
    })
    await expect(saveLearningPlaybackPosition(slug, lessonId, 12.5)).resolves.toEqual({
      ok: false,
      error: 'Invalid playback position.',
    })

    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.savePlaybackPosition).not.toHaveBeenCalled()
  })

  it('saves playback position only for the authenticated learner without revalidating views', async () => {
    await expect(saveLearningPlaybackPosition(slug, lessonId, 125)).resolves.toEqual({
      ok: true,
      lessonId,
      lastPositionSeconds: 125,
    })

    expect(mocks.requireAwsUser).toHaveBeenCalledOnce()
    expect(mocks.savePlaybackPosition).toHaveBeenCalledWith('learner-1', slug, lessonId, 125)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('returns safe copy when playback position is saved outside the learner enrollment', async () => {
    mocks.savePlaybackPosition.mockRejectedValueOnce(new Error('lesson_not_accessible'))

    await expect(saveLearningPlaybackPosition(slug, lessonId, 125)).resolves.toEqual({
      ok: false,
      error: 'This lesson is not available in your learning enrollment.',
    })
  })

  it('returns safe generic copy for unexpected playback position failures', async () => {
    mocks.savePlaybackPosition.mockRejectedValueOnce(new Error('database_unavailable'))

    await expect(saveLearningPlaybackPosition(slug, lessonId, 125)).resolves.toEqual({
      ok: false,
      error: 'We could not save your playback position. Please try again.',
    })
  })
})
