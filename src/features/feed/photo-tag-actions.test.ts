import { beforeEach, describe, expect, it, vi } from 'vitest'

const viewerId = '11111111-1111-4111-8111-111111111111'
const connectionId = '22222222-2222-4222-8222-222222222222'
const memberId = '33333333-3333-4333-8333-333333333333'
const postId = '55555555-5555-4555-8555-555555555555'
const mediaId = '66666666-6666-4666-8666-666666666666'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
  getNetworkHub: vi.fn(),
  getAwsNetworkProfiles: vi.fn(),
  deletePhotoTag: vi.fn(async () => true),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/network/queries', () => ({ getNetworkHub: mocks.getNetworkHub }))
vi.mock('@/features/profiles/aws-queries', () => ({ getAwsNetworkProfiles: mocks.getAwsNetworkProfiles }))
vi.mock('./repository', () => ({ feedRepository: { deletePhotoTag: mocks.deletePhotoTag } }))

const connection = { id: connectionId, slug: 'officer-lee', fullName: 'Officer Lee', avatarUrl: 'https://signed/lee', rank: 'Second Officer', currentCompany: 'Blue Fleet', headline: null }
const member = { id: memberId, slug: 'cadet-ali', fullName: 'Cadet Ali', avatarUrl: null, rank: null, currentCompany: null, headline: 'Deck cadet' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getNetworkHub.mockResolvedValue({ totalCount: 1, profiles: [connection] })
  mocks.getAwsNetworkProfiles.mockResolvedValue([connection, member])
  mocks.deletePhotoTag.mockResolvedValue(true)
})

describe('searchPhotoTagCandidates', () => {
  it('lists accepted connections first, then other members once each', async () => {
    const { searchPhotoTagCandidates } = await import('./photo-tag-actions')
    await expect(searchPhotoTagCandidates('  lee ')).resolves.toEqual({
      ok: true,
      candidates: [
        { id: connectionId, slug: 'officer-lee', fullName: 'Officer Lee', avatarUrl: 'https://signed/lee', detail: 'Second Officer · Blue Fleet', connected: true },
        { id: memberId, slug: 'cadet-ali', fullName: 'Cadet Ali', avatarUrl: null, detail: 'Deck cadet', connected: false },
      ],
    })
    expect(mocks.getNetworkHub).toHaveBeenCalledWith('connections', 'lee')
    expect(mocks.getAwsNetworkProfiles).toHaveBeenCalledWith(8, 'lee')
  })

  it('still shows connections when the member directory fails, and rejects over-long searches', async () => {
    const { searchPhotoTagCandidates } = await import('./photo-tag-actions')
    mocks.getAwsNetworkProfiles.mockRejectedValueOnce(new Error('directory down'))
    const result = await searchPhotoTagCandidates('')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.candidates.map((candidate) => candidate.id)).toEqual([connectionId])

    await expect(searchPhotoTagCandidates('x'.repeat(81))).resolves.toEqual({ ok: false, error: 'Search with 80 characters or fewer.' })
    mocks.getNetworkHub.mockRejectedValueOnce(new Error('db down'))
    await expect(searchPhotoTagCandidates('lee')).resolves.toEqual({
      ok: false,
      error: 'We could not load people to tag. Check your internet connection and try again.',
    })
  })
})

describe('removeMyPhotoTag', () => {
  it('removes the signed-in member’s own tag and refreshes the post pages', async () => {
    const { removeMyPhotoTag } = await import('./photo-tag-actions')
    await expect(removeMyPhotoTag({ postId, mediaId })).resolves.toEqual({ ok: true })
    expect(mocks.requireAwsUser).toHaveBeenCalled()
    expect(mocks.deletePhotoTag).toHaveBeenCalledWith(viewerId, postId, mediaId, viewerId)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/posts/[id]', 'page')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/home')
  })

  it('passes a named tag through so the post author can remove it, and the server decides', async () => {
    const { removeMyPhotoTag } = await import('./photo-tag-actions')
    await expect(removeMyPhotoTag({ postId, mediaId, profileId: memberId })).resolves.toEqual({ ok: true })
    expect(mocks.deletePhotoTag).toHaveBeenCalledWith(viewerId, postId, mediaId, memberId)
  })

  it('explains when nothing was removed (not the tagged person or the author) and validates ids', async () => {
    const { removeMyPhotoTag } = await import('./photo-tag-actions')
    mocks.deletePhotoTag.mockResolvedValueOnce(false)
    await expect(removeMyPhotoTag({ postId, mediaId })).resolves.toEqual({ ok: false, error: 'You can only remove your own tag.' })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()

    await expect(removeMyPhotoTag({ postId: 'nope', mediaId })).resolves.toEqual({ ok: false, error: 'This tag could not be found.' })
    expect(mocks.deletePhotoTag).toHaveBeenCalledTimes(1)
  })
})
