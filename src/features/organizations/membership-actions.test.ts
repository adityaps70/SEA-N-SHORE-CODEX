import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getLeaveState: vi.fn(),
  leave: vi.fn(),
  transferOwnership: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./membership-repository', () => ({
  organizationMembershipRepository: {
    getLeaveState: mocks.getLeaveState,
    leave: mocks.leave,
    transferOwnership: mocks.transferOwnership,
  },
}))

import { getLeaveOrganizationState, leaveOrganization, transferOrganizationOwnership } from './membership-actions'

const userId = '11111111-1111-4111-8111-111111111111'
const companyId = '33333333-3333-4333-8333-333333333333'
const adminId = '44444444-4444-4444-8444-444444444444'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: userId })
})

describe('leave organization actions (round F, F2)', () => {
  it('leaves as the signed-in member and refreshes the organization and member pages', async () => {
    mocks.leave.mockResolvedValue({ companyId, slug: 'fixture-organization', previousRole: 'member', notified: 1 })
    await expect(leaveOrganization({ companyId })).resolves.toEqual({ ok: true })
    expect(mocks.leave).toHaveBeenCalledWith(userId, companyId)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations/fixture-organization')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/home')
  })

  it('tells the last owner to transfer ownership first', async () => {
    mocks.leave.mockRejectedValue(new Error('organization_last_owner'))
    await expect(leaveOrganization({ companyId })).resolves.toEqual({
      ok: false,
      code: 'last_owner',
      error: 'You are the only owner. Transfer ownership to an administrator first.',
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('refuses someone who is no longer a member, a malformed id and unexpected failures without detail', async () => {
    mocks.leave.mockRejectedValueOnce(new Error('organization_member_not_found'))
    await expect(leaveOrganization({ companyId })).resolves.toMatchObject({ ok: false, error: 'You are not a member of this organization any more.' })
    await expect(leaveOrganization({ companyId: 'not-a-uuid' })).resolves.toMatchObject({ ok: false })
    mocks.leave.mockRejectedValueOnce(new Error('connection reset'))
    await expect(leaveOrganization({ companyId })).resolves.toEqual({ ok: false, error: 'We could not take you out of this organization. Please try again.' })
  })

  it('needs a signed-in member', async () => {
    mocks.requireAwsUser.mockRejectedValue(new Error('unauthenticated'))
    await expect(leaveOrganization({ companyId })).resolves.toMatchObject({ ok: false })
    expect(mocks.leave).not.toHaveBeenCalled()
  })

  it('loads the dialog state for the signed-in member only', async () => {
    const state = { companyId, slug: 'fixture-organization', name: 'Fixture', role: 'owner', lastOwner: true, administrators: [] }
    mocks.getLeaveState.mockResolvedValueOnce(state)
    await expect(getLeaveOrganizationState({ companyId })).resolves.toEqual({ ok: true, state })
    expect(mocks.getLeaveState).toHaveBeenCalledWith(userId, companyId)
    mocks.getLeaveState.mockResolvedValueOnce(null)
    await expect(getLeaveOrganizationState({ companyId })).resolves.toMatchObject({ ok: false })
  })

  it('transfers ownership as the signed-in owner and maps refusals', async () => {
    mocks.transferOwnership.mockResolvedValueOnce(true)
    mocks.getLeaveState.mockResolvedValueOnce({ slug: 'fixture-organization' })
    await expect(transferOrganizationOwnership({ companyId, newOwnerId: adminId })).resolves.toEqual({ ok: true })
    expect(mocks.transferOwnership).toHaveBeenCalledWith(userId, companyId, adminId)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations/fixture-organization/manage')

    mocks.transferOwnership.mockRejectedValueOnce(new Error('organization_transfer_forbidden'))
    await expect(transferOrganizationOwnership({ companyId, newOwnerId: adminId })).resolves.toEqual({ ok: false, error: 'Only an owner can transfer ownership.' })
    mocks.transferOwnership.mockRejectedValueOnce(new Error('organization_transfer_target_invalid'))
    await expect(transferOrganizationOwnership({ companyId, newOwnerId: adminId })).resolves.toEqual({ ok: false, error: 'Choose a current administrator of this organization.' })
    await expect(transferOrganizationOwnership({ companyId, newOwnerId: '' })).resolves.toMatchObject({ ok: false })
  })
})
