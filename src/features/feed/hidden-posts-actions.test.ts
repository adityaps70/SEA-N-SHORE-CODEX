import { beforeEach, describe, expect, it, vi } from 'vitest'

const viewerId = '11111111-1111-4111-8111-111111111111'
const postId = '33333333-3333-4333-8333-333333333333'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
  unhidePostWithAurora: vi.fn(async () => true),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/moderation/repository', () => ({ moderationRepository: { flagContentAutomatically: vi.fn() } }))
vi.mock('./queries', () => ({ getPostById: vi.fn(), getFeedPage: vi.fn() }))
vi.mock('./media', () => ({
  resolveFeedMediaUrls: vi.fn(async () => new Map()),
  createPendingPostMediaUpload: vi.fn(),
  verifyPendingPostMedia: vi.fn(),
  removeFeedImage: vi.fn(),
}))
vi.mock('./service', () => ({ unhidePostWithAurora: mocks.unhidePostWithAurora }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.unhidePostWithAurora.mockResolvedValue(true)
})

describe('unhidePost action', () => {
  it('removes the hide for the signed-in member and refreshes the feed, organization pages and My Activities', async () => {
    const { unhidePost } = await import('./actions')
    await expect(unhidePost(postId)).resolves.toEqual({ ok: true })
    expect(mocks.unhidePostWithAurora).toHaveBeenCalledWith(viewerId, postId)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/activities')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/home')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations/[slug]', 'page')
  })

  it('rejects invalid ids and reports failures in plain language', async () => {
    const { unhidePost } = await import('./actions')
    await expect(unhidePost('not-a-post')).resolves.toEqual({ ok: false, error: 'Invalid post.' })
    expect(mocks.unhidePostWithAurora).not.toHaveBeenCalled()

    mocks.unhidePostWithAurora.mockRejectedValueOnce(new Error('db down'))
    await expect(unhidePost(postId)).resolves.toEqual({ ok: false, error: 'We could not show this post again. Please try again.' })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
