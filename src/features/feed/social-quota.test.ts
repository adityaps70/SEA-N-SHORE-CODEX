import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedRepository } from './repository'
import type { FeedSocialWriter } from './social-writer'
import type { SocialActionQuotas } from '@/features/social/quotas'
import { removeFeedImage } from './media'
import { getPostById } from './queries'
import {
  addPostCommentWithAurora,
  createPollPostWithAurora,
  createStandardPostWithAurora,
  repostPostWithAurora,
  setCommentReactionWithAurora,
  setPostLikedWithAurora,
  setPostReactionWithAurora,
} from './service'
import {
  addComment,
  createPost,
  repostPost,
  setCommentReaction,
  setPostLiked,
  setPostReaction,
} from './actions'

const viewerId = '11111111-1111-4111-8111-111111111111'
const authorId = '22222222-2222-4222-8222-222222222222'
const postId = '33333333-3333-4333-8333-333333333333'
const commentId = '55555555-5555-4555-8555-555555555555'
const companyId = '66666666-6666-4666-8666-666666666666'
const objectId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/moderation/repository', () => ({
  moderationRepository: { flagContentAutomatically: vi.fn(async () => undefined) },
}))
vi.mock('@/features/auth/aws-queries', () => {
  const user = { id: '11111111-1111-4111-8111-111111111111', cognitoSub: 'cognito-subject', email: 'viewer@example.com' }
  return { requireAwsUser: vi.fn(async () => user), getAwsVerifiedUser: vi.fn(async () => user) }
})
vi.mock('./media', () => ({
  resolveFeedMediaUrls: vi.fn(async () => new Map()),
  createPendingPostMediaUpload: vi.fn(),
  verifyPendingPostMedia: vi.fn(async () => undefined),
  uploadFeedImage: vi.fn(),
  removeFeedImage: vi.fn(async () => undefined),
}))
vi.mock('./queries', () => ({ getFeedPage: vi.fn(), getPostById: vi.fn(), getPostingOrganizations: vi.fn() }))
vi.mock('./service', async (importOriginal) => ({
  ...await importOriginal<typeof import('./service')>(),
  createStandardPostWithAurora: vi.fn(),
  createPollPostWithAurora: vi.fn(),
  repostPostWithAurora: vi.fn(),
  addPostCommentWithAurora: vi.fn(),
  setPostReactionWithAurora: vi.fn(),
  setPostLikedWithAurora: vi.fn(),
  setCommentReactionWithAurora: vi.fn(),
}))

function repository(overrides: Partial<FeedRepository> = {}) {
  return {
    isMemberReady: vi.fn(async () => true),
    getInteractablePost: vi.fn(async () => ({ id: postId, authorId, postType: 'standard' as const })),
    getCommentForInteraction: vi.fn(async () => ({
      id: commentId,
      postId,
      authorId,
      parentCommentId: null,
      rootParentId: commentId,
      postAuthorId: authorId,
    })),
    insertStandardPost: vi.fn(async () => undefined),
    insertPostMedia: vi.fn(async () => undefined),
    insertPollPost: vi.fn(async () => undefined),
    insertPollOption: vi.fn(async () => undefined),
    insertRepost: vi.fn(async () => undefined),
    replacePostHashtags: vi.fn(async () => []),
    listOrganizationAdminIds: vi.fn(async () => new Map()),
    addComment: vi.fn(async () => commentId),
    setPostReaction: vi.fn(async () => undefined),
    setLiked: vi.fn(async () => undefined),
    setCommentReaction: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as FeedRepository
}

function socialWriter() {
  return {
    upsertNotification: vi.fn(async () => undefined),
    deleteNotification: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => undefined),
  } as unknown as FeedSocialWriter
}

function quotas(consume: SocialActionQuotas['consume'] = async () => ({ counted: true })) {
  return { consume: vi.fn(consume) }
}

async function serviceWith(repo: FeedRepository, quota: SocialActionQuotas) {
  const { createFeedService } = await import('./service')
  return createFeedService({
    createId: () => postId,
    loadAccessContext: async () => ({ companyRoles: [{ companyId, role: 'owner' }] }) as never,
    withTransaction: async (fn) => fn(repo, socialWriter(), quota),
  })
}

describe('feed service quotas', () => {
  it('counts every way a member creates a post, including posts published for an organization', async () => {
    const quota = quotas()
    const repo = repository()
    const service = await serviceWith(repo, quota)

    await service.createStandardPost(viewerId, { category: 'learning', body: 'Watch handover notes.' })
    await service.createStandardPost(viewerId, {
      id: postId,
      category: 'learning',
      body: 'Engine room photos.',
      media: [{ storagePath: `${viewerId}/${postId}/${objectId}.jpg`, mimeType: 'image/jpeg', altText: null, position: 0, fileName: 'a.jpg', pageCount: null }],
    })
    await service.createPollPost(viewerId, { category: 'learning', body: 'Best watch rota?', pollOptions: ['4-on 8-off', '6-on 6-off'] })
    await service.repostPost(viewerId, postId)
    await service.repostPost(viewerId, postId, { body: 'Worth reading.' })

    expect(quota.consume).toHaveBeenCalledTimes(5)
    for (const call of quota.consume.mock.calls) expect(call[0]).toEqual({ profileId: viewerId, action: 'post' })
  })

  it('stops a post, poll or repost at the hourly limit before anything is written', async () => {
    const quota = quotas(async () => { throw new Error('feed_post_rate_limited') })
    const repo = repository()
    const service = await serviceWith(repo, quota)

    await expect(service.createStandardPost(viewerId, { category: 'learning', body: 'Hello.' })).rejects.toThrow('feed_post_rate_limited')
    await expect(service.createPollPost(viewerId, { category: 'learning', body: 'Poll', pollOptions: ['A', 'B'] })).rejects.toThrow('feed_post_rate_limited')
    await expect(service.repostPost(viewerId, postId)).rejects.toThrow('feed_post_rate_limited')
    expect(repo.insertStandardPost).not.toHaveBeenCalled()
    expect(repo.insertPollPost).not.toHaveBeenCalled()
    expect(repo.insertRepost).not.toHaveBeenCalled()
  })

  it('counts comments and replies, and stops them at the limit', async () => {
    const quota = quotas()
    const service = await serviceWith(repository(), quota)
    await service.addComment(viewerId, postId, 'Agreed.')
    await service.addComment(viewerId, postId, 'Reply.', commentId)
    expect(quota.consume.mock.calls).toEqual([
      [{ profileId: viewerId, action: 'comment' }],
      [{ profileId: viewerId, action: 'comment' }],
    ])

    const limitedRepo = repository()
    const limited = await serviceWith(limitedRepo, quotas(async () => { throw new Error('feed_comment_rate_limited') }))
    await expect(limited.addComment(viewerId, postId, 'Again.')).rejects.toThrow('feed_comment_rate_limited')
    expect(limitedRepo.addComment).not.toHaveBeenCalled()
  })

  it('counts every reaction set or change on posts and comments, but never a removal', async () => {
    const quota = quotas()
    const service = await serviceWith(repository(), quota)

    await service.setPostReaction(viewerId, postId, 'like')
    await service.setPostReaction(viewerId, postId, 'respect')
    await service.setPostReaction(viewerId, postId, null)
    await service.setCommentReaction(viewerId, commentId, 'like')
    await service.setCommentReaction(viewerId, commentId, null)
    await service.setLiked(viewerId, postId, true)
    await service.setLiked(viewerId, postId, false)

    expect(quota.consume).toHaveBeenCalledTimes(4)
    for (const call of quota.consume.mock.calls) expect(call[0]).toEqual({ profileId: viewerId, action: 'reaction' })
  })

  it('stops reactions at the limit while removals still work', async () => {
    const quota = quotas(async () => { throw new Error('feed_reaction_rate_limited') })
    const repo = repository()
    const service = await serviceWith(repo, quota)

    await expect(service.setPostReaction(viewerId, postId, 'like')).rejects.toThrow('feed_reaction_rate_limited')
    await expect(service.setCommentReaction(viewerId, commentId, 'like')).rejects.toThrow('feed_reaction_rate_limited')
    await expect(service.setLiked(viewerId, postId, true)).rejects.toThrow('feed_reaction_rate_limited')
    expect(repo.setPostReaction).not.toHaveBeenCalled()
    expect(repo.setCommentReaction).not.toHaveBeenCalled()
    expect(repo.setLiked).not.toHaveBeenCalled()

    await expect(service.setPostReaction(viewerId, postId, null)).resolves.toBe(true)
    await expect(service.setCommentReaction(viewerId, commentId, null)).resolves.toBe(true)
    await expect(service.setLiked(viewerId, postId, false)).resolves.toBe(true)
  })
})

const POSTING_MESSAGE = "You're posting very quickly. Please wait a little and try again."
const COMMENTING_MESSAGE = "You're commenting very quickly. Please wait a little and try again."
const REACTING_MESSAGE = "You're reacting very quickly. Please wait a little and try again."

function postForm(fields: Record<string, string | string[]>) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) formData.append(key, entry)
  }
  return formData
}

describe('feed quota messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('shows the posting message for a standard post and keeps the entries', async () => {
    vi.mocked(createStandardPostWithAurora).mockRejectedValueOnce(new Error('feed_post_rate_limited'))
    expect(await createPost({}, postForm({ category: 'learning', body: 'Bridge watch tips.' }))).toEqual({
      error: POSTING_MESSAGE,
      values: { category: 'learning', body: 'Bridge watch tips.', mode: 'standard', pollOptions: [] },
    })
  })

  it('shows the posting message for a poll', async () => {
    vi.mocked(createPollPostWithAurora).mockRejectedValueOnce(new Error('feed_post_rate_limited'))
    const result = await createPost({}, postForm({ mode: 'poll', category: 'learning', body: 'Best rota?', pollOption: ['A', 'B'] }))
    expect(result).toMatchObject({ error: POSTING_MESSAGE, values: { mode: 'poll', pollOptions: ['A', 'B'] } })
  })

  it('shows the posting message for a media post and keeps the uploaded media', async () => {
    vi.mocked(createStandardPostWithAurora).mockRejectedValueOnce(new Error('feed_post_rate_limited'))
    const storagePath = `${viewerId}/${postId}/${objectId}.jpg`
    const result = await createPost({}, postForm({
      category: 'learning',
      body: 'Engine room.',
      mediaManifest: JSON.stringify([{ postId, storagePath, mimeType: 'image/jpeg', size: 1024, altText: '', position: 0, fileName: 'a.jpg', pageCount: null }]),
    }))
    expect(result).toMatchObject({ error: POSTING_MESSAGE, values: { body: 'Engine room.' } })
    expect(removeFeedImage).not.toHaveBeenCalled()
  })

  it('shows the posting message for a repost', async () => {
    vi.mocked(repostPostWithAurora).mockRejectedValueOnce(new Error('feed_post_rate_limited'))
    expect(await repostPost(postId)).toEqual({ ok: false, error: POSTING_MESSAGE })
  })

  it('shows the commenting message and keeps the comment text', async () => {
    vi.mocked(addPostCommentWithAurora).mockRejectedValueOnce(new Error('feed_comment_rate_limited'))
    expect(await addComment({}, postForm({ postId, body: 'Agreed.' }))).toEqual({ error: COMMENTING_MESSAGE, value: 'Agreed.' })
    expect(getPostById).not.toHaveBeenCalled()
  })

  it('shows the reacting message for post reactions, likes and comment reactions', async () => {
    vi.mocked(setPostReactionWithAurora).mockRejectedValueOnce(new Error('feed_reaction_rate_limited'))
    vi.mocked(setPostLikedWithAurora).mockRejectedValueOnce(new Error('feed_reaction_rate_limited'))
    vi.mocked(setCommentReactionWithAurora).mockRejectedValueOnce(new Error('feed_reaction_rate_limited'))
    expect(await setPostReaction(postId, 'like')).toEqual({ ok: false, error: REACTING_MESSAGE })
    expect(await setPostLiked(postId, true)).toEqual({ ok: false, error: REACTING_MESSAGE })
    expect(await setCommentReaction(commentId, 'like')).toEqual({ ok: false, error: REACTING_MESSAGE })
  })

  it('keeps the existing generic messages for other failures', async () => {
    vi.mocked(createStandardPostWithAurora).mockRejectedValueOnce(new Error('connection reset'))
    vi.mocked(setPostReactionWithAurora).mockRejectedValueOnce(new Error('feed_interaction_unavailable'))
    vi.mocked(addPostCommentWithAurora).mockRejectedValueOnce(new Error('timeout'))
    vi.mocked(repostPostWithAurora).mockRejectedValueOnce(new Error('boom'))
    expect(await createPost({}, postForm({ category: 'learning', body: 'Hi there.' }))).toMatchObject({ error: 'We could not publish your post. Your entries are still here.' })
    expect(await setPostReaction(postId, 'like')).toEqual({ ok: false, error: 'We could not update your reaction.' })
    expect(await addComment({}, postForm({ postId, body: 'Hi.' }))).toEqual({ error: 'We could not add your comment.', value: 'Hi.' })
    expect(await repostPost(postId)).toEqual({ ok: false, error: 'We could not repost this post.' })
  })
})
