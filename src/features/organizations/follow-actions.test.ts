import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAccessContext: vi.fn(),
  getById: vi.fn(),
  followOrganization: vi.fn(),
  unfollowOrganization: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ getAccessContext: mocks.getAccessContext }))
vi.mock('./workspace-repository', () => ({
  organizationWorkspaceRepository: {
    getById: mocks.getById,
    followOrganization: mocks.followOrganization,
    unfollowOrganization: mocks.unfollowOrganization,
  },
}))

import { followOrganizationAction, unfollowOrganizationAction } from './follow-actions'

describe('organization follow actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
    mocks.getAccessContext.mockResolvedValue({
      personalPlan: 'free',
      personalEntitlements: ['job.apply', 'event.attend', 'course.enroll'],
      verifications: [],
      organizationMemberships: [],
      accountActive: true,
    })
    mocks.getById.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333', slug: 'oceanic' })
  })

  it('allows an active free member to follow an organization', async () => {
    await expect(followOrganizationAction('33333333-3333-4333-8333-333333333333')).resolves.toEqual({ ok: true })
    expect(mocks.followOrganization).toHaveBeenCalledWith('user-1', '33333333-3333-4333-8333-333333333333')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations/oceanic')
  })

  it('blocks suspended accounts from organization follow changes', async () => {
    mocks.getAccessContext.mockResolvedValueOnce({
      personalPlan: 'free',
      personalEntitlements: [],
      verifications: [],
      organizationMemberships: [],
      accountActive: false,
    })

    await expect(unfollowOrganizationAction('33333333-3333-4333-8333-333333333333')).resolves.toEqual({
      ok: false,
      error: 'Your account cannot update organization follows right now.',
    })
    expect(mocks.unfollowOrganization).not.toHaveBeenCalled()
  })
})
