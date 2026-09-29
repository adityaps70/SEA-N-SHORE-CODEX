import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  requireAwsUser: vi.fn(),
  canAccessPlatformAdmin: vi.fn(),
  getMembership: vi.fn(),
  insertAuditEvent: vi.fn(),
  uploadCommunityMedia: vi.fn(),
  removeCommunityMedia: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/access', () => ({ canAccessPlatformAdmin: mocks.canAccessPlatformAdmin }))
vi.mock('./repository', () => ({
  communityRepository: { getMembership: mocks.getMembership, insertAuditEvent: mocks.insertAuditEvent },
}))
vi.mock('./media-service', () => ({
  uploadCommunityMedia: mocks.uploadCommunityMedia,
  removeCommunityMedia: mocks.removeCommunityMedia,
}))

import {
  removeCommunityCoverAction,
  removeCommunityIconAction,
  uploadCommunityCoverAction,
  uploadCommunityIconAction,
} from './media-actions'

const userId = '11111111-1111-4111-8111-111111111111'
const groupId = '22222222-2222-4222-8222-222222222222'
const FORBIDDEN = 'Only the owner and moderators of this group can change its images.'

function imageForm(id: string = groupId) {
  const data = new FormData()
  const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('photo').buffer })
  data.set('groupId', id)
  data.set('image', file)
  return data
}

function groupForm(id: string = groupId) {
  const data = new FormData()
  data.set('groupId', id)
  return data
}

function expectRevalidation() {
  expect(mocks.revalidatePath).toHaveBeenCalledWith('/community')
  expect(mocks.revalidatePath).toHaveBeenCalledWith('/community/[slug]', 'page')
  expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/communities')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: userId, cognitoSub: 'sub', email: 'member@example.com' })
  mocks.canAccessPlatformAdmin.mockResolvedValue(false)
  mocks.getMembership.mockResolvedValue({ role: 'owner', status: 'active' })
  mocks.insertAuditEvent.mockResolvedValue(undefined)
  mocks.uploadCommunityMedia.mockResolvedValue('communities/g/cover-new.webp')
  mocks.removeCommunityMedia.mockResolvedValue('communities/g/cover-old.webp')
})

describe('community media actions: who may change the images', () => {
  it.each([
    ['owner', { role: 'owner', status: 'active' }],
    ['moderator (stored role admin)', { role: 'admin', status: 'active' }],
  ])('lets the group %s upload a banner', async (_label, membership) => {
    mocks.getMembership.mockResolvedValue(membership)
    await expect(uploadCommunityCoverAction({}, imageForm())).resolves.toEqual({ success: true })
    expect(mocks.getMembership).toHaveBeenCalledWith(groupId, userId)
    expect(mocks.canAccessPlatformAdmin).not.toHaveBeenCalled()
    expect(mocks.uploadCommunityMedia).toHaveBeenCalledWith(groupId, 'cover', expect.objectContaining({ type: 'image/jpeg', size: 5, bytes: expect.any(Uint8Array) }))
  })

  it.each([
    ['plain member', { role: 'member', status: 'active' }],
    ['pending moderator', { role: 'admin', status: 'pending' }],
    ['removed owner', { role: 'owner', status: 'removed' }],
    ['non-member', null],
  ])('refuses a %s and touches neither storage nor the audit log', async (_label, membership) => {
    mocks.getMembership.mockResolvedValue(membership)
    await expect(uploadCommunityIconAction({}, imageForm())).resolves.toEqual({ error: FORBIDDEN })
    await expect(removeCommunityIconAction(groupForm())).resolves.toEqual({ error: FORBIDDEN })
    expect(mocks.canAccessPlatformAdmin).toHaveBeenCalledWith(userId)
    expect(mocks.uploadCommunityMedia).not.toHaveBeenCalled()
    expect(mocks.removeCommunityMedia).not.toHaveBeenCalled()
    expect(mocks.insertAuditEvent).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('lets a platform administrator who is not a member manage the images', async () => {
    mocks.getMembership.mockResolvedValue(null)
    mocks.canAccessPlatformAdmin.mockResolvedValue(true)
    await expect(uploadCommunityIconAction({}, imageForm())).resolves.toEqual({ success: true })
    await expect(removeCommunityCoverAction(groupForm())).resolves.toEqual({ success: true })
    expect(mocks.uploadCommunityMedia).toHaveBeenCalledWith(groupId, 'icon', expect.anything())
    expect(mocks.removeCommunityMedia).toHaveBeenCalledWith(groupId, 'cover')
  })

  it('requires a signed-in member before looking at anything', async () => {
    mocks.requireAwsUser.mockRejectedValueOnce(new Error('unauthenticated'))
    await expect(uploadCommunityCoverAction({}, imageForm())).rejects.toThrow('unauthenticated')
    expect(mocks.getMembership).not.toHaveBeenCalled()
  })
})

describe('community media actions: upload and remove', () => {
  it.each([
    ['cover', uploadCommunityCoverAction],
    ['icon', uploadCommunityIconAction],
  ] as const)('stores the %s, writes community.image_updated and revalidates the community pages', async (kind, action) => {
    await expect(action({}, imageForm())).resolves.toEqual({ success: true })
    expect(mocks.uploadCommunityMedia).toHaveBeenCalledWith(groupId, kind, expect.objectContaining({ type: 'image/jpeg', size: 5 }))
    expect(mocks.insertAuditEvent).toHaveBeenCalledWith(userId, 'community.image_updated', groupId, { kind })
    expectRevalidation()
  })

  it.each([
    ['cover', removeCommunityCoverAction],
    ['icon', removeCommunityIconAction],
  ] as const)('removes the %s, writes community.image_removed and revalidates the community pages', async (kind, action) => {
    await expect(action(groupForm())).resolves.toEqual({ success: true })
    expect(mocks.removeCommunityMedia).toHaveBeenCalledWith(groupId, kind)
    expect(mocks.insertAuditEvent).toHaveBeenCalledWith(userId, 'community.image_removed', groupId, { kind })
    expectRevalidation()
  })

  it('asks for an image and a valid group id', async () => {
    await expect(uploadCommunityCoverAction({}, groupForm())).resolves.toEqual({ error: 'Choose an image first.' })
    await expect(uploadCommunityCoverAction({}, imageForm('nope'))).resolves.toEqual({ error: 'This group no longer exists.' })
    await expect(removeCommunityCoverAction(groupForm('nope'))).resolves.toEqual({ error: 'This group no longer exists.' })
    expect(mocks.uploadCommunityMedia).not.toHaveBeenCalled()
    expect(mocks.removeCommunityMedia).not.toHaveBeenCalled()
  })

  it('surfaces validation and missing-group errors from the service without revalidating', async () => {
    mocks.uploadCommunityMedia.mockRejectedValueOnce(new Error('Image must be 5 MB or smaller.'))
    await expect(uploadCommunityIconAction({}, imageForm())).resolves.toEqual({ error: 'Image must be 5 MB or smaller.' })
    mocks.uploadCommunityMedia.mockRejectedValueOnce(new Error('community_group_missing'))
    await expect(uploadCommunityIconAction({}, imageForm())).resolves.toEqual({ error: 'This group no longer exists.' })
    mocks.removeCommunityMedia.mockRejectedValueOnce(new Error('community_group_missing'))
    await expect(removeCommunityIconAction(groupForm())).resolves.toEqual({ error: 'This group no longer exists.' })
    expect(mocks.insertAuditEvent).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
