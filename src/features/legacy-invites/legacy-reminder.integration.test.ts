import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * The legacy second reminder against the real schema (PGlite): every eligibility rule and its exclusion count, one
 * reminder per person ever, the re-check at send time, the worker's email and one-click unsubscribe. Placeholder data.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { legacyReminderRepository } = await import('./reminder-repository')
const { createLegacyReminderWorker } = await import('./reminder-sending')
const { withEmailSuppression } = await import('@/lib/email/suppression')
const unsubscribeRoute = await import('@/app/api/email/legacy/unsubscribe/route')

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await db.query(`delete from public.legacy_profile_invite_reminders`)
  await db.query(`delete from public.legacy_profile_invites`)
  await db.query(`delete from public.email_suppressions`)
  await db.query(`delete from public.email_delivery_events`)
})

const ADMIN = { id: '' }
let sequence = 0

type Options = {
  name?: string
  status?: 'sent' | 'cancelled'
  daysAgo?: number
  delivered?: boolean
  event?: 'bounced' | 'complained' | 'suppressed'
  suppression?: 'hard_bounce' | 'complaint' | 'provider_suppressed' | 'unsubscribed'
  claimed?: boolean
  account?: { verified: boolean }
  newsletterUnsubscribed?: boolean
}

/** A first invitation sent `daysAgo` days ago, in the state the options describe. */
async function firstInvite(options: Options = {}) {
  sequence += 1
  const email = `fixture-legacy-${sequence}@example.test`
  const profileId = (await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`, [options.name ?? `Fixture Member ${sequence}`]))[0]!.id as string
  await db.query(
    `insert into public.legacy_profile_claims (source_system, legacy_object, legacy_id, profile_id, email, claimed_at)
     values ('beaufortmarine', 'user', $1, $2, $3, $4)`,
    [sequence, profileId, email, options.claimed ? new Date().toISOString() : null],
  )
  const sent = (options.status ?? 'sent') === 'sent'
  const messageId = `resend-${sequence}`
  const invite = (await db.query(
    `insert into public.legacy_profile_invites (profile_id, email, status, attempts, resend_message_id, sent_at, delivered_at)
     values ($1, $2, $3, 1, $4, case when $5 then now() - make_interval(days => $6) end, case when $7 then now() - make_interval(days => $6) end)
     returning id, claim_token::text`,
    [profileId, email, options.status ?? 'sent', sent ? messageId : null, sent, options.daysAgo ?? 7, options.delivered ?? true],
  ))[0]!
  if (options.event) {
    await db.query(
      `insert into public.email_delivery_events (provider_event_id, source, event_type, resend_email_id, recipient, occurred_at)
       values ($1, 'webhook', $2, $3, $4, now())`,
      [`msg-${sequence}`, options.event, messageId, email],
    )
  }
  if (options.suppression) {
    await db.query(`insert into public.email_suppressions (email, reason, source) values ($1, $2, 'resend_webhook')`, [email, options.suppression])
  }
  if (options.account) {
    const accountProfile = (await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Fixture Current') returning id`))[0]!.id
    await db.query(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, $4)`,
      [accountProfile, `fixture-sub-${sequence}`, email, options.account.verified],
    )
  }
  if (options.newsletterUnsubscribed) {
    await db.query(`insert into public.newsletter_subscribers (email, status, topics, source) values ($1, 'unsubscribed', '{}', 'footer')`, [email])
  }
  return { id: invite.id as string, profileId, email, claimToken: invite.claim_token as string }
}

async function reminderFor(inviteId: string) {
  return (await db.query(`select id, status, attempts, unsubscribe_token::text from public.legacy_profile_invite_reminders where invite_id = $1`, [inviteId]))[0]
}

describe('second reminder eligibility', () => {
  beforeAll(async () => {
    ADMIN.id = (await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Fixture Admin') returning id`))[0]!.id as string
  })

  it('counts each exclusion reason before preparing, and prepares only eligible people', async () => {
    const eligible = await firstInvite()
    await firstInvite({ status: 'cancelled' })
    await firstInvite({ daysAgo: 6 })
    await firstInvite({ event: 'bounced' })
    await firstInvite({ event: 'complained' })
    await firstInvite({ suppression: 'provider_suppressed' })
    await firstInvite({ delivered: false })
    await firstInvite({ claimed: true })
    await firstInvite({ account: { verified: true } })
    await firstInvite({ account: { verified: false } })
    await firstInvite({ suppression: 'unsubscribed' })
    await firstInvite({ newsletterUnsubscribed: true })

    await expect(legacyReminderRepository.breakdown()).resolves.toEqual({
      total: 12,
      eligible: 1,
      excluded: {
        first_not_sent: 1,
        already_reminded: 0,
        too_recent: 1,
        bounced_or_suppressed: 3,
        not_delivered: 1,
        claimed: 1,
        has_account: 2,
        opted_out: 2,
      },
    })

    await expect(legacyReminderRepository.prepareEligible(100, ADMIN.id)).resolves.toBe(1)
    expect(await db.query(`select invite_id, status from public.legacy_profile_invite_reminders`)).toEqual([{ invite_id: eligible.id, status: 'prepared' }])
    expect((await legacyReminderRepository.breakdown()).excluded.already_reminded).toBe(1)
  })

  it('treats exactly 7 days as eligible and a delivered event in the log as delivered', async () => {
    const atSeven = await firstInvite({ daysAgo: 7 })
    const fromLog = await firstInvite({ delivered: false })
    await db.query(
      `insert into public.email_delivery_events (source, event_type, resend_email_id, occurred_at)
       select 'backfill', 'delivered', resend_message_id, now() from public.legacy_profile_invites where id = $1`,
      [fromLog.id],
    )
    await expect(legacyReminderRepository.breakdown()).resolves.toMatchObject({ eligible: 2 })
    expect(atSeven.id).toBeTruthy()
  })

  it('sends at most one reminder per person, ever', async () => {
    const person = await firstInvite()
    await legacyReminderRepository.prepareEligible(10, ADMIN.id)
    await expect(legacyReminderRepository.prepareEligible(10, ADMIN.id)).resolves.toBe(0)

    // Cancelled before anything was attempted: it may be prepared again (same row, same unsubscribe token).
    const before = await reminderFor(person.id)
    await legacyReminderRepository.cancelPrepared()
    await expect(legacyReminderRepository.prepareEligible(10, ADMIN.id)).resolves.toBe(1)
    expect((await reminderFor(person.id))!.id).toBe(before!.id)

    // Once a send was attempted, even a stopped or failed reminder is never prepared again.
    await legacyReminderRepository.startPrepared()
    await legacyReminderRepository.claimBatch(5)
    await legacyReminderRepository.markFailed(before!.id, 'invalid_from: test', false)
    await expect(legacyReminderRepository.prepareEligible(10, ADMIN.id)).resolves.toBe(0)
    expect((await legacyReminderRepository.breakdown()).excluded.already_reminded).toBe(1)

    // The database refuses a second reminder for the same email even if a query tried.
    await expect(db.query(
      `insert into public.legacy_profile_invite_reminders (invite_id, profile_id, email) values ($1, $2, $3)`,
      [person.id, person.profileId, person.email.toUpperCase().toLowerCase()],
    )).rejects.toThrow()
  })

  it('re-checks every rule at send time and skips anyone who stopped being eligible', async () => {
    const stays = await firstInvite()
    const joins = await firstInvite()
    const complains = await firstInvite()
    await legacyReminderRepository.prepareEligible(10, ADMIN.id)
    await legacyReminderRepository.startPrepared()

    await db.query(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', 'fixture-late-sub', $2, false)`,
      [joins.profileId, joins.email],
    )
    await db.query(`insert into public.email_suppressions (email, reason, source) values ($1, 'complaint', 'resend_webhook')`, [complains.email])

    const deliveries = await legacyReminderRepository.claimBatch(5)
    expect(Object.fromEntries(deliveries.map((delivery) => [delivery.email, delivery.stillEligible]))).toEqual({
      [stays.email]: true,
      [joins.email]: false,
      [complains.email]: false,
    })
  })
})

describe('second reminder sending', () => {
  it('sends the reminder template from accounts@ with one-click unsubscribe headers, 5 per sweep, once each', async () => {
    const people = []
    for (let index = 0; index < 7; index += 1) people.push(await firstInvite({ name: 'Capt. Asha Rao' }))
    await legacyReminderRepository.prepareEligible(10, ADMIN.id)
    await legacyReminderRepository.startPrepared()

    let count = 0
    const resend = { sendEmail: vi.fn(async () => ({ messageId: `reminder-message-${++count}` })) }
    const worker = createLegacyReminderWorker({ resend, siteUrl: 'https://seanshore.in' })
    await expect(worker.runSweep(5)).resolves.toMatchObject({ claimed: 5, sent: 5 })
    await expect(worker.runSweep(5)).resolves.toMatchObject({ claimed: 2, sent: 2 })
    await expect(worker.runSweep(5)).resolves.toMatchObject({ claimed: 0 })
    expect(resend.sendEmail).toHaveBeenCalledTimes(7)

    const person = people[0]!
    const reminder = (await reminderFor(person.id))!
    expect(reminder.status).toBe('sent')
    const call = (resend.sendEmail.mock.calls as unknown as Array<[Record<string, unknown>]>).find(([input]) => input.to === person.email)![0]
    expect(call).toMatchObject({
      from: 'Sea N Shore <accounts@mail.seanshore.in>',
      subject: 'Reminder: your Sea N Shore profile is waiting',
      idempotencyKey: `legacy-profile-reminder/${reminder.id}`,
      tags: [{ name: 'category', value: 'legacy_profile_reminder' }],
      headers: [
        { Name: 'List-Unsubscribe', Value: `<https://seanshore.in/api/email/legacy/unsubscribe?token=${reminder.unsubscribe_token}>` },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      ],
    })
    expect(call.text).toContain('Hi Asha,')
    expect(call.text).toContain(`https://seanshore.in/auth/claim-profile?invite=${person.claimToken}`)
    expect(call.text).toContain(`sign in with ${person.email} or with Google`)
    expect(call.text).toContain(`Unsubscribe: https://seanshore.in/email/legacy/unsubscribe?token=${reminder.unsubscribe_token}`)
  })

  it('stops a sweep on a retryable Resend error and returns the untried reminders to the queue', async () => {
    await firstInvite()
    await firstInvite()
    await firstInvite()
    await legacyReminderRepository.prepareEligible(10, ADMIN.id)
    await legacyReminderRepository.startPrepared()
    const { ResendApiError } = await import('@/lib/email/resend')
    const resend = { sendEmail: vi.fn(async () => { throw new ResendApiError('rate_limit_exceeded', 429, 'slow down') }) }
    await expect(createLegacyReminderWorker({ resend }).runSweep(5)).resolves.toMatchObject({ claimed: 3, retrying: 1 })
    expect(await db.query(`select status, attempts from public.legacy_profile_invite_reminders order by status, attempts`)).toEqual([
      { status: 'queued', attempts: 0 },
      { status: 'queued', attempts: 0 },
      { status: 'queued', attempts: 1 },
    ])
  })

  it('never hands a do-not-email address to Resend, even when it was queued before the address was suppressed', async () => {
    const person = await firstInvite()
    await legacyReminderRepository.prepareEligible(10, ADMIN.id)
    await legacyReminderRepository.startPrepared()
    // Skip the send-time re-check to prove the sender guard on its own.
    const repository = { ...legacyReminderRepository, claimBatch: async (limit: number) => (await legacyReminderRepository.claimBatch(limit)).map((delivery) => ({ ...delivery, stillEligible: true })) }
    await db.query(`insert into public.email_suppressions (email, reason, source) values ($1, 'hard_bounce', 'resend_webhook')`, [person.email])
    const sendEmail = vi.fn(async () => ({ messageId: 'never' }))
    const worker = createLegacyReminderWorker({ repository, resend: withEmailSuppression({ sendEmail }) })
    await expect(worker.runSweep(5)).resolves.toMatchObject({ failed: 1, sent: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
    expect((await reminderFor(person.id))!.status).toBe('failed')
  })
})

describe('legacy reminder unsubscribe', () => {
  it('one-click POST marks the person do-not-email; GET only shows the confirmation page', async () => {
    const person = await firstInvite()
    await legacyReminderRepository.prepareEligible(10, ADMIN.id)
    const token = (await reminderFor(person.id))!.unsubscribe_token as string

    const get = await unsubscribeRoute.GET(new Request(`https://seanshore.in/api/email/legacy/unsubscribe?token=${token}`))
    expect(get.status).toBe(303)
    expect(get.headers.get('location')).toBe(`https://seanshore.in/email/legacy/unsubscribe?token=${token}`)
    expect(await db.query(`select 1 from public.email_suppressions`)).toHaveLength(0)

    const post = await unsubscribeRoute.POST(new Request(`https://seanshore.in/api/email/legacy/unsubscribe?token=${token}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' }))
    expect(post.status).toBe(200)
    expect(await db.query(`select email, reason, source from public.email_suppressions`)).toEqual([
      { email: person.email, reason: 'unsubscribed', source: 'legacy_reminder_unsubscribe' },
    ])
    // Repeating it is harmless.
    expect((await unsubscribeRoute.POST(new Request(`https://seanshore.in/api/email/legacy/unsubscribe?token=${token}`, { method: 'POST' }))).status).toBe(200)

    const sendEmail = vi.fn()
    await expect(withEmailSuppression({ sendEmail }).sendEmail({ to: person.email })).rejects.toMatchObject({ code: 'recipient_do_not_email' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses unknown or malformed tokens without changing anything', async () => {
    const unknown = await unsubscribeRoute.POST(new Request('https://seanshore.in/api/email/legacy/unsubscribe?token=33333333-3333-4333-8333-333333333333', { method: 'POST' }))
    expect(unknown.status).toBe(404)
    const malformed = await unsubscribeRoute.POST(new Request("https://seanshore.in/api/email/legacy/unsubscribe?token=' or 1=1 --", { method: 'POST' }))
    expect(malformed.status).toBe(404)
    await expect(legacyReminderRepository.isUnsubscribeToken('nope')).resolves.toBe(false)
    expect(await db.query(`select 1 from public.email_suppressions`)).toHaveLength(0)
  })
})
