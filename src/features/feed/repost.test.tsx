import { fireEvent, render, screen } from '@testing-library/react'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedRepository } from './repository'
import type { FeedSocialWriter } from './social-writer'
import { SharePostButton } from './components/share-post-button'

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const SOURCE_POST_ID = '22222222-2222-4222-8222-222222222222'
const REPOST_ID = '33333333-3333-4333-8333-333333333333'

const actionMocks = vi.hoisted(() => ({
  repostPost: vi.fn(async () => ({ ok: true as const, postId: REPOST_ID })),
}))

vi.mock('./actions', () => ({
  repostPost: actionMocks.repostPost,
}))

afterEach(() => {
  vi.restoreAllMocks()
  actionMocks.repostPost.mockClear()
})

describe('durable post reposts', () => {
  it('defines a canonical repost post type without copying original post content', async () => {
    const migration = await readFile(
      new URL('../../../infra/aws/database/migrations/0015_post_reposts.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toMatch(/alter type public\.post_type add value if not exists 'repost'/i)
    expect(migration).toMatch(/add column repost_of_post_id uuid references public\.posts\(id\) on delete cascade/i)
    expect(migration).toMatch(/post_type = 'repost'[\s\S]*body = ''/i)
    expect(migration).toMatch(/post_type = 'repost'[\s\S]*repost_of_post_id is not null/i)
    expect(migration).toMatch(/create unique index posts_active_repost_unique_idx[\s\S]*author_id, repost_of_post_id[\s\S]*post_type = 'repost'[\s\S]*deleted_at is null/i)
  })

  it('persists the repost before enqueueing one metadata-safe feed invalidation in the same transaction', async () => {
    const insertRepost = vi.fn(async () => undefined)
    const repository = {
      getInteractablePost: vi.fn(async () => ({ id: SOURCE_POST_ID, authorId: ACTOR_ID, postType: 'standard' })),
      insertRepost,
    }
    const social = {
      enqueue: vi.fn(async (_event: unknown) => undefined),
      upsertNotification: vi.fn(async (_event: unknown) => undefined),
      deleteNotification: vi.fn(async (_recipientId: string, _dedupeKey: string) => undefined),
    }
    const { createFeedService } = await import('./service')
    const service = createFeedService({
      createId: () => REPOST_ID,
      withTransaction: async (fn) => fn(
        repository as unknown as FeedRepository,
        social as unknown as FeedSocialWriter,
      ),
    }) as unknown as {
      repostPost(actorId: string, sourcePostId: string): Promise<string>
    }

    await expect(service.repostPost(ACTOR_ID, SOURCE_POST_ID)).resolves.toBe(REPOST_ID)
    expect(repository.getInteractablePost).toHaveBeenCalledWith({ viewerProfileId: ACTOR_ID, postId: SOURCE_POST_ID })
    expect(insertRepost).toHaveBeenCalledWith({
      id: REPOST_ID,
      authorId: ACTOR_ID,
      sourcePostId: SOURCE_POST_ID,
    })
    expect(insertRepost.mock.invocationCallOrder[0]).toBeLessThan(social.enqueue.mock.invocationCallOrder[0])
    expect(social.enqueue).toHaveBeenCalledTimes(1)
    expect(social.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      aggregateType: 'post',
      aggregateId: REPOST_ID,
      eventType: 'feed.post_reposted',
      schemaVersion: 1,
      payload: {
        eventType: 'feed.post_reposted',
        actorId: ACTOR_ID,
        postId: REPOST_ID,
      },
    }))
    expect(social.enqueue.mock.calls[0]?.[0]).not.toEqual(expect.objectContaining({ body: expect.anything() }))
  })

  it('offers a durable repost choice without removing external sharing', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    })

    render(<SharePostButton postId={SOURCE_POST_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /^Share$/i }))

    expect(screen.getByRole('button', { name: /Repost to feed/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copy link/i })).toBeInTheDocument()
  })
})
