import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  grade: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./assignment-grading-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./assignment-grading-repository')>()
  return {
    ...original,
    assignmentGradingRepository: {
      grade: mocks.grade,
    },
  }
})

import { gradeAssignmentAttempt } from './assignment-grading-actions'

const attemptId = '22222222-2222-4222-8222-222222222222'

describe('assignment grading server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'mentor-1', cognitoSub: 'sub-1', email: 'mentor@example.com' })
    mocks.grade.mockResolvedValue({
      attemptId,
      courseSlug: 'sire-2-readiness',
      scorePoints: 85,
      maxPoints: 100,
      percentage: 85,
      passingPercentage: 70,
      passed: true,
      feedback: 'Good evidence.',
      gradedAt: '2026-09-16T10:00:00.000Z',
      progressPercent: 50,
      enrollmentCompleted: false,
    })
  })

  it('rejects an invalid mentor decision before authentication or mutation', async () => {
    await expect(gradeAssignmentAttempt(attemptId, 85, 'Good evidence.', 'approve' as 'pass')).resolves.toEqual({
      ok: false,
      error: 'Invalid grading input.',
    })

    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.grade).not.toHaveBeenCalled()
  })

  it('passes the explicit pass decision through and refreshes mentor and learner surfaces', async () => {
    await expect(gradeAssignmentAttempt(attemptId, 85, 'Good evidence.', 'pass')).resolves.toEqual({
      ok: true,
      passed: true,
      percentage: 85,
      scorePoints: 85,
      maxPoints: 100,
    })

    expect(mocks.grade).toHaveBeenCalledWith('mentor-1', attemptId, {
      scorePoints: 85,
      feedback: 'Good evidence.',
      decision: 'pass',
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/studio')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/studio/assignments')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/learn/studio/assignments/${attemptId}`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/my-learning')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/courses/sire-2-readiness/learn')
  })

  it('returns safe copy when the explicit decision conflicts with the configured pass threshold', async () => {
    mocks.grade.mockRejectedValueOnce(new Error('assignment_decision_mismatch'))

    await expect(gradeAssignmentAttempt(attemptId, 60, 'Revise the evidence.', 'pass')).resolves.toEqual({
      ok: false,
      error: 'The selected decision does not match the score and assignment pass mark.',
    })
  })
})
