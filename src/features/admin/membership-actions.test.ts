import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  grantEntitlement: vi.fn(),
  revokeEntitlement: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./membership-repository', () => ({
  adminMembershipRepository: {
    grantEntitlement: mocks.grantEntitlement,
    revokeEntitlement: mocks.revokeEntitlement,
  },
}))

import { grantAdminEntitlement, revokeAdminEntitlement } from './membership-actions'

const profileId = '22222222-2222-4222-8222-222222222222'
const companyId = '33333333-3333-4333-8333-333333333333'
const grantId = '44444444-4444-4444-8444-444444444444'

describe('admin membership actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1' })
    mocks.grantEntitlement.mockResolvedValue({ grantId })
    mocks.revokeEntitlement.mockResolvedValue(true)
  })

  it('validates grant scope and reason before authentication', async () => {
    const result = await grantAdminEntitlement({
      subjectType: 'profile',
      subjectId: profileId,
      capability: 'job.publish',
      reason: ' ',
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected entitlement validation to fail.')
    expect(result.error).toMatch(/reason/i)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
  })

  it('grants a safe personal capability through the repository and revalidates the user admin page', async () => {
    await expect(grantAdminEntitlement({
      subjectType: 'profile',
      subjectId: profileId,
      capability: 'job.publish',
      reason: 'Approved migration support for this recruiter.',
    })).resolves.toEqual({ ok: true, grantId })

    expect(mocks.grantEntitlement).toHaveBeenCalledWith('admin-1', {
      subjectType: 'profile',
      subjectId: profileId,
      capability: 'job.publish',
      reason: 'Approved migration support for this recruiter.',
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/users/${profileId}`)
  })

  it('grants organization capability and revalidates organization admin views', async () => {
    await expect(grantAdminEntitlement({
      subjectType: 'company',
      subjectId: companyId,
      capability: 'course.publish',
      reason: 'Approved organization transition support.',
    })).resolves.toEqual({ ok: true, grantId })

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/organizations')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/organizations/[applicationId]', 'page')
  })

  it('returns safe copy for forbidden capability requests', async () => {
    mocks.grantEntitlement.mockRejectedValueOnce(new Error('admin_entitlement_capability_forbidden'))

    await expect(grantAdminEntitlement({
      subjectType: 'profile',
      subjectId: profileId,
      capability: 'billing.manage',
      reason: 'Attempted unsafe grant',
    })).resolves.toEqual({
      ok: false,
      error: 'This capability cannot be granted manually for that subject.',
    })
  })

  it('requires a reason before revoking and audits through the repository', async () => {
    const invalid = await revokeAdminEntitlement(grantId, ' ')
    expect(invalid.ok).toBe(false)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()

    await expect(revokeAdminEntitlement(grantId, 'Migration support is no longer required.')).resolves.toEqual({ ok: true })
    expect(mocks.revokeEntitlement).toHaveBeenCalledWith(
      'admin-1',
      grantId,
      'Migration support is no longer required.',
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/users/[profileId]', 'page')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/organizations/[applicationId]', 'page')
  })
})
