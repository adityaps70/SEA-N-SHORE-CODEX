import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import type { ResendEmailInput } from '@/lib/email/resend'

let db: TestDatabase
vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { createNotificationEmailRepository, createNotificationEmailWorker } = await import('./sending')
const { createNotificationEmailPreferences } = await import('./preferences')
const { createNotificationEmailToken } = await import('./tokens')
const route = await import('@/app/api/email/notifications/unsubscribe/route')

/**
 * Round H (H3) against the real schema (PGlite, every migration including 0088): each email type follows its
 * switch, the messages digest goes at most once an hour and only with unread messages, nothing is emailed about the
 * member's own actions, blocked members, removed content or inactive accounts, and the one-click unsubscribe turns
 * off only the type its signed token names. Placeholder names and example.invalid addresses only.
 */
const secret = 'test-secret-that-is-at-least-32-characters-long'
const siteUrl = 'https://seanshore.example'
let sequence = 0
let sent: ResendEmailInput[] = []

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  sent = []
  process.env.NEWSLETTER_TOKEN_SECRET = secret
  for (const table of [
    'member_notification_emails', 'member_message_digests', 'member_preferences', 'notifications', 'messages',
    'conversation_participants', 'conversations', 'post_comments', 'posts', 'user_blocks', 'connections', 'identity_accounts', 'profiles',
  ]) {
    await db.query(`delete from public.${table}`)
  }
})

async function member(input: { email?: boolean; status?: string } = {}) {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at, role_key, profile_type, time_zone, account_status)
     values (gen_random_uuid(), $1, $2, now(), 'second_officer', 'seafarer', 'Asia/Kolkata', $3::public.account_status) returning id`,
    [`Placeholder Sailor ${sequence}`, `placeholder-sailor-${sequence}`, input.status ?? 'active'],
  )
  const id = rows[0]!.id as string
  if (input.email !== false) {
    await db.query(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, true)`,
      [id, `notification-sub-${sequence}`, `member-${sequence}@example.invalid`],
    )
  }
  return id
}

async function setSwitch(profileId: string, kind: 'messages' | 'connection_requests' | 'comments' | 'mentions', enabled: boolean) {
  await createNotificationEmailPreferences({ query: (text, values) => db.query(text, values) }).set(profileId, kind, enabled)
}

async function post(authorId: string) {
  const rows = await db.query(`insert into public.posts (author_id, body, category, audience) values ($1, 'Placeholder post', 'maritime_news', 'anyone') returning id`, [authorId])
  return rows[0]!.id as string
}

async function comment(postId: string, authorId: string) {
  const rows = await db.query(`insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'Placeholder comment') returning id`, [postId, authorId])
  return rows[0]!.id as string
}

async function notify(input: { recipientId: string; actorId: string; type: string; postId?: string; commentId?: string; connectionId?: string; minutesAgo?: number }) {
  const rows = await db.query(
    `insert into public.notifications (recipient_id, actor_id, notification_type, post_id, comment_id, connection_id, created_at)
     values ($1, $2, $3::public.network_notification_type, $4, $5, $6, now() - make_interval(mins => $7::int)) returning id`,
    [input.recipientId, input.actorId, input.type, input.postId ?? null, input.commentId ?? null, input.connectionId ?? null, input.minutesAgo ?? 10],
  )
  return rows[0]!.id as string
}

async function connectionRequest(from: string, to: string) {
  const [low, high] = from < to ? [from, to] : [to, from]
  const rows = await db.query(`insert into public.connections (user_low_id, user_high_id, requested_by, status) values ($1, $2, $3, 'pending') returning id`, [low, high, from])
  return rows[0]!.id as string
}

/** One notification of each activity email type, from actor to recipient, as the app writes them. */
async function activity(kind: 'connection_requests' | 'comments' | 'mentions', recipientId: string, actorId: string) {
  if (kind === 'connection_requests') {
    return notify({ recipientId, actorId, type: 'connection_request', connectionId: await connectionRequest(actorId, recipientId) })
  }
  if (kind === 'comments') {
    const postId = await post(recipientId)
    return notify({ recipientId, actorId, type: 'post_comment', postId, commentId: await comment(postId, actorId) })
  }
  return notify({ recipientId, actorId, type: 'post_mention', postId: await post(actorId) })
}

async function conversation(a: string, b: string) {
  const [low, high] = a < b ? [a, b] : [b, a]
  const rows = await db.query(`insert into public.conversations (direct_user_low_id, direct_user_high_id) values ($1, $2) returning id`, [low, high])
  const id = rows[0]!.id as string
  await db.query(`insert into public.conversation_participants (conversation_id, profile_id) values ($1, $2), ($1, $3)`, [id, a, b])
  return id
}

async function message(conversationId: string, senderId: string, at: Date, body = 'Placeholder private message text') {
  const rows = await db.query(
    `insert into public.messages (conversation_id, sender_profile_id, client_message_id, body, created_at) values ($1, $2, gen_random_uuid(), $3, $4) returning id, created_at`,
    [conversationId, senderId, body, at.toISOString()],
  )
  return rows[0]!.id as string
}

async function markConversationRead(conversationId: string, profileId: string, messageId: string) {
  await db.query(
    `update public.conversation_participants set last_read_message_id = $3, last_read_at = (select created_at from public.messages where id = $3)
     where conversation_id = $1 and profile_id = $2`,
    [conversationId, profileId, messageId],
  )
}

function worker(now: () => Date = () => new Date()) {
  return createNotificationEmailWorker({
    repository: createNotificationEmailRepository({ query: (text, values) => db.query(text, values), transaction: db.transaction }),
    resend: { sendEmail: async (input) => { sent.push(input); return { messageId: `placeholder-${sent.length}` } } },
    tokenSecret: secret,
    siteUrl,
    now,
  })
}

async function queueRows(recipientId: string) {
  return db.query(`select kind, status, last_error from public.member_notification_emails where recipient_id = $1 order by created_at`, [recipientId])
}

const minutes = (count: number) => count * 60_000

describe('each email type follows its switch (round H, H3)', () => {
  it.each(['connection_requests', 'comments', 'mentions'] as const)('%s: emailed when on, never when off', async (kind) => {
    const on = await member()
    const off = await member()
    const actor = await member()
    await setSwitch(off, kind, false)
    await activity(kind, on, actor)
    await activity(kind, off, actor)

    const result = await worker().runSweep()

    expect(result).toMatchObject({ queued: 1, sent: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe(`member-${sequence - 2}@example.invalid`)
    expect(sent[0]!.headers).toEqual(expect.arrayContaining([{ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }]))
    expect(sent[0]!.tags).toEqual([{ name: 'category', value: `notification_${kind}` }])
    expect(await queueRows(off)).toEqual([])
  })

  it('messages: the digest is emailed when on, never when off', async () => {
    const on = await member()
    const off = await member()
    const sender = await member()
    await setSwitch(off, 'messages', false)
    const now = new Date()
    await message(await conversation(on, sender), sender, new Date(now.getTime() - minutes(10)))
    await message(await conversation(off, sender), sender, new Date(now.getTime() - minutes(10)))

    expect(await worker(() => now).runDigestSweep()).toMatchObject({ candidates: 1, queued: 1 })
    expect(await worker(() => now).runSweep()).toMatchObject({ sent: 1 })
    expect(sent.map((email) => email.to)).toEqual([`member-${sequence - 2}@example.invalid`])
    expect(await queueRows(off)).toEqual([])
  })

  it('a switch turned off after an email was queued still stops it', async () => {
    const recipient = await member()
    const actor = await member()
    await activity('mentions', recipient, actor)
    const repository = createNotificationEmailRepository({ query: (text, values) => db.query(text, values), transaction: db.transaction })
    expect(await repository.enqueueActivity(new Date())).toBe(1)
    await setSwitch(recipient, 'mentions', false)

    await worker().runSweep()

    expect(sent).toEqual([])
    expect(await queueRows(recipient)).toEqual([{ kind: 'mentions', status: 'skipped', last_error: 'email_type_off' }])
  })

  it('each type is queued once per notification, waits five minutes, and never repeats', async () => {
    const recipient = await member()
    const actor = await member()
    await activity('comments', recipient, actor)
    const fresh = await notify({ recipientId: recipient, actorId: actor, type: 'post_mention', postId: await post(actor), minutesAgo: 1 })

    await worker().runSweep()
    await worker().runSweep()

    expect(sent).toHaveLength(1)
    expect(await db.query(`select 1 from public.member_notification_emails where notification_id = $1`, [fresh])).toEqual([])
  })
})

describe('a busy post does not flood the inbox', () => {
  it('sends at most 10 activity emails of one type per member an hour', async () => {
    const recipient = await member()
    const postId = await post(recipient)
    for (let index = 0; index < 12; index += 1) {
      const actor = await member()
      await notify({ recipientId: recipient, actorId: actor, type: 'post_comment', postId, commentId: await comment(postId, actor) })
    }
    await activity('mentions', recipient, await member())

    await worker().runSweep(25)
    await worker().runSweep(25)

    expect(sent.filter((email) => email.subject.endsWith('commented on your post'))).toHaveLength(10)
    expect(sent.filter((email) => email.subject.endsWith('mentioned you in a post'))).toHaveLength(1)
    expect((await queueRows(recipient)).filter((row) => row.last_error === 'hourly_cap')).toHaveLength(2)
  })
})

describe('never emailed: own actions, blocked members, removed content, inactive accounts', () => {
  it('skips the member’s own actions (notifications and messages)', async () => {
    const self = await member()
    await notify({ recipientId: self, actorId: self, type: 'post_mention', postId: await post(self) })
    const other = await member()
    const now = new Date()
    await message(await conversation(self, other), self, new Date(now.getTime() - minutes(10)))

    await worker(() => now).runDigestSweep()
    await worker(() => now).runSweep()

    // Only the other member hears about the message; the sender is never emailed about their own.
    expect(await queueRows(self)).toEqual([])
    expect(sent.map((email) => email.to)).toEqual([`member-${sequence}@example.invalid`])
  })

  it('skips activity from a blocked member, whichever of the two blocked the other', async () => {
    const recipient = await member()
    const blockedByRecipient = await member()
    const blockerOfRecipient = await member()
    await activity('comments', recipient, blockedByRecipient)
    await activity('connection_requests', recipient, blockerOfRecipient)
    await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2), ($3, $1)`, [recipient, blockedByRecipient, blockerOfRecipient])

    await worker().runSweep()

    expect(sent).toEqual([])
    expect((await queueRows(recipient)).map((row) => row.last_error)).toEqual(['blocked', 'blocked'])
  })

  it('leaves messages from a blocked member out of the digest', async () => {
    const recipient = await member()
    const blocked = await member()
    const friend = await member()
    const now = new Date()
    await message(await conversation(recipient, blocked), blocked, new Date(now.getTime() - minutes(10)), 'Placeholder blocked text')
    await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [recipient, blocked])

    await worker(() => now).runDigestSweep()
    expect(await queueRows(recipient)).toEqual([])

    const later = new Date(now.getTime() + minutes(10))
    await message(await conversation(recipient, friend), friend, new Date(now.getTime() + minutes(1)))
    await worker(() => later).runDigestSweep()
    await worker(() => later).runSweep()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toContain('You have 1 unread message from Placeholder Sailor')
    expect(sent[0]!.text).not.toContain(`Placeholder Sailor ${sequence - 1}`)
  })

  it('skips deleted comments and posts, withdrawn requests, read and removed notifications', async () => {
    const recipient = await member()
    const actor = await member()
    const postId = await post(recipient)
    const deletedComment = await comment(postId, actor)
    await notify({ recipientId: recipient, actorId: actor, type: 'post_comment', postId, commentId: deletedComment })
    await db.query(`update public.post_comments set deleted_at = now() where id = $1`, [deletedComment])
    const deletedPost = await post(actor)
    await notify({ recipientId: recipient, actorId: actor, type: 'post_mention', postId: deletedPost })
    const withdrawn = await connectionRequest(actor, recipient)
    await notify({ recipientId: recipient, actorId: actor, type: 'connection_request', connectionId: withdrawn })
    const read = await activity('mentions', recipient, actor)
    const removed = await activity('mentions', recipient, actor)

    await createNotificationEmailRepository({ query: (text, values) => db.query(text, values), transaction: db.transaction }).enqueueActivity(new Date())
    await db.query(`update public.posts set deleted_at = now(), deletion_reason = 'Deleted by post author.', purge_after = now() + interval '30 days' where id = $1`, [deletedPost])
    await db.query(`delete from public.connections where id = $1`, [withdrawn])
    await db.query(`update public.notifications set read_at = now() where id = $1`, [read])
    await db.query(`delete from public.notifications where id = $1`, [removed])
    await worker().runSweep()

    expect(sent).toEqual([])
    expect((await queueRows(recipient)).map((row) => row.last_error).sort()).toEqual(
      ['already_read', 'content_unavailable', 'content_unavailable', 'content_unavailable', 'notification_gone'],
    )
  })

  it('respects account status: never to a suspended or deleted member, never about a suspended member', async () => {
    const suspended = await member({ status: 'suspended' })
    const leaving = await member({ status: 'deletion_requested' })
    const recipient = await member()
    const actor = await member()
    const suspendedActor = await member({ status: 'suspended' })
    await activity('mentions', suspended, actor)
    await activity('mentions', leaving, actor)
    await activity('connection_requests', recipient, suspendedActor)
    const now = new Date()
    await message(await conversation(suspended, actor), actor, new Date(now.getTime() - minutes(10)))

    await worker(() => now).runDigestSweep()
    await worker(() => now).runSweep()

    expect(sent).toEqual([])
    expect((await queueRows(suspended)).map((row) => row.last_error)).toEqual(['recipient_inactive'])
    expect((await queueRows(leaving)).map((row) => row.last_error)).toEqual(['recipient_inactive'])
    expect((await queueRows(recipient)).map((row) => row.last_error)).toEqual(['actor_unavailable'])
  })
})

describe('unread messages digest', () => {
  it('goes at most once an hour, only with unread messages, and never includes message text', async () => {
    const recipient = await member()
    const sender = await member()
    const chat = await conversation(recipient, sender)
    const start = new Date()
    await message(chat, sender, new Date(start.getTime() - minutes(30)), 'Placeholder secret one')
    await message(chat, sender, new Date(start.getTime() - minutes(20)), 'Placeholder secret two')

    expect(await worker(() => start).runDigestSweep()).toMatchObject({ queued: 1 })
    await worker(() => start).runSweep()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.subject).toBe('You have 2 unread messages on Sea N Shore')
    expect(sent[0]!.html).not.toContain('Placeholder secret')
    expect(sent[0]!.text).not.toContain('Placeholder secret')

    // A new message 30 minutes later: still within the hour, so nothing is sent.
    const halfHour = new Date(start.getTime() + minutes(30))
    await message(chat, sender, new Date(halfHour.getTime() - minutes(10)), 'Placeholder secret three')
    expect(await worker(() => halfHour).runDigestSweep()).toMatchObject({ candidates: 0, queued: 0 })
    await worker(() => halfHour).runSweep()
    expect(sent).toHaveLength(1)

    // After the hour: one more digest, covering only the message since the last one.
    const later = new Date(start.getTime() + minutes(61))
    expect(await worker(() => later).runDigestSweep()).toMatchObject({ queued: 1 })
    await worker(() => later).runSweep()
    expect(sent).toHaveLength(2)
    expect(sent[1]!.subject).toBe('You have 1 unread message on Sea N Shore')
  })

  it('sends nothing when the messages were read, and nothing for messages under five minutes old', async () => {
    const recipient = await member()
    const sender = await member()
    const chat = await conversation(recipient, sender)
    const now = new Date()
    const read = await message(chat, sender, new Date(now.getTime() - minutes(20)))
    await markConversationRead(chat, recipient, read)
    await message(chat, sender, new Date(now.getTime() - minutes(2)))

    expect(await worker(() => now).runDigestSweep()).toMatchObject({ candidates: 1, queued: 0, nothing: 1 })
    await worker(() => now).runSweep()
    expect(sent).toEqual([])
    // The window moved on past the read message; the fresh one is still due later.
    const later = new Date(now.getTime() + minutes(10))
    expect(await worker(() => later).runDigestSweep()).toMatchObject({ queued: 1 })
  })

  it('skips a queued digest whose messages were read before it went out', async () => {
    const recipient = await member()
    const sender = await member()
    const chat = await conversation(recipient, sender)
    const now = new Date()
    const only = await message(chat, sender, new Date(now.getTime() - minutes(10)))
    await worker(() => now).runDigestSweep()
    await markConversationRead(chat, recipient, only)

    await worker(() => now).runSweep()

    expect(sent).toEqual([])
    expect(await queueRows(recipient)).toEqual([{ kind: 'messages', status: 'skipped', last_error: 'nothing_unread' }])
  })

  it('is idempotent: repeated and overlapping sweeps queue one digest', async () => {
    const recipient = await member()
    const sender = await member()
    const now = new Date()
    await message(await conversation(recipient, sender), sender, new Date(now.getTime() - minutes(10)))
    const repository = createNotificationEmailRepository({ query: (text, values) => db.query(text, values), transaction: db.transaction })

    const results = await Promise.all([repository.queueDigest(recipient, now), repository.queueDigest(recipient, now)])
    await worker(() => now).runDigestSweep()
    await worker(() => now).runSweep()
    await worker(() => now).runSweep()

    expect(results.sort()).toEqual(['not_due', 'queued'])
    expect(sent).toHaveLength(1)
    expect(await db.query(`select last_sent_at is not null as sent, covered_until is not null as covered from public.member_message_digests where profile_id = $1`, [recipient]))
      .toEqual([{ sent: true, covered: true }])
  })
})

describe('one-click unsubscribe', () => {
  function oneClick(token: string) {
    return new Request(`https://seanshore.example/api/email/notifications/unsubscribe?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    })
  }

  it('turns off only the type the token names, for the member it names, without signing in', async () => {
    const recipient = await member()
    const bystander = await member()
    const response = await route.POST(oneClick(createNotificationEmailToken({ profileId: recipient, kind: 'comments', secret })))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const preferences = createNotificationEmailPreferences({ query: (text, values) => db.query(text, values) })
    expect(await preferences.get(recipient)).toEqual({ messages: true, connection_requests: true, comments: false, mentions: true })
    expect(await preferences.get(bystander)).toEqual({ messages: true, connection_requests: true, comments: true, mentions: true })

    // Idempotent, and the next comment is not emailed while mentions still are.
    expect((await route.POST(oneClick(createNotificationEmailToken({ profileId: recipient, kind: 'comments', secret })))).status).toBe(200)
    const actor = await member()
    await activity('comments', recipient, actor)
    await activity('mentions', recipient, actor)
    await worker().runSweep()
    expect(sent.map((email) => email.subject)).toEqual([`Placeholder Sailor ${sequence} mentioned you in a post`])
  })

  it('refuses forged and altered tokens and changes nothing', async () => {
    const recipient = await member()
    const forged = createNotificationEmailToken({ profileId: recipient, kind: 'messages', secret: 'another-test-secret-at-least-32-characters-x' })
    expect((await route.POST(oneClick(forged))).status).toBe(400)
    const real = createNotificationEmailToken({ profileId: recipient, kind: 'comments', secret })
    const [encoded, signature] = real.split('.')
    const payload = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8')) as Record<string, unknown>
    const altered = `${Buffer.from(JSON.stringify({ ...payload, k: 'messages' })).toString('base64url')}.${signature}`
    expect((await route.POST(oneClick(altered))).status).toBe(400)
    expect((await route.POST(oneClick('forged.token'))).status).toBe(400)
    expect(await db.query(`select 1 from public.member_preferences where profile_id = $1`, [recipient])).toEqual([])
  })

  it('opening the link (GET) only shows the confirmation page', async () => {
    const recipient = await member()
    const token = createNotificationEmailToken({ profileId: recipient, kind: 'mentions', secret })
    const response = await route.GET(new Request(`https://seanshore.example/api/email/notifications/unsubscribe?token=${encodeURIComponent(token)}`))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${process.env.NEXT_PUBLIC_SITE_URL}/email/notifications/unsubscribe?token=${encodeURIComponent(token)}`)
    expect(await db.query(`select 1 from public.member_preferences where profile_id = $1`, [recipient])).toEqual([])
  })

  it('every sent email carries a one-click link whose token works', async () => {
    const recipient = await member()
    const actor = await member()
    await activity('connection_requests', recipient, actor)
    await worker().runSweep()
    const header = sent[0]!.headers!.find((entry) => entry.Name === 'List-Unsubscribe')!.Value
    const url = header.slice(1, -1)
    expect(url.startsWith(`${siteUrl}/api/email/notifications/unsubscribe?token=`)).toBe(true)
    const token = new URL(url).searchParams.get('token')!
    expect((await route.POST(oneClick(token))).status).toBe(200)
    expect((await createNotificationEmailPreferences({ query: (text, values) => db.query(text, values) }).get(recipient)).connection_requests).toBe(false)
  })
})

describe('without the signing secret', () => {
  it('sends nothing (no email without a working unsubscribe link)', async () => {
    const recipient = await member()
    await activity('mentions', recipient, await member())
    const result = await createNotificationEmailWorker({
      repository: createNotificationEmailRepository({ query: (text, values) => db.query(text, values), transaction: db.transaction }),
      resend: { sendEmail: async (input) => { sent.push(input); return { messageId: 'placeholder' } } },
      tokenSecret: null,
    }).runSweep()
    expect(result.disabled).toBe('secret')
    expect(sent).toEqual([])
  })
})
