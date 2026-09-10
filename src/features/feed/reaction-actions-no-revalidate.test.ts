import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revalidatePath } from 'next/cache'
import { setCommentReactionWithAurora, setPostReactionWithAurora } from './service'
import { setCommentReaction, setPostReaction } from './actions'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    cognitoSub: 'cognito-subject',
    email: 'viewer@example.com',
  })),
}))
vi.mock('./media', () => ({
  createPendingPostMediaUpload: vi.fn(),
  removeFeedImage: vi.fn(),
  verifyPendingPostMedia: vi.fn(),
}))
vi.mock('./queries', () => ({ getFeedPage: vi.fn() }))
vi.mock('./service', () => ({
  addPostCommentWithAurora: vi.fn(),
  assertPendingMediaDiscardableWithAurora: vi.fn(),
  createPollPostWithAurora: vi.fn(),
  createStandardPostWithAurora: vi.fn(),
  deleteCommentWithAurora: vi.fn(),
  deletePostWithAurora: vi.fn(),
  loadReactionDetailsWithAurora: vi.fn(),
  setCommentReactionWithAurora: vi.fn(async () => true),
  setPollVoteWithAurora: vi.fn(),
  setPostLikedWithAurora: vi.fn(),
  setPostReactionWithAurora: vi.fn(async () => true),
  setPostSavedWithAurora: vi.fn(),
  updateCommentWithAurora: vi.fn(),
}))

const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const commentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const viewerId = '11111111-1111-4111-8111-111111111111'

const mockedRevalidatePath = vi.mocked(revalidatePath)
const mockedSetPostReaction = vi.mocked(setPostReactionWithAurora)
const mockedSetCommentReaction = vi.mocked(setCommentReactionWithAurora)

describe('reaction actions without route invalidation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists a post reaction without invalidating the rendered feed tree', async () => {
    await expect(setPostReaction(postId, 'like')).resolves.toEqual({ ok: true })
    expect(mockedSetPostReaction).toHaveBeenCalledWith(viewerId, postId, 'like')
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })

  it('persists a comment reaction without invalidating the rendered feed tree', async () => {
    await expect(setCommentReaction(commentId, 'support')).resolves.toEqual({ ok: true })
    expect(mockedSetCommentReaction).toHaveBeenCalledWith(viewerId, commentId, 'support')
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })
})
