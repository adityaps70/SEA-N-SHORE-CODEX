import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { setCommentReactionWithAurora, setPollVoteWithAurora, setPostLikedWithAurora, setPostReactionWithAurora, setPostSavedWithAurora } from './service'
import { addComment, createPost, deletePost, setCommentReaction, setPollVote, setPostLiked, setPostReaction, setPostSaved } from './actions'

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

  it('persists likes, saves and poll votes without re-rendering the page into the response (Round P3)', async () => {
    const optionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    await expect(setPostLiked(postId, true)).resolves.toEqual({ ok: true })
    await expect(setPostSaved(postId, true)).resolves.toEqual({ ok: true })
    await expect(setPollVote(postId, optionId)).resolves.toEqual({ ok: true })
    expect(vi.mocked(setPostLikedWithAurora)).toHaveBeenCalledWith(viewerId, postId, true)
    expect(vi.mocked(setPostSavedWithAurora)).toHaveBeenCalledWith(viewerId, postId, true)
    expect(vi.mocked(setPollVoteWithAurora)).toHaveBeenCalledWith(viewerId, postId, optionId)
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })
})

describe('feed actions when the session cannot be confirmed (Round P3)', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['an ended session', new Error('Authentication required.')],
    ['a Cognito timeout', Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })],
  ])('return a failed result instead of a server error on %s', async (_case, failure) => {
    vi.mocked(requireAwsUser).mockRejectedValue(failure)
    const message = 'We could not confirm you are signed in. Refresh the page and try again.'

    await expect(setPostReaction(postId, 'like')).resolves.toEqual({ ok: false, error: message })
    await expect(setPostSaved(postId, true)).resolves.toEqual({ ok: false, error: message })
    await expect(deletePost(postId)).resolves.toEqual({ ok: false, error: message })
    const comment = new FormData()
    comment.set('postId', postId)
    comment.set('body', 'Fair winds')
    await expect(addComment({}, comment)).resolves.toMatchObject({ error: message })
    const post = new FormData()
    post.set('category', 'technical_discussion')
    post.set('body', 'Ballast water question')
    await expect(createPost({}, post)).resolves.toMatchObject({ error: message })
    expect(vi.mocked(setPostReactionWithAurora)).not.toHaveBeenCalled()
  })
})
