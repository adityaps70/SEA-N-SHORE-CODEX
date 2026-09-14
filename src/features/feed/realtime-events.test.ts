import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedRepository } from './repository'
import { createFeedService } from './service'
import type { FeedSocialWriter } from './social-writer'

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const POST_ID = '22222222-2222-4222-8222-222222222222'
const COMMENT_ID = '33333333-3333-4333-8333-333333333333'

type FeedInvalidationType =
  | 'feed.post_created'
  | 'feed.post_reaction_changed'
  | 'feed.post_comments_changed'

type ObservedEvent = {
  aggregateType?: unknown
  aggregateId?: unknown
  eventType?: unknown
  schemaVersion?: unknown
  occurredAt?: unknown
  payload?: unknown
}

function createHarness() {
  const repository = {
    isMemberReady: vi.fn(async () => true),
    insertStandardPost: vi.fn(async () => undefined),
    insertPollPost: vi.fn(async () => undefined),
    insertPollOption: vi.fn(async () => undefined),
    getInteractablePost: vi.fn(async () => ({
      authorId: ACTOR_ID,
      postType: 'standard',
    })),
    setPostReaction: vi.fn(async () => undefined),
    setLiked: vi.fn(async () => undefined),
    addComment: vi.fn(async () => COMMENT_ID),
  }

  const social = {
    enqueue: vi.fn(async (_event: unknown) => undefined),
    upsertNotification: vi.fn(async (_notification: unknown) => undefined),
    deleteNotification: vi.fn(async (_recipientId: string, _dedupeKey: string) => undefined),
  }

  const service = createFeedService({
    createId: () => POST_ID,
    withTransaction: async (fn) => fn(
      repository as unknown as FeedRepository,
      social as unknown as FeedSocialWriter,
    ),
  })

  return { repository, social, service }
}

function expectMutationBeforeEvent(mutation: { mock: { invocationCallOrder: number[] } }, social: ReturnType<typeof createHarness>['social']) {
  expect(mutation.mock.invocationCallOrder[0]).toBeLessThan(social.enqueue.mock.invocationCallOrder[0])
}

function expectFeedEvent(
  social: ReturnType<typeof createHarness>['social'],
  eventType: FeedInvalidationType,
) {
  expect(social.enqueue).toHaveBeenCalledWith(expect.objectContaining({
    aggregateType: 'post',
    aggregateId: POST_ID,
    eventType,
    schemaVersion: 1,
    occurredAt: expect.any(String),
    payload: {
      eventType,
      actorId: ACTOR_ID,
      postId: POST_ID,
    },
  }))

  const events = social.enqueue.mock.calls.map(([event]) => event as ObservedEvent)
  const invalidation = events.find((event) => event.eventType === eventType)
  expect(invalidation?.payload).not.toEqual(expect.objectContaining({ body: expect.anything() }))
  expect(invalidation?.payload).not.toEqual(expect.objectContaining({ commentBody: expect.anything() }))
}

describe('feed realtime outbox events', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('enqueues a feed invalidation in the same transaction after durable standard-post creation', async () => {
    const { repository, social, service } = createHarness()

    await service.createStandardPost(ACTOR_ID, {
      id: POST_ID,
      category: 'General',
      body: 'Canonical post content stays out of realtime events.',
    })

    expectMutationBeforeEvent(repository.insertStandardPost, social)
    expectFeedEvent(social, 'feed.post_created')
  })

  it('enqueues the same post-created invalidation for poll posts', async () => {
    const { repository, social, service } = createHarness()

    await service.createPollPost(ACTOR_ID, {
      category: 'General',
      body: 'Which route would you choose?',
      pollOptions: ['Suez', 'Cape of Good Hope'],
    })

    expectMutationBeforeEvent(repository.insertPollPost, social)
    expectFeedEvent(social, 'feed.post_created')
  })

  it.each([null, 'like'] as const)(
    'enqueues a reaction invalidation after durable post reaction mutation (%s)',
    async (reaction) => {
      const { repository, social, service } = createHarness()

      await service.setPostReaction(ACTOR_ID, POST_ID, reaction)

      expect(repository.setPostReaction).toHaveBeenCalledWith(ACTOR_ID, POST_ID, reaction)
      expectMutationBeforeEvent(repository.setPostReaction, social)
      expectFeedEvent(social, 'feed.post_reaction_changed')
    },
  )

  it.each([false, true])(
    'enqueues a reaction invalidation after durable legacy like mutation (%s)',
    async (liked) => {
      const { repository, social, service } = createHarness()

      await service.setLiked(ACTOR_ID, POST_ID, liked)

      expect(repository.setLiked).toHaveBeenCalledWith(ACTOR_ID, POST_ID, liked)
      expectMutationBeforeEvent(repository.setLiked, social)
      expectFeedEvent(social, 'feed.post_reaction_changed')
    },
  )

  it('enqueues a comments invalidation after durable comment creation without leaking the body', async () => {
    const { repository, social, service } = createHarness()

    await service.addComment(
      ACTOR_ID,
      POST_ID,
      'This body remains canonical and must not become realtime payload content.',
    )

    expect(repository.addComment).toHaveBeenCalledWith(
      ACTOR_ID,
      POST_ID,
      'This body remains canonical and must not become realtime payload content.',
      null,
    )
    expectMutationBeforeEvent(repository.addComment, social)
    expectFeedEvent(social, 'feed.post_comments_changed')
  })
})
