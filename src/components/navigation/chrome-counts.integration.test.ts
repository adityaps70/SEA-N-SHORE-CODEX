import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createIdentityRepository } from '@/features/auth/identity-repository'
import { createMessagingRepository } from '@/features/messaging/repository'
import { createNetworkRepository } from '@/features/network/repository'
import { createNotificationRepository } from '@/features/notifications/repository'
import { createChromeCounts } from './chrome-counts'

/**
 * Round DB (Deploy A) against the real schema (PGlite, every migration): the one-query header badges give exactly the
 * three counts the separate queries give, and the joined sign-in lookup and grouped notification writes behave as the
 * statements they replace. Placeholder data only.
 */
let db: TestDatabase
const query = (text: string, values?: readonly unknown[]) => db.query(text, values)

async function profile(name: string) {
  const [row] = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`, [name])
  return String(row!.id)
}

const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]) as [string, string]

async function connection(a: string, b: string, requestedBy: string, status: 'pending' | 'accepted') {
  const [low, high] = pair(a, b)
  await db.query(
    `insert into public.connections (user_low_id, user_high_id, requested_by, status) values ($1, $2, $3, $4::public.connection_status)`,
    [low, high, requestedBy, status],
  )
}

async function conversation(a: string, b: string) {
  const [low, high] = pair(a, b)
  const [row] = await db.query(
    `insert into public.conversations (direct_user_low_id, direct_user_high_id) values ($1, $2) returning id`,
    [low, high],
  )
  const id = String(row!.id)
  await db.query(`insert into public.conversation_participants (conversation_id, profile_id) values ($1, $2), ($1, $3)`, [id, a, b])
  return id
}

async function message(conversationId: string, senderId: string, body: string) {
  const [row] = await db.query(
    `insert into public.messages (conversation_id, sender_profile_id, client_message_id, body, created_at)
     values ($1, $2, gen_random_uuid(), $3, clock_timestamp()) returning id`,
    [conversationId, senderId, body],
  )
  return String(row!.id)
}

async function notification(recipientId: string, read: boolean) {
  const [row] = await db.query(
    `insert into public.notifications (recipient_id, notification_type, read_at) values ($1, 'new_follower', ${read ? 'now()' : 'null'}) returning id`,
    [recipientId],
  )
  return String(row!.id)
}

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('one-query header badges', () => {
  it('match the three separate counts for every member', async () => {
    const viewer = await profile('Placeholder Viewer')
    const sender = await profile('Placeholder Sender')
    const outgoing = await profile('Placeholder Outgoing')
    const reader = await profile('Placeholder Reader')

    await notification(viewer, false)
    await notification(viewer, false)
    await notification(viewer, true)
    await notification(sender, false)

    await connection(viewer, sender, sender, 'pending')
    await connection(viewer, outgoing, viewer, 'pending')
    await connection(viewer, reader, reader, 'accepted')

    const unread = await conversation(viewer, sender)
    await message(unread, sender, 'Placeholder hello')
    await message(unread, sender, 'Placeholder again')
    const mine = await conversation(viewer, outgoing)
    await message(mine, viewer, 'Placeholder from me')
    const seen = await conversation(viewer, reader)
    const last = await message(seen, reader, 'Placeholder read')
    await db.query(`update public.conversation_participants set last_read_message_id = $1 where conversation_id = $2 and profile_id = $3`, [last, seen, viewer])

    const notifications = createNotificationRepository({ query })
    const messaging = createMessagingRepository({ query })
    const network = createNetworkRepository({ query })
    const load = createChromeCounts({ query: query as never })

    for (const member of [viewer, sender, outgoing, reader]) {
      const separate = {
        notificationUnreadCount: await notifications.countUnread(member),
        messagingUnreadCount: await messaging.countUnreadMessages(member),
        pendingConnectionRequestCount: await network.countIncomingRequests(member),
      }
      await expect(load(member)).resolves.toEqual(separate)
    }
    await expect(load(viewer)).resolves.toEqual({ notificationUnreadCount: 2, messagingUnreadCount: 1, pendingConnectionRequestCount: 1 })
    await expect(load(outgoing)).resolves.toEqual({ notificationUnreadCount: 0, messagingUnreadCount: 1, pendingConnectionRequestCount: 1 })
  })
})

describe('joined sign-in lookup', () => {
  it('returns the same profile and status as the two separate statements', async () => {
    const identity = createIdentityRepository({ query: query as never })
    const member = await profile('Placeholder Member')
    await db.query(`update public.profiles set account_status = 'suspended' where id = $1`, [member])
    await db.query(`insert into public.identity_accounts (profile_id, provider, provider_subject) values ($1, 'cognito', 'placeholder-sub-1')`, [member])

    await expect(identity.resolveProfileWithStatusForCognitoSub('placeholder-sub-1')).resolves.toEqual({
      profileId: await identity.resolveProfileIdForCognitoSub('placeholder-sub-1'),
      accountStatus: await identity.getProfileAccountStatus(member),
    })
    await expect(identity.resolveProfileWithStatusForCognitoSub('placeholder-sub-1')).resolves.toEqual({ profileId: member, accountStatus: 'suspended' })
    await expect(identity.resolveProfileWithStatusForCognitoSub('placeholder-missing')).resolves.toBeNull()
  })
})

describe('grouped notification writes', () => {
  it('only touch the recipient’s own notifications, in one statement each', async () => {
    const notifications = createNotificationRepository({ query })
    const owner = await profile('Placeholder Owner')
    const other = await profile('Placeholder Other')
    const first = await notification(owner, false)
    const second = await notification(owner, false)
    const theirs = await notification(other, false)

    await expect(notifications.markReadMany(owner, [first, second, theirs])).resolves.toBe(2)
    expect(await notifications.countUnread(owner)).toBe(0)
    expect(await notifications.countUnread(other)).toBe(1)

    await expect(notifications.deleteManyForRecipient(owner, [first, theirs])).resolves.toBe(1)
    const left = await db.query(`select id from public.notifications where id = any($1::uuid[]) order by id`, [[first, second, theirs]])
    expect(left.map((row) => String(row.id)).sort()).toEqual([second, theirs].sort())
  })
})
