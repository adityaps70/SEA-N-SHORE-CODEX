import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import type { DomainEvent } from '@/features/events/types'
import { FEED_PUSH_AUDIENCE_CAP, withFeedPushAudience } from './feed-push-audience'

/**
 * Round ARCH (broadcast fix) against the real schema (PGlite, every migration): a new post's hint goes to the
 * author's network only, a like or comment's hint only to the post's author, and never to or from a load-test
 * account. Placeholder data only.
 */

let db: TestDatabase
let sequence = 0
const query = <T extends QueryResultRow>(text: string, values?: readonly unknown[]) => db.query(text, values) as Promise<T[]>

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function member(loadTest = false) {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at, is_load_test)
     values (gen_random_uuid(), $1, $2, now(), $3) returning id`,
    [`Fixture Member ${sequence}`, `fixture-audience-${sequence}`, loadTest],
  )
  return rows[0]!.id as string
}

async function connect(a: string, b: string, status: 'accepted' | 'pending' = 'accepted') {
  const [low, high] = a < b ? [a, b] : [b, a]
  await db.query(`insert into public.connections (user_low_id, user_high_id, requested_by, status) values ($1, $2, $3, $4::public.connection_status)`, [low, high, a, status])
}

async function follow(follower: string, following: string) {
  await db.query(`insert into public.follows (follower_id, following_id) values ($1, $2)`, [follower, following])
}

async function post(authorId: string) {
  const rows = await db.query(
    `insert into public.posts (author_id, category, body, post_type) values ($1, 'technical_discussion', 'Placeholder text', 'standard') returning id`,
    [authorId],
  )
  return rows[0]!.id as string
}

function event(eventType: string, actorId: string, postId: string): DomainEvent {
  return {
    id: crypto.randomUUID(), aggregateType: 'post', aggregateId: postId, eventType, schemaVersion: 1,
    occurredAt: new Date().toISOString(), payload: { eventType, actorId, postId },
  } as DomainEvent
}

async function audience(eventType: string, actorId: string, postId: string) {
  const [enriched] = await withFeedPushAudience([event(eventType, actorId, postId)], query)
  return ((enriched!.payload as { audienceProfileIds: string[] }).audienceProfileIds).slice().sort()
}

describe('feed push audience', () => {
  it("sends a new post's hint to the author's connections and followers only, never to load-test accounts", async () => {
    const author = await member()
    const connection = await member()
    const follower = await member()
    const pending = await member()
    const stranger = await member()
    const loadTestFollower = await member(true)
    await connect(author, connection)
    await connect(author, pending, 'pending')
    await follow(follower, author)
    await follow(loadTestFollower, author)
    await follow(author, stranger)
    const postId = await post(author)

    expect(await audience('feed.post_created', author, postId)).toEqual([connection, follower].sort())
    expect(await audience('feed.post_reposted', author, postId)).toEqual([connection, follower].sort())
  })

  it("sends a like or comment's hint only to the post's author, and not when the author made it", async () => {
    const author = await member()
    const reader = await member()
    await connect(author, reader)
    const postId = await post(author)

    expect(await audience('feed.post_reaction_changed', reader, postId)).toEqual([author])
    expect(await audience('feed.post_comments_changed', reader, postId)).toEqual([author])
    expect(await audience('feed.post_reaction_changed', author, postId)).toEqual([])
  })

  it('sends nothing for a load-test actor, or to a load-test author', async () => {
    const loadTestAuthor = await member(true)
    const realFollower = await member()
    await follow(realFollower, loadTestAuthor)
    const loadTestPost = await post(loadTestAuthor)
    expect(await audience('feed.post_created', loadTestAuthor, loadTestPost)).toEqual([])

    const realAuthor = await member()
    const realPost = await post(realAuthor)
    const loadTestReader = await member(true)
    expect(await audience('feed.post_reaction_changed', loadTestReader, realPost)).toEqual([])
    expect(await audience('feed.post_reaction_changed', realFollower, loadTestPost)).toEqual([])
  })

  it(`caps a new post's audience at ${FEED_PUSH_AUDIENCE_CAP} and leaves other events untouched`, async () => {
    const author = await member()
    await db.query(
      `with made as (
         insert into public.profiles (id, full_name, slug, onboarding_completed_at)
         select gen_random_uuid(), 'Fixture Follower', 'fixture-cap-' || n, now() from generate_series(1, $1::int) n
         returning id
       )
       insert into public.follows (follower_id, following_id) select id, $2 from made`,
      [FEED_PUSH_AUDIENCE_CAP + 20, author],
    )
    const postId = await post(author)
    expect(await audience('feed.post_created', author, postId)).toHaveLength(FEED_PUSH_AUDIENCE_CAP)

    const message = { ...event('message.created', author, postId), payload: { eventType: 'message.created' } } as unknown as DomainEvent
    const [unchanged] = await withFeedPushAudience([message], query)
    expect(unchanged).toBe(message)
  })

  it('fails safe: an audience that cannot be read means no push, not a failed publish', async () => {
    const failing = async () => { throw new Error('database unavailable') }
    const [enriched] = await withFeedPushAudience([event('feed.post_created', 'a', 'b')], failing as never)
    expect((enriched!.payload as { audienceProfileIds: string[] }).audienceProfileIds).toEqual([])
  })

  it('queues notification.created for every new notification, and gives it the recipient and their unread count', async () => {
    const recipient = await member()
    const actor = await member()
    const notify = async (dedupe: string) => db.query(
      `insert into public.notifications (recipient_id, actor_id, notification_type, dedupe_key)
       values ($1, $2, 'new_follower', $3) on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing returning id`,
      [recipient, actor, dedupe],
    )
    const first = await notify(`audience-test-${recipient}-1`)
    await notify(`audience-test-${recipient}-2`)
    await notify(`audience-test-${recipient}-1`) // a repeat inserts nothing and queues nothing

    const queued = await db.query(
      `select aggregate_type, aggregate_id, payload from public.event_outbox
       where event_type = 'notification.created' and payload->>'recipientId' = $1 order by occurred_at, aggregate_id`,
      [recipient],
    )
    expect(queued).toHaveLength(2)
    expect(queued.map((row) => row.aggregate_type)).toEqual(['notification', 'notification'])
    expect(queued.map((row) => row.aggregate_id)).toContain(first[0]!.id)
    expect(Object.keys(queued[0]!.payload as object).sort()).toEqual(['eventType', 'notificationId', 'recipientId'])

    const event = {
      id: crypto.randomUUID(), aggregateType: 'notification', aggregateId: first[0]!.id, eventType: 'notification.created', schemaVersion: 1,
      occurredAt: new Date().toISOString(), payload: queued[0]!.payload,
    } as unknown as DomainEvent
    const [enriched] = await withFeedPushAudience([event], query)
    expect(enriched!.payload).toMatchObject({ audienceProfileIds: [recipient], unreadNotificationCount: 2 })

    await db.query(`update public.notifications set read_at = now() where recipient_id = $1`, [recipient])
    const [afterRead] = await withFeedPushAudience([event], query)
    expect(afterRead!.payload).toMatchObject({ audienceProfileIds: [recipient], unreadNotificationCount: 0 })
  })

  it('never pushes a notification count to a load-test account', async () => {
    const loadTestRecipient = await member(true)
    const event = {
      id: crypto.randomUUID(), aggregateType: 'notification', aggregateId: crypto.randomUUID(), eventType: 'notification.created', schemaVersion: 1,
      occurredAt: new Date().toISOString(), payload: { eventType: 'notification.created', recipientId: loadTestRecipient, notificationId: crypto.randomUUID() },
    } as unknown as DomainEvent
    const [enriched] = await withFeedPushAudience([event], query)
    expect((enriched!.payload as { audienceProfileIds: string[] }).audienceProfileIds).toEqual([])
    expect(enriched!.payload).not.toHaveProperty('unreadNotificationCount')
  })
})
