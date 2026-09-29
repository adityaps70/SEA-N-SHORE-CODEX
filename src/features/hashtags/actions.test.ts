import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAccessContext: vi.fn(),
  searchHashtags: vi.fn(),
  followHashtag: vi.fn(),
  unfollowHashtag: vi.fn(),
  isFollowingHashtag: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ getAccessContext: mocks.getAccessContext }))
vi.mock('./repository', () => ({
  hashtagRepository: {
    searchHashtags: mocks.searchHashtags,
    followHashtag: mocks.followHashtag,
    unfollowHashtag: mocks.unfollowHashtag,
    isFollowingHashtag: mocks.isFollowingHashtag,
  },
}))

import { followHashtag, isFollowingHashtag, searchHashtags, unfollowHashtag } from './actions'

describe('hashtag actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
    mocks.getAccessContext.mockResolvedValue({ personalPlan: 'free', personalEntitlements: [], verifications: [], organizationMemberships: [], accountActive: true })
    mocks.searchHashtags.mockResolvedValue([{ tag: 'sire', postCount: 4 }])
    mocks.isFollowingHashtag.mockResolvedValue(true)
  })

  it('searches existing hashtags and swallows database errors', async () => {
    await expect(searchHashtags(' #Si ')).resolves.toEqual([{ tag: 'sire', postCount: 4 }])
    expect(mocks.searchHashtags).toHaveBeenCalledWith('#Si')

    mocks.searchHashtags.mockRejectedValueOnce(new Error('down'))
    await expect(searchHashtags('si')).resolves.toEqual([])
  })

  it('follows and unfollows a normalised tag for the signed-in member and revalidates the tag page', async () => {
    await expect(followHashtag('#Vetting')).resolves.toEqual({ ok: true, following: true })
    expect(mocks.followHashtag).toHaveBeenCalledWith('user-1', 'vetting')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hashtags/vetting')

    await expect(unfollowHashtag('vetting')).resolves.toEqual({ ok: true, following: false })
    expect(mocks.unfollowHashtag).toHaveBeenCalledWith('user-1', 'vetting')
  })

  it('rejects invalid tags before touching the session', async () => {
    await expect(followHashtag('not a tag')).resolves.toEqual({ ok: false, error: 'This hashtag could not be found.' })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.followHashtag).not.toHaveBeenCalled()
  })

  it('blocks suspended accounts from following', async () => {
    mocks.getAccessContext.mockResolvedValueOnce({ personalPlan: 'free', personalEntitlements: [], verifications: [], organizationMemberships: [], accountActive: false })
    await expect(followHashtag('sire')).resolves.toEqual({ ok: false, error: 'Your account cannot follow hashtags right now.' })
    expect(mocks.followHashtag).not.toHaveBeenCalled()
  })

  it('reports the follow state, false when signed out', async () => {
    await expect(isFollowingHashtag('SIRE')).resolves.toBe(true)
    expect(mocks.isFollowingHashtag).toHaveBeenCalledWith('user-1', 'sire')
    mocks.requireAwsUser.mockRejectedValueOnce(new Error('signed out'))
    await expect(isFollowingHashtag('sire')).resolves.toBe(false)
    await expect(isFollowingHashtag('')).resolves.toBe(false)
  })
})
