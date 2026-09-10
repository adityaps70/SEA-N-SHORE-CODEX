import { describe, expect, it, vi } from 'vitest'
import type { FeedRepository } from './repository'
import type { FeedSocialWriter } from './social-writer'

const viewerId = '11111111-1111-4111-8111-111111111111'
const authorId = '22222222-2222-4222-8222-222222222222'
const postId = '33333333-3333-4333-8333-333333333333'
const optionId = '44444444-4444-4444-8444-444444444444'
const commentId = '55555555-5555-4555-8555-555555555555'

function repository(overrides: Partial<FeedRepository> = {}) {
  return {
    isMemberReady: vi.fn(async () => true),
    isPostMediaAttached: vi.fn(async () => false),
    getInteractablePost: vi.fn(async () => ({ id: postId, authorId, postType: 'standard' as const })),
    getCommentForInteraction: vi.fn(async () => ({
      id: commentId,
      postId,
      authorId: viewerId,
      parentCommentId: null,
      rootParentId: commentId,
      postAuthorId: authorId,
    })),
    updateOwnCommentWithinEditWindow: vi.fn(async () => ({ id: commentId, postId, parentCommentId: null })),
    softDeleteOwnComment: vi.fn(async () => ({ id: commentId, postId, parentCommentId: null })),
    replaceCommentMentions: vi.fn(async () => ({ mentionProfileIds: [], newlyIntroducedProfileIds: [] })),
    insertStandardPost: vi.fn(async () => undefined),
    insertPostMedia: vi.fn(async () => undefined),
    insertPollPost: vi.fn(async () => undefined),
    insertPollOption: vi.fn(async () => undefined),
    setLiked: vi.fn(async () => undefined),
    setSaved: vi.fn(async () => undefined),
    addComment: vi.fn(async () => undefined),
    setPollVote: vi.fn(async () => undefined),
    pollOptionBelongsToPost: vi.fn(async () => true),
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

function serviceFor(repo: FeedRepository, social?: FeedSocialWriter) {
  return import('./service').then(({ createFeedService }) => createFeedService({
    createId: () => postId,
    withTransaction: async <T>(fn: (repository: FeedRepository, social?: FeedSocialWriter) => Promise<T>) => fn(repo, social),
  }))
}

type CommentManagementService = Awaited<ReturnType<typeof serviceFor>> & {
  updateComment(actorId: string, id: string, body: string, mentionProfileIds?: string[]): Promise<{ id: string; postId: string; parentCommentId: string | null }>
  deleteComment(actorId: string, id: string): Promise<{ id: string; postId: string; parentCommentId: string | null }>
}

async function managedServiceFor(repo: FeedRepository, social?: FeedSocialWriter) {
  return await serviceFor(repo, social) as CommentManagementService
}

describe('feed service authorization', () => {
  it('rejects post creation when the permanent profile is not an active onboarded member', async () => {
    const repo = repository({ isMemberReady: vi.fn(async () => false) })
    const service = await serviceFor(repo)

    await expect(service.createStandardPost(viewerId, {
      category: 'learning',
      body: 'Bridge resource management lesson.',
    })).rejects.toThrow('feed_interaction_unavailable')
    expect(repo.insertStandardPost).not.toHaveBeenCalled()
  })

  it('persists standard post media metadata in the same transaction using a caller-provided post id', async () => {
    const repo = repository()
    const service = await serviceFor(repo)
    const mediaPostId = '55555555-5555-4555-8555-555555555555'

    await expect(service.createStandardPost(viewerId, {
      id: mediaPostId,
      category: 'learning',
      body: 'Mooring station setup.',
      media: {
        storagePath: `${viewerId}/${mediaPostId}/image.webp`,
        mimeType: 'image/webp',
        altText: 'Mooring station layout',
      },
    })).resolves.toBe(mediaPostId)

    expect(repo.insertStandardPost).toHaveBeenCalledWith({
      id: mediaPostId,
      authorId: viewerId,
      category: 'learning',
      body: 'Mooring station setup.',
    })
    expect(repo.insertPostMedia).toHaveBeenCalledWith(mediaPostId, {
      storagePath: `${viewerId}/${mediaPostId}/image.webp`,
      mimeType: 'image/webp',
      altText: 'Mooring station layout',
    })
  })

  it('allows discarding only media that is not already attached in Aurora', async () => {
    const repo = repository()
    const service = await serviceFor(repo)
    const storagePath = `${viewerId}/${postId}/pending.jpg`

    await expect(service.assertPendingMediaDiscardable(viewerId, storagePath)).resolves.toBe(true)
    expect(repo.isPostMediaAttached).toHaveBeenCalledWith(storagePath)
  })

  it('refuses to discard media once Aurora references the object', async () => {
    const repo = repository({ isPostMediaAttached: vi.fn(async () => true) })
    const service = await serviceFor(repo)

    await expect(service.assertPendingMediaDiscardable(
      viewerId,
      `${viewerId}/${postId}/attached.jpg`,
    )).rejects.toThrow('feed_media_delete_forbidden')
  })

  it('creates polls transactionally with trimmed case-insensitive distinct options in first-seen order', async () => {
    const repo = repository()
    const service = await serviceFor(repo)

    await expect(service.createPollPost(viewerId, {
      category: 'technical_discussion',
      body: 'Which inspection should be prioritized?',
      pollOptions: ['  Mooring  ', 'Cargo', 'mooring', ' Bridge '],
    })).resolves.toBe(postId)

    expect(repo.insertPollPost).toHaveBeenCalledWith({
      id: postId,
      authorId: viewerId,
      category: 'technical_discussion',
      body: 'Which inspection should be prioritized?',
    })
    expect(repo.insertPollOption).toHaveBeenNthCalledWith(1, postId, 'Mooring', 0)
    expect(repo.insertPollOption).toHaveBeenNthCalledWith(2, postId, 'Cargo', 1)
    expect(repo.insertPollOption).toHaveBeenNthCalledWith(3, postId, 'Bridge', 2)
  })

  it.each([
    ['like', async (service: Awaited<ReturnType<typeof serviceFor>>) => service.setLiked(viewerId, postId, true)],
    ['save', async (service: Awaited<ReturnType<typeof serviceFor>>) => service.setSaved(viewerId, postId, true)],
    ['comment', async (service: Awaited<ReturnType<typeof serviceFor>>) => service.addComment(viewerId, postId, 'Useful lesson.')],
  ])('rejects %s writes when the post is deleted, blocked or otherwise not interactable', async (_name, invoke) => {
    const repo = repository({ getInteractablePost: vi.fn(async () => null) })
    const service = await serviceFor(repo)

    await expect(invoke(service)).rejects.toThrow('feed_interaction_unavailable')
  })

  it('keeps like and save toggles viewer-scoped and idempotent through repository persistence', async () => {
    const repo = repository()
    const service = await serviceFor(repo)

    await service.setLiked(viewerId, postId, true)
    await service.setLiked(viewerId, postId, false)
    await service.setSaved(viewerId, postId, true)
    await service.setSaved(viewerId, postId, false)

    expect(repo.setLiked).toHaveBeenNthCalledWith(1, viewerId, postId, true)
    expect(repo.setLiked).toHaveBeenNthCalledWith(2, viewerId, postId, false)
    expect(repo.setSaved).toHaveBeenNthCalledWith(1, viewerId, postId, true)
    expect(repo.setSaved).toHaveBeenNthCalledWith(2, viewerId, postId, false)
  })

  it('allows a vote only on an interactable poll and an option belonging to that same post', async () => {
    const repo = repository({
      getInteractablePost: vi.fn(async () => ({ id: postId, authorId, postType: 'poll' as const })),
      pollOptionBelongsToPost: vi.fn(async () => false),
    })
    const service = await serviceFor(repo)

    await expect(service.setPollVote(viewerId, postId, optionId)).rejects.toThrow('feed_poll_option_unavailable')
    expect(repo.setPollVote).not.toHaveBeenCalled()
  })

  it('persists a valid poll vote using the permanent viewer UUID', async () => {
    const repo = repository({
      getInteractablePost: vi.fn(async () => ({ id: postId, authorId, postType: 'poll' as const })),
    })
    const service = await serviceFor(repo)

    await service.setPollVote(viewerId, postId, optionId)
    expect(repo.setPollVote).toHaveBeenCalledWith(viewerId, postId, optionId)
  })

  it('lazily maps visible reactor identities and signs only their avatar paths', async () => {
    const avatarPath = 'profiles/55555555-5555-4555-8555-555555555555/avatar.webp'
    const listReactionDetails = vi.fn(async () => ({
      rows: [{
        profile_id: '55555555-5555-4555-8555-555555555555',
        slug: 'reactor-a',
        full_name: 'Reactor A',
        avatar_path: avatarPath,
        headline: 'Master Mariner',
        rank: 'Master',
        current_company: 'Example Shipping',
        reaction_type: 'support' as const,
        reacted_at: '2026-09-10T09:00:00.000Z',
      }],
      nextCursor: null,
    }))
    const repo = repository({ listReactionDetails } as unknown as Partial<FeedRepository>)
    const resolveMediaUrls = vi.fn(async () => new Map([[avatarPath, 'https://example.test/reactor-avatar']]))
    const { createFeedService } = await import('./service')
    const create = createFeedService as unknown as (input: {
      withTransaction: <T>(fn: (repository: FeedRepository) => Promise<T>) => Promise<T>
      resolveMediaUrls: (paths: string[]) => Promise<Map<string, string>>
    }) => {
      getReactionDetails(actorId: string, request: {
        targetType: 'post' | 'comment'
        targetId: string
        reaction?: 'like' | 'support' | 'respect' | 'on_point'
        limit: number
      }): Promise<{ reactors: Array<{ id: string; avatarUrl: string | null; reaction: string; reactedAt: string }>; nextCursor: string | null }>
    }
    const service = create({
      withTransaction: async <T>(fn: (repository: FeedRepository) => Promise<T>) => fn(repo),
      resolveMediaUrls,
    })

    const page = await service.getReactionDetails(viewerId, {
      targetType: 'post',
      targetId: postId,
      reaction: 'support',
      limit: 30,
    })

    expect(repo.getInteractablePost).toHaveBeenCalledWith({ viewerProfileId: viewerId, postId })
    expect(listReactionDetails).toHaveBeenCalledWith({
      viewerProfileId: viewerId,
      targetType: 'post',
      targetId: postId,
      reaction: 'support',
      limit: 30,
    })
    expect(resolveMediaUrls).toHaveBeenCalledWith([avatarPath])
    expect(page).toEqual({
      reactors: [expect.objectContaining({
        id: '55555555-5555-4555-8555-555555555555',
        avatarUrl: 'https://example.test/reactor-avatar',
        reaction: 'support',
        reactedAt: '2026-09-10T09:00:00.000Z',
      })],
      nextCursor: null,
    })
  })
})

describe('feed service comment management', () => {
  it('updates an owned comment in place and notifies only newly introduced mentions', async () => {
    const existingMentionId = '66666666-6666-4666-8666-666666666666'
    const newMentionId = '77777777-7777-4777-8777-777777777777'
    const replaceCommentMentions = vi.fn(async () => ({
      mentionProfileIds: [existingMentionId, newMentionId],
      newlyIntroducedProfileIds: [newMentionId],
    }))
    const repo = repository({ replaceCommentMentions })
    const social = socialWriter()
    const service = await managedServiceFor(repo, social)

    await expect(service.updateComment(
      viewerId,
      commentId,
      '  Updated watchkeeping note.  ',
      [existingMentionId, newMentionId, newMentionId],
    )).resolves.toEqual({ id: commentId, postId, parentCommentId: null })

    expect(repo.getCommentForInteraction).toHaveBeenCalledWith(viewerId, commentId)
    expect(repo.updateOwnCommentWithinEditWindow).toHaveBeenCalledWith(viewerId, commentId, 'Updated watchkeeping note.')
    expect(replaceCommentMentions).toHaveBeenCalledWith(viewerId, commentId, [existingMentionId, newMentionId, newMentionId])
    expect(social.upsertNotification).toHaveBeenCalledTimes(1)
    expect(social.upsertNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: newMentionId,
      actorId: viewerId,
      type: 'comment_mention',
      postId,
      commentId,
      dedupeKey: `comment-mention:${commentId}:${newMentionId}`,
    }))
    expect(social.enqueue).toHaveBeenCalledTimes(1)
    expect(social.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      aggregateType: 'comment',
      aggregateId: commentId,
      eventType: 'comment.mentioned',
      payload: expect.objectContaining({ actorId: viewerId, targetId: newMentionId, postId, commentId }),
    }))
  })

  it('rejects an owned edit once the authoritative database edit window has closed', async () => {
    const repo = repository({ updateOwnCommentWithinEditWindow: vi.fn(async () => null) })
    const service = await managedServiceFor(repo)

    await expect(service.updateComment(viewerId, commentId, 'Too late.', [])).rejects.toThrow('feed_comment_edit_expired')
    expect(repo.replaceCommentMentions).not.toHaveBeenCalled()
  })

  it('rejects non-owner edit and delete before calling owner-scoped mutations', async () => {
    const repo = repository({
      getCommentForInteraction: vi.fn(async () => ({
        id: commentId,
        postId,
        authorId,
        parentCommentId: null,
        rootParentId: commentId,
        postAuthorId: authorId,
      })),
    })
    const service = await managedServiceFor(repo)

    await expect(service.updateComment(viewerId, commentId, 'Not mine.', [])).rejects.toThrow('feed_comment_mutation_forbidden')
    await expect(service.deleteComment(viewerId, commentId)).rejects.toThrow('feed_comment_mutation_forbidden')
    expect(repo.updateOwnCommentWithinEditWindow).not.toHaveBeenCalled()
    expect(repo.softDeleteOwnComment).not.toHaveBeenCalled()
  })

  it('rejects deleted or unavailable comment targets generically', async () => {
    const repo = repository({ getCommentForInteraction: vi.fn(async () => null) })
    const service = await managedServiceFor(repo)

    await expect(service.updateComment(viewerId, commentId, 'Unavailable.', [])).rejects.toThrow('feed_interaction_unavailable')
    await expect(service.deleteComment(viewerId, commentId)).rejects.toThrow('feed_interaction_unavailable')
  })

  it('soft-deletes an owned comment without applying an age limit', async () => {
    const repo = repository()
    const service = await managedServiceFor(repo)

    await expect(service.deleteComment(viewerId, commentId)).resolves.toEqual({ id: commentId, postId, parentCommentId: null })
    expect(repo.softDeleteOwnComment).toHaveBeenCalledWith(viewerId, commentId)
  })

  it('emits no mention notification when an edit only removes existing mentions', async () => {
    const repo = repository({
      replaceCommentMentions: vi.fn(async () => ({
        mentionProfileIds: [],
        newlyIntroducedProfileIds: [],
      })),
    })
    const social = socialWriter()
    const service = await managedServiceFor(repo, social)

    await service.updateComment(viewerId, commentId, 'Mention removed.', [])

    expect(social.upsertNotification).not.toHaveBeenCalled()
    expect(social.enqueue).not.toHaveBeenCalled()
  })
})
