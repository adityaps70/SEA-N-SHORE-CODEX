import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  enrollFreeCourse: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./enrollment-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./enrollment-repository')>()
  return {
    ...original,
    enrollmentRepository: {
      enrollFreeCourse: mocks.enrollFreeCourse,
    },
  }
})

import { enrollInFreeCourse } from './enrollment-actions'

const courseId = '22222222-2222-4222-8222-222222222222'
const enrollmentId = '33333333-3333-4333-8333-333333333333'

describe('learning enrollment server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'learner-1', cognitoSub: 'sub-1', email: 'learner@example.com' })
    mocks.enrollFreeCourse.mockResolvedValue({
      enrollmentId,
      status: 'active',
      enrolledAt: '2026-09-14T12:00:00.000Z',
      alreadyEnrolled: false,
    })
  })

  it('rejects an invalid course id before authentication or mutation', async () => {
    await expect(enrollInFreeCourse('not-a-uuid')).resolves.toEqual({
      ok: false,
      error: 'Invalid course.',
    })

    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.enrollFreeCourse).not.toHaveBeenCalled()
  })

  it('enrolls only with the authenticated Sea N Shore learner identity', async () => {
    await expect(enrollInFreeCourse(courseId)).resolves.toEqual({
      ok: true,
      enrollmentId,
      alreadyEnrolled: false,
    })

    expect(mocks.requireAwsUser).toHaveBeenCalledOnce()
    expect(mocks.enrollFreeCourse).toHaveBeenCalledWith('learner-1', courseId)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/my-learning')
  })

  it('preserves duplicate-safe enrollment semantics for an already enrolled learner', async () => {
    mocks.enrollFreeCourse.mockResolvedValueOnce({
      enrollmentId,
      status: 'active',
      enrolledAt: '2026-09-14T12:00:00.000Z',
      alreadyEnrolled: true,
    })

    await expect(enrollInFreeCourse(courseId)).resolves.toEqual({
      ok: true,
      enrollmentId,
      alreadyEnrolled: true,
    })
  })

  it('returns safe copy when the course is not currently eligible for free enrollment', async () => {
    mocks.enrollFreeCourse.mockRejectedValueOnce(new Error('course_not_enrollable'))

    await expect(enrollInFreeCourse(courseId)).resolves.toEqual({
      ok: false,
      error: 'This course is not currently available for free enrollment.',
    })
  })

  it('returns safe copy instead of silently restoring revoked access', async () => {
    mocks.enrollFreeCourse.mockRejectedValueOnce(new Error('enrollment_revoked'))

    await expect(enrollInFreeCourse(courseId)).resolves.toEqual({
      ok: false,
      error: 'Your access to this course has been revoked. Please contact Sea N Shore support.',
    })
  })
})
