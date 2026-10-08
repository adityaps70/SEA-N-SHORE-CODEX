import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  requireAwsUser: vi.fn(),
  canAccessPlatformAdmin: vi.fn(),
  getMembership: vi.fn(),
  insertAuditEvent: vi.fn(),
  replaceImagePath: vi.fn(),
  removeCommunityMedia: vi.fn(),
  createMediaUploadUrl: vi.fn(),
  headMediaObject: vi.fn(),
  deleteMediaObject: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/access', () => ({ canAccessPlatformAdmin: mocks.canAccessPlatformAdmin }))
vi.mock('@/lib/aws/storage', () => ({
  createMediaUploadUrl: mocks.createMediaUploadUrl,
  headMediaObject: mocks.headMediaObject,
  deleteMediaObject: mocks.deleteMediaObject,
}))
vi.mock('./repository', () => ({
  communityRepository: {
    getMembership: mocks.getMembership,
    insertAuditEvent: mocks.insertAuditEvent,
    replaceImagePath: mocks.replaceImagePath,
  },
}))
vi.mock('./media-service', () => ({ removeCommunityMedia: mocks.removeCommunityMedia }))

import {
  completeCommunityMediaUploadAction,
  removeCommunityCoverAction,
  removeCommunityIconAction,
  requestCommunityMediaUploadAction,
} from './media-actions'

const userId = '11111111-1111-4111-8111-111111111111'
const groupId = '22222222-2222-4222-8222-222222222222'
const FORBIDDEN = 'Only the owner and moderators of this group can change its images.'

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
  mocks.createMediaUploadUrl.mockResolvedValue('https://s3.example/presigned')
  mocks.headMediaObject.mockResolvedValue({ contentType: 'image/webp', contentLength: 56000 })
  mocks.replaceImagePath.mockResolvedValue('communities/old/cover.webp')
  mocks.deleteMediaObject.mockResolvedValue(undefined)
  mocks.removeCommunityMedia.mockResolvedValue('communities/old/cover.webp')
})

describe('community media presigned upload actions', () => {
  it.each([
    ['owner', { role: 'owner', status: 'active' }],
    ['moderator', { role: 'admin', status: 'active' }],
  ])('lets the group %s request a direct S3 upload', async (_label, membership) => {
    mocks.getMembership.mockResolvedValue(membership)
    const result = await requestCommunityMediaUploadAction({
      groupId,
      kind: 'cover',
      contentType: 'image/webp',
      size: 56000,
    })

    expect(result.success).toBe(true)
    expect(result.uploadUrl).toBe('https://s3.example/presigned')
    expect(result.key).toMatch(new RegExp(`^communities/${groupId}/cover-`))
    expect(mocks.createMediaUploadUrl).toHaveBeenCalledWith({
      key: result.key,
      contentType: 'image/webp',
      contentLength: 56000,
    })
  })

  it.each([
    ['plain member', { role: 'member', status: 'active' }],
    ['pending moderator', { role: 'admin', status: 'pending' }],
    ['removed owner', { role: 'owner', status: 'removed' }],
    ['non-member', null],
  ])('refuses a %s before issuing a presigned URL', async (_label, membership) => {
    mocks.getMembership.mockResolvedValue(membership)
    const result = await requestCommunityMediaUploadAction({
      groupId,
      kind: 'icon',
      contentType: 'image/webp',
      size: 1000,
    })

    expect(result).toEqual({ error: FORBIDDEN })
    expect(mocks.createMediaUploadUrl).not.toHaveBeenCalled()
  })

  it('validates type and size before signing', async () => {
    await expect(requestCommunityMediaUploadAction({
      groupId,
      kind: 'cover',
      contentType: 'image/gif',
      size: 1000,
    })).resolves.toEqual({ error: 'Please upload a JPG, PNG or WebP image.' })

    await expect(requestCommunityMediaUploadAction({
      groupId,
      kind: 'cover',
      contentType: 'image/webp',
      size: 6 * 1024 * 1024,
    })).resolves.toEqual({ error: 'Image must be 5 MB or smaller.' })

    expect(mocks.createMediaUploadUrl).not.toHaveBeenCalled()
  })

  it('finalizes only a verified object under the expected group/kind prefix', async () => {
    const key = `communities/${groupId}/cover-123.webp`
    await expect(completeCommunityMediaUploadAction({ groupId, kind: 'cover', key })).resolves.toEqual({ success: true })

    expect(mocks.headMediaObject).toHaveBeenCalledWith(key)
    expect(mocks.replaceImagePath).toHaveBeenCalledWith(groupId, 'cover', key)
    expect(mocks.deleteMediaObject).toHaveBeenCalledWith('communities/old/cover.webp')
    expect(mocks.insertAuditEvent).toHaveBeenCalledWith(userId, 'community.image_updated', groupId, { kind: 'cover' })
    expectRevalidation()
  })

  it('rejects an object key outside the authorized prefix', async () => {
    await expect(completeCommunityMediaUploadAction({
      groupId,
      kind: 'cover',
      key: 'communities/someone-else/cover-123.webp',
    })).resolves.toEqual({ error: 'Upload failed, try again.' })

    expect(mocks.headMediaObject).not.toHaveBeenCalled()
    expect(mocks.replaceImagePath).not.toHaveBeenCalled()
  })

  it('deletes an invalid directly uploaded object instead of attaching it', async () => {
    const key = `communities/${groupId}/icon-123.webp`
    mocks.headMediaObject.mockResolvedValueOnce({ contentType: 'application/octet-stream', contentLength: 56000 })

    await expect(completeCommunityMediaUploadAction({ groupId, kind: 'icon', key }))
      .resolves.toEqual({ error: 'Please upload a JPG, PNG or WebP image.' })

    expect(mocks.deleteMediaObject).toHaveBeenCalledWith(key)
    expect(mocks.replaceImagePath).not.toHaveBeenCalled()
  })
})

describe('community media removal', () => {
  it.each([
    ['cover', removeCommunityCoverAction],
    ['icon', removeCommunityIconAction],
  ] as const)('removes the %s and revalidates', async (kind, action) => {
    await expect(action(groupForm())).resolves.toEqual({ success: true })
    expect(mocks.removeCommunityMedia).toHaveBeenCalledWith(groupId, kind)
    expect(mocks.insertAuditEvent).toHaveBeenCalledWith(userId, 'community.image_removed', groupId, { kind })
    expectRevalidation()
  })

  it('rejects invalid group ids', async () => {
    await expect(removeCommunityCoverAction(groupForm('nope'))).resolves.toEqual({ error: 'This group no longer exists.' })
    expect(mocks.removeCommunityMedia).not.toHaveBeenCalled()
  })
})
