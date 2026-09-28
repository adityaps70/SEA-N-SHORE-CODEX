import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  requireCapability: vi.fn(),
  getById: vi.fn(),
  removeMember: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ requireCapability: mocks.requireCapability }))
vi.mock('@/lib/aws/storage', () => ({ putMediaObject: vi.fn(), deleteMediaObject: vi.fn() }))

vi.mock('./workspace-repository', () => ({
  organizationWorkspaceRepository: { getById: mocks.getById, removeMember: mocks.removeMember },
}))

import { removeOrganizationMember } from './workspace-actions'

const companyId = '22222222-2222-4222-8222-222222222222'
const ownerId = '11111111-1111-4111-8111-111111111111'
const adminId = '33333333-3333-4333-8333-333333333333'
const memberId = '44444444-4444-4444-8444-444444444444'

describe('removeOrganizationMember action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: adminId })
    mocks.requireCapability.mockResolvedValue(undefined)
    mocks.getById.mockResolvedValue({ id: companyId, slug: 'oceanic' })
    mocks.removeMember.mockResolvedValue(true)
  })

  it('checks team management on the server, removes the member and refreshes the team pages', async () => {
    await expect(removeOrganizationMember({ companyId, memberId })).resolves.toEqual({ ok: true, left: false })
    expect(mocks.requireCapability).toHaveBeenCalledWith(adminId, 'organization.team', { companyId })
    expect(mocks.removeMember).toHaveBeenCalledWith(adminId, companyId, memberId)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations/oceanic/team')
  })

  it('says when the viewer left the team themselves', async () => {
    await expect(removeOrganizationMember({ companyId, memberId: adminId })).resolves.toEqual({ ok: true, left: true })
  })

  it('refuses without team management and does not touch the team', async () => {
    mocks.requireCapability.mockRejectedValue(new Error('capability_required'))
    const result = await removeOrganizationMember({ companyId, memberId })
    expect(result).toEqual({ ok: false, error: 'Organization Pro team-management access is required to remove team members.' })
    expect(mocks.removeMember).not.toHaveBeenCalled()
  })

  it('explains the last-owner guard and role refusals', async () => {
    mocks.removeMember.mockRejectedValueOnce(new Error('organization_last_owner'))
    expect(await removeOrganizationMember({ companyId, memberId: ownerId })).toEqual({ ok: false, error: 'The organization needs at least one owner, so its last owner cannot be removed.' })
    mocks.removeMember.mockRejectedValueOnce(new Error('organization_member_remove_forbidden'))
    expect(await removeOrganizationMember({ companyId, memberId: ownerId })).toMatchObject({ ok: false, error: expect.stringContaining('only an owner can remove an owner') })
  })

  it('rejects ids that are not UUIDs before reaching the database', async () => {
    expect(await removeOrganizationMember({ companyId: 'nope', memberId })).toEqual({ ok: false, error: 'Choose a valid organization team member.' })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
  })
})
