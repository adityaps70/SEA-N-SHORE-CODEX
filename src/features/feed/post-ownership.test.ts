import { describe, expect, it, vi } from 'vitest'
import type { FeedRepository } from './repository'

const ownerId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const postId = '33333333-3333-4333-8333-333333333333'

function repository(overrides: Partial<FeedRepository> = {}) {
  return {
    isMemberReady: vi.fn(async () => true),
    deleteOwnPost: vi.fn(async () => true),
    ...overrides,
  } as unknown as FeedRepository
}

async function serviceFor(repo: FeedRepository) {
  const { createFeedService } = await import('./service')
  return createFeedService({
    withTransaction: async <T>(fn: (repository: FeedRepository) => Promise<T>) => fn(repo),
  })
}

describe('post ownership deletion', () => {
  it('soft-deletes only through an owner-scoped repository mutation', async () => {
    const repo = repository()
    const service = await serviceFor(repo)

    await expect(service.deletePost(ownerId, postId)).resolves.toBe(true)
    expect(repo.deleteOwnPost).toHaveBeenCalledWith(ownerId, postId)
  })

  it('fails closed when the signed-in member does not own the post', async () => {
    const repo = repository({ deleteOwnPost: vi.fn(async () => false) })
    const service = await serviceFor(repo)

    await expect(service.deletePost(otherId, postId)).rejects.toThrow('feed_post_delete_forbidden')
  })
})
