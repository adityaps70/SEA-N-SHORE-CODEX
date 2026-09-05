import { describe, expect, it, vi } from 'vitest'
import type { FeedRepository } from './repository'

const viewerId = '11111111-1111-4111-8111-111111111111'
const authorId = '22222222-2222-4222-8222-222222222222'
const postId = '33333333-3333-4333-8333-333333333333'
const optionId = '44444444-4444-4444-8444-444444444444'

function repository(overrides: Partial<FeedRepository> = {}) {
  return {
    isMemberReady: vi.fn(async () => true),
    getInteractablePost: vi.fn(async () => ({ id: postId, authorId, postType: 'standard' as const })),
    insertStandardPost: vi.fn(async () => undefined),
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

function serviceFor(repo: FeedRepository) {
  return import('./service').then(({ createFeedService }) => createFeedService({
    createId: () => postId,
    withTransaction: async (fn) => fn(repo),
  }))
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
})
