import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  reviewMentorApplication: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./admin-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./admin-repository')>()
  return {
    ...original,
    learningAdminRepository: {
      reviewMentorApplication: mocks.reviewMentorApplication,
    },
  }
})

import { reviewMentorApplication } from './admin-actions'

const applicationId = '11111111-1111-4111-8111-111111111111'

describe('learning mentor review server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1', cognitoSub: 'admin-sub', email: 'admin@example.com' })
    mocks.reviewMentorApplication.mockResolvedValue({ applicationId, status: 'approved', mentorId: 'mentor-1' })
  })

  it('rejects malformed application ids before authentication', async () => {
    const result = await reviewMentorApplication('invalid', 'approved', null)

    expect(result.ok).toBe(false)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.reviewMentorApplication).not.toHaveBeenCalled()
  })

  it('requires a review note before requesting changes or rejecting', async () => {
    const result = await reviewMentorApplication(applicationId, 'changes_requested', ' ')

    expect(result.ok).toBe(false)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.reviewMentorApplication).not.toHaveBeenCalled()
  })

  it('approves through the authenticated platform administrator and refreshes review surfaces', async () => {
    await expect(reviewMentorApplication(applicationId, 'approved', null)).resolves.toEqual({
      ok: true,
      status: 'approved',
      mentorId: 'mentor-1',
    })

    expect(mocks.reviewMentorApplication).toHaveBeenCalledWith('admin-1', applicationId, 'approved', null)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/learning')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/teach')
  })

  it('normalizes reviewer notes before requesting changes', async () => {
    mocks.reviewMentorApplication.mockResolvedValueOnce({ applicationId, status: 'changes_requested', mentorId: null })

    await expect(reviewMentorApplication(applicationId, 'changes_requested', '  Please clarify LNG teaching experience.  ')).resolves.toEqual({
      ok: true,
      status: 'changes_requested',
      mentorId: null,
    })

    expect(mocks.reviewMentorApplication).toHaveBeenCalledWith(
      'admin-1',
      applicationId,
      'changes_requested',
      'Please clarify LNG teaching experience.',
    )
  })

  it('fails closed with safe copy when repository authorization denies review', async () => {
    mocks.reviewMentorApplication.mockRejectedValueOnce(new Error('admin_forbidden'))

    await expect(reviewMentorApplication(applicationId, 'approved', null)).resolves.toEqual({
      ok: false,
      error: 'You are not authorized to review mentor applications.',
    })
  })
})
