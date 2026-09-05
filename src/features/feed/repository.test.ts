import { describe, expect, it, vi } from 'vitest'
import type { FeedPostRow } from './mappers'

const viewerId = '11111111-1111-4111-8111-111111111111'
const authorId = '22222222-2222-4222-8222-222222222222'
const postId = '33333333-3333-4333-8333-333333333333'

function callsOf(query: { mock: { calls: unknown[] } }) {
  return query.mock.calls as unknown as Array<[string, readonly unknown[]?]>
}

describe('feed repository', () => {
  it('loads feed rows in created_at/id descending order with cursor, category and bilateral block exclusion', async () => {
    const query = vi.fn(async () => [] as FeedPostRow[])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    await repository.listFeedRows({
      viewerProfileId: viewerId,
      category: 'safety_lessons',
      cursor: { createdAt: '2026-09-05T06:00:00.000Z', id: postId },
      limit: 21,
    })

    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/p\.deleted_at is null/i)
    expect(sql).toMatch(/p\.category = \$2/i)
    expect(sql).toMatch(/\(p\.created_at < \$3 or \(p\.created_at = \$3 and p\.id < \$4\)\)/i)
    expect(sql).toMatch(/user_blocks/i)
    expect(sql).toMatch(/order by p\.created_at desc, p\.id desc/i)
    expect(sql).toMatch(/limit \$5/i)
    expect(values).toEqual([viewerId, 'safety_lessons', '2026-09-05T06:00:00.000Z', postId, 21])
  })

  it('hydrates viewer liked, saved and vote state only for the permanent viewer UUID', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ post_id: postId }])
      .mockResolvedValueOnce([{ post_id: postId }])
      .mockResolvedValueOnce([{ post_id: postId, option_id: '44444444-4444-4444-8444-444444444444' }])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    const state = await repository.getViewerState(viewerId, [postId])

    expect(state.likedPostIds.has(postId)).toBe(true)
    expect(state.savedPostIds.has(postId)).toBe(true)
    expect(state.pollVotes.get(postId)).toBe('44444444-4444-4444-8444-444444444444')
    for (const [, values] of callsOf(query)) expect(values?.[0]).toBe(viewerId)
  })

  it('checks post interaction availability with active viewer and bilateral block exclusion', async () => {
    const query = vi.fn(async () => [{ id: postId, author_id: authorId, post_type: 'standard' }])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    await expect(repository.getInteractablePost({ viewerProfileId: viewerId, postId })).resolves.toEqual({
      id: postId,
      authorId,
      postType: 'standard',
    })
    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/account_status = 'active'/i)
    expect(sql).toMatch(/onboarding_completed_at is not null/i)
    expect(sql).toMatch(/user_blocks/i)
    expect(values).toEqual([postId, viewerId])
  })

  it('uses viewer-scoped idempotent like/save/vote persistence', async () => {
    const query = vi.fn(async () => [])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    await repository.setLiked(viewerId, postId, true)
    await repository.setSaved(viewerId, postId, false)
    await repository.setPollVote(viewerId, postId, '44444444-4444-4444-8444-444444444444')

    const calls = callsOf(query)
    expect(calls[0][0]).toMatch(/on conflict \(post_id, user_id\) do nothing/i)
    expect(calls[0][1]).toEqual([postId, viewerId])
    expect(calls[1][0]).toMatch(/delete from public\.saved_posts/i)
    expect(calls[1][1]).toEqual([postId, viewerId])
    expect(calls[2][0]).toMatch(/on conflict \(post_id, user_id\).*do update/i)
    expect(calls[2][1]).toEqual([postId, '44444444-4444-4444-8444-444444444444', viewerId])
  })
})
