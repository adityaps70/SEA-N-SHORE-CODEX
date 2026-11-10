import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * The final legacy reminder against the real schema (PGlite): every eligibility rule and its exclusion count, one
 * final reminder per person ever, the last-legacy-email rule for the first two modes, the re-check at send time, the
 * auto-pause, the first-batch gate, click tracking, one-click unsubscribe and delivery events. Placeholder data.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { legacyFinalReminderRepository } = await import('./final-reminder-repository')
const { createLegacyFinalReminderWorker } = await import('./final-reminder-sending')
const { legacyReminderRepository } = await import('./reminder-repository')
const { legacyInviteRepository } = await import('./repository')
const { emailDeliveryRepository } = await import('@/features/email-delivery/repository')
const { parseResendWebhookEvent } = await import('@/features/email-delivery/events')
const { withEmailSuppression } = await import('@/lib/email/suppression')
const unsubscribeRoute = await import('@/app/api/email/legacy/unsubscribe/route')
const clickRoute = await import('@/app/api/email/legacy/final/claim/route')

const SITE = process.env.NEXT_PUBLIC_SITE_URL!
const NO_COUNTS = { read: async () => ({ openJobs: null, courses: null, upcomingEvents: null }) }

beforeAll(async () => {
  db = await createTestDatabase()
  ADMIN.id = (await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Fixture Admin') returning id`))[0]!.id as string
}, 120_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await db.query(`delete from public.legacy_profile_invite_final_reminders`)
  await db.query(`delete from public.legacy_profile_invite_reminders`)
  await db.query(`delete from public.legacy_profile_invites`)
  await db.query(`delete from public.legacy_profile_claims`)
  await db.query(`delete from public.email_suppressions`)
  await db.query(`delete from public.email_delivery_events`)
  await db.query(`delete from public.newsletter_subscribers`)
  await db.query(`delete from public.identity_accounts`)
  await db.query(`update public.legacy_final_reminder_controls set paused = false, paused_reason = null, paused_at = null, resumed_by = null, resumed_at = null where id = 1`)
})

const ADMIN = { id: '' }
let sequence = 0

type Options = {
  name?: string
  firstStatus?: 'sent' | 'cancelled'
  firstDelivered?: boolean
  reminder?: 'none' | 'queued' | 'sent'
  reminderDaysAgo?: number
  reminderDelivered?: boolean
  firstEvent?: 'bounced' | 'complained' | 'suppressed'
  reminderEvent?: 'bounced' | 'complained' | 'suppressed'
  suppression?: 'hard_bounce' | 'complaint' | 'provider_suppressed' | 'unsubscribed'
  claimed?: boolean
  account?: { verified: boolean }
  newsletterUnsubscribed?: boolean
  duplicate?: boolean
}

async function event(type: string, messageId: string, email: string) {
  await db.query(
    `insert into public.email_delivery_events (provider_event_id, source, event_type, resend_email_id, recipient, occurred_at)
     values ($1, 'webhook', $2, $3, $4, now())`,
    [`evt-${++sequence}`, type, messageId, email],
  )
}

/** A legacy member whose first invitation (30 days ago) and second reminder are in the state the options describe. */
async function person(options: Options = {}) {
  sequence += 1
  const n = sequence
  const email = `fixture-final-${n}@example.test`
  const profileId = (await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`, [options.name ?? `Fixture Member ${n}`]))[0]!.id as string
  await db.query(
    `insert into public.legacy_profile_claims (source_system, legacy_object, legacy_id, profile_id, email, claimed_at)
     values ('beaufortmarine', 'user', $1, $2, $3, $4)`,
    [n, profileId, email, options.claimed ? new Date().toISOString() : null],
  )
  const firstSent = (options.firstStatus ?? 'sent') === 'sent'
  const firstMessage = `first-${n}`
  const invite = (await db.query(
    `insert into public.legacy_profile_invites (profile_id, email, status, attempts, resend_message_id, sent_at, delivered_at)
     values ($1, $2, $3, 1, $4, case when $5 then now() - interval '30 days' end, case when $5 and $6 then now() - interval '30 days' end)
     returning id, claim_token::text`,
    [profileId, email, options.firstStatus ?? 'sent', firstSent ? firstMessage : null, firstSent, options.firstDelivered ?? true],
  ))[0]!
  const reminderMessage = `reminder-${n}`
  const reminderState = options.reminder ?? 'sent'
  let reminderId: string | null = null
  if (reminderState !== 'none') {
    const sent = reminderState === 'sent'
    reminderId = (await db.query(
      `insert into public.legacy_profile_invite_reminders (invite_id, profile_id, email, status, attempts, resend_message_id, sent_at)
       values ($1, $2, $3, $4, $5, $6, case when $7 then now() - make_interval(days => $8) end)
       returning id`,
      [invite.id, profileId, email, reminderState, sent ? 1 : 0, sent ? reminderMessage : null, sent, options.reminderDaysAgo ?? 14],
    ))[0]!.id as string
    if (sent && (options.reminderDelivered ?? true)) await event('delivered', reminderMessage, email)
  }
  if (options.firstEvent) await event(options.firstEvent, firstMessage, email)
  if (options.reminderEvent) await event(options.reminderEvent, reminderMessage, email)
  if (options.suppression) {
    await db.query(`insert into public.email_suppressions (email, reason, source) values ($1, $2, 'resend_webhook')`, [email, options.suppression])
  }
  if (options.account) {
    const accountProfile = (await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Fixture Current') returning id`))[0]!.id
    await db.query(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, $4)`,
      [accountProfile, `fixture-final-sub-${n}`, email, options.account.verified],
    )
  }
  if (options.newsletterUnsubscribed) {
    await db.query(`insert into public.newsletter_subscribers (email, status, topics, source) values ($1, 'unsubscribed', '{}', 'footer')`, [email])
  }
  if (options.duplicate) {
    const other = (await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Fixture Twin') returning id`))[0]!.id
    await db.query(
      `insert into public.legacy_profile_claims (source_system, legacy_object, legacy_id, profile_id, email) values ('beaufortmarine', 'user', $1, $2, $3)`,
      [100_000 + n, other, email],
    )
  }
  return { inviteId: invite.id as string, reminderId, profileId, email, claimToken: invite.claim_token as string, name: options.name ?? `Fixture Member ${n}` }
}

async function finalFor(inviteId: string) {
  return (await db.query(
    `select id, status, attempts, unsubscribe_token::text, click_token::text, resend_message_id, first_clicked_at, click_count, last_event, delivered_at
     from public.legacy_profile_invite_final_reminders where invite_id = $1`,
    [inviteId],
  ))[0]
}

async function controlsRow() {
  return (await db.query(`select paused, paused_reason, paused_at, resumed_by, resumed_at from public.legacy_final_reminder_controls where id = 1`))[0]!
}

/** Prepares, starts and sends every eligible person through the worker with a fake Resend. */
async function sendAll(limit = 100) {
  await legacyFinalReminderRepository.prepareEligible(limit, ADMIN.id)
  await legacyFinalReminderRepository.startPrepared()
  let count = 0
  const resend = { sendEmail: vi.fn(async () => ({ messageId: `final-message-${++count}-${sequence}` })) }
  const worker = createLegacyFinalReminderWorker({ resend, liveCounts: NO_COUNTS, log: () => {} })
  for (let sweep = 0; sweep < 30; sweep += 1) if ((await worker.runSweep(5)).claimed === 0) break
  return resend
}

describe('final reminder eligibility', () => {
  it('counts each exclusion reason before preparing (the rows add up), and prepares only eligible people', async () => {
    const eligible = await person()
    await person({ firstStatus: 'cancelled', reminder: 'none' })
    await person({ reminder: 'none' })
    await person({ reminder: 'queued' })
    await person({ reminderDaysAgo: 13 })
    await person({ firstEvent: 'bounced' })
    await person({ reminderEvent: 'complained' })
    await person({ suppression: 'hard_bounce' })
    await person({ firstDelivered: false })
    await person({ reminderDelivered: false })
    await person({ claimed: true })
    await person({ account: { verified: true } })
    await person({ account: { verified: false } })
    await person({ suppression: 'unsubscribed' })
    await person({ newsletterUnsubscribed: true })
    await person({ duplicate: true })

    const breakdown = await legacyFinalReminderRepository.breakdown()
    expect(breakdown).toEqual({
      total: 16,
      eligible: 1,
      excluded: {
        first_not_sent: 1,
        reminder_not_sent: 2,
        already_final: 0,
        too_recent: 1,
        bounced_or_suppressed: 3,
        not_delivered: 2,
        claimed: 1,
        has_account: 2,
        opted_out: 2,
        duplicate_email: 1,
      },
    })
    expect(breakdown.eligible + Object.values(breakdown.excluded).reduce((sum, count) => sum + count, 0)).toBe(breakdown.total)

    await expect(legacyFinalReminderRepository.prepareEligible(100, ADMIN.id)).resolves.toMatchObject({ status: 'prepared', prepared: 1 })
    expect(await db.query(`select invite_id, status from public.legacy_profile_invite_final_reminders`)).toEqual([{ invite_id: eligible.inviteId, status: 'prepared' }])
    const after = await legacyFinalReminderRepository.breakdown()
    expect(after).toMatchObject({ total: 16, eligible: 0 })
    expect(after.excluded.already_final).toBe(1)
  })

  it('treats a second reminder sent exactly 14 days ago as eligible, and a first invitation delivered by event as delivered', async () => {
    await person({ reminderDaysAgo: 14 })
    const fromLog = await person({ firstDelivered: false })
    await event('delivered', `first-${fromLog.email.match(/(\d+)@/)![1]}`, fromLog.email)
    await expect(legacyFinalReminderRepository.breakdown()).resolves.toMatchObject({ eligible: 2 })
  })

  it('makes a second final reminder to the same person impossible, at prepare time and in the database', async () => {
    const someone = await person()
    await legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)
    await expect(legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)).resolves.toMatchObject({ prepared: 0 })

    // Cancelled before anything was attempted: it may be prepared again (same row, same tokens).
    const before = (await finalFor(someone.inviteId))!
    await legacyFinalReminderRepository.cancelPrepared()
    await expect(legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)).resolves.toMatchObject({ prepared: 1 })
    expect((await finalFor(someone.inviteId))!).toMatchObject({ id: before.id, click_token: before.click_token, unsubscribe_token: before.unsubscribe_token })

    // Once a send was attempted, even a failed or stopped one is never prepared again.
    await legacyFinalReminderRepository.startPrepared()
    await legacyFinalReminderRepository.claimBatch(5)
    await legacyFinalReminderRepository.markFailed(before.id as string, 'invalid_from: test', false)
    await expect(legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)).resolves.toMatchObject({ prepared: 0 })
    expect((await legacyFinalReminderRepository.breakdown()).excluded.already_final).toBe(1)

    // The database refuses another row for the same invitation, the same second reminder, or the same email in any case.
    const other = await person({ reminder: 'none' })
    const otherReminder = (await db.query(
      `insert into public.legacy_profile_invite_reminders (invite_id, profile_id, email) values ($1, $2, $3) returning id`,
      [other.inviteId, other.profileId, other.email],
    ))[0]!.id
    const insert = (inviteId: string, reminderId: string, email: string) => db.query(
      `insert into public.legacy_profile_invite_final_reminders (invite_id, reminder_id, profile_id, email) values ($1, $2, $3, $4)`,
      [inviteId, reminderId, someone.profileId, email],
    )
    await expect(insert(someone.inviteId, otherReminder as string, other.email)).rejects.toThrow()
    await expect(insert(other.inviteId, someone.reminderId!, other.email)).rejects.toThrow()
    await expect(insert(other.inviteId, otherReminder as string, someone.email)).rejects.toThrow()
    await expect(insert(other.inviteId, otherReminder as string, someone.email.toUpperCase())).rejects.toThrow()
    await expect(insert(other.inviteId, otherReminder as string, other.email)).resolves.toBeDefined()
  })

  it('re-checks every rule at send time and skips anyone who stopped being eligible', async () => {
    const stays = await person()
    const joins = await person()
    const complains = await person()
    const unsubscribes = await person()
    await legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)
    await legacyFinalReminderRepository.startPrepared()

    await db.query(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', 'fixture-final-late', $2, false)`,
      [joins.profileId, joins.email],
    )
    await event('complained', `reminder-${complains.email.match(/(\d+)@/)![1]}`, complains.email)
    await db.query(`insert into public.newsletter_subscribers (email, status, topics, source) values ($1, 'unsubscribed', '{}', 'footer')`, [unsubscribes.email])

    const deliveries = await legacyFinalReminderRepository.claimBatch(5)
    expect(Object.fromEntries(deliveries.map((delivery) => [delivery.email, delivery.stillEligible]))).toEqual({
      [stays.email]: true,
      [joins.email]: false,
      [complains.email]: false,
      [unsubscribes.email]: false,
    })
  })
})

describe('after a final reminder, no more legacy emails to that address', () => {
  it('the first invitation neither prepares nor sends to an address with a final reminder', async () => {
    // A cancelled first invitation leaves the address open to the first-invitation mode, until a final reminder exists.
    const someone = await person({ firstStatus: 'cancelled', reminder: 'none' })
    await expect(legacyInviteRepository.metrics()).resolves.toMatchObject({ eligible: 1 })
    const reminder = (await db.query(
      `insert into public.legacy_profile_invite_reminders (invite_id, profile_id, email, status) values ($1, $2, $3, 'cancelled') returning id`,
      [someone.inviteId, someone.profileId, someone.email],
    ))[0]!.id
    await db.query(
      `insert into public.legacy_profile_invite_final_reminders (invite_id, reminder_id, profile_id, email, status, attempts) values ($1, $2, $3, $4, 'sent', 1)`,
      [someone.inviteId, reminder, someone.profileId, someone.email],
    )
    await expect(legacyInviteRepository.metrics()).resolves.toMatchObject({ eligible: 0 })
    await expect(legacyInviteRepository.prepareEligible(100, ADMIN.id)).resolves.toBe(0)

    // Send time: an invitation already queued for that address is skipped.
    await db.query(`update public.legacy_profile_invites set status = 'queued', attempts = 0, next_attempt_at = now() where id = $1`, [someone.inviteId])
    const deliveries = await legacyInviteRepository.claimBatch(5)
    expect(deliveries.map((delivery) => delivery.stillEligible)).toEqual([false])
  })

  it('a cancelled-before-sending final reminder does not count', async () => {
    const someone = await person({ firstStatus: 'cancelled', reminder: 'none' })
    const reminder = (await db.query(
      `insert into public.legacy_profile_invite_reminders (invite_id, profile_id, email, status) values ($1, $2, $3, 'cancelled') returning id`,
      [someone.inviteId, someone.profileId, someone.email],
    ))[0]!.id
    await db.query(
      `insert into public.legacy_profile_invite_final_reminders (invite_id, reminder_id, profile_id, email, status, attempts) values ($1, $2, $3, $4, 'cancelled', 0)`,
      [someone.inviteId, reminder, someone.profileId, someone.email],
    )
    await expect(legacyInviteRepository.metrics()).resolves.toMatchObject({ eligible: 1 })
  })

  it('the second reminder neither prepares nor sends to an address with a final reminder', async () => {
    const someone = await person({ reminder: 'none' })
    await expect(legacyReminderRepository.breakdown()).resolves.toMatchObject({ eligible: 1 })
    await legacyReminderRepository.prepareEligible(10, ADMIN.id)
    await legacyReminderRepository.startPrepared()
    const reminder = (await db.query(`select id from public.legacy_profile_invite_reminders where invite_id = $1`, [someone.inviteId]))[0]!.id
    await db.query(
      `insert into public.legacy_profile_invite_final_reminders (invite_id, reminder_id, profile_id, email, status) values ($1, $2, $3, $4, 'prepared')`,
      [someone.inviteId, reminder, someone.profileId, someone.email],
    )
    const deliveries = await legacyReminderRepository.claimBatch(5)
    expect(deliveries.map((delivery) => delivery.stillEligible)).toEqual([false])
    const breakdown = await legacyReminderRepository.breakdown()
    expect(breakdown.eligible).toBe(0)
    expect(breakdown.excluded.already_reminded).toBe(1)
  })
})

describe('final reminder sending', () => {
  it('sends the final template from accounts@ through the click redirect, with one-click unsubscribe, 5 per sweep, once each, logging counts only', async () => {
    const people = []
    for (let index = 0; index < 7; index += 1) people.push(await person({ name: 'Capt. Asha Rao' }))
    await legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)
    await legacyFinalReminderRepository.startPrepared()

    let count = 0
    const resend = { sendEmail: vi.fn(async () => ({ messageId: `final-message-${++count}` })) }
    const log = vi.fn()
    const counts = { read: vi.fn(async () => ({ openJobs: 42, courses: null, upcomingEvents: 3 })) }
    const worker = createLegacyFinalReminderWorker({ resend, liveCounts: counts, siteUrl: 'https://seanshore.in', log })
    await expect(worker.runSweep(5)).resolves.toMatchObject({ claimed: 5, sent: 5, paused: false })
    await expect(worker.runSweep(25)).resolves.toMatchObject({ claimed: 2, sent: 2 })
    await expect(worker.runSweep(5)).resolves.toMatchObject({ claimed: 0 })
    expect(resend.sendEmail).toHaveBeenCalledTimes(7)

    const someone = people[0]!
    const final = (await finalFor(someone.inviteId))!
    expect(final.status).toBe('sent')
    const call = (resend.sendEmail.mock.calls as unknown as Array<[Record<string, unknown>]>).find(([input]) => input.to === someone.email)![0]
    expect(call).toMatchObject({
      from: 'Sea N Shore <accounts@mail.seanshore.in>',
      subject: 'Last reminder: your Sea N Shore profile is still waiting',
      idempotencyKey: `legacy-profile-final-reminder/${final.id}`,
      tags: [{ name: 'category', value: 'legacy_profile_final_reminder' }],
      headers: [
        { Name: 'List-Unsubscribe', Value: `<https://seanshore.in/api/email/legacy/unsubscribe?token=${final.unsubscribe_token}>` },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      ],
    })
    expect(call.text).toContain('Hi Asha,')
    expect(call.text).toContain(`Reclaim my Sea N Shore profile: https://seanshore.in/api/email/legacy/final/claim?t=${final.click_token}`)
    expect(call.text).toContain('Verified jobs: 42 open right now')
    expect(call.text).toContain('- Courses and certificates to grow your career')
    expect(call.text).not.toContain(someone.claimToken)
    expect(call.text).toContain(`Don't email me about this again: https://seanshore.in/email/legacy/unsubscribe?token=${final.unsubscribe_token}`)

    // Counts only in the logs: never an address, a name or a token.
    const logged = JSON.stringify(log.mock.calls)
    expect(log).toHaveBeenCalledWith('[legacy_final_reminder_sweep]', { claimed: 5, sent: 5, failed: 0, skipped: 0, retrying: 0 })
    for (const secret of [someone.email, 'Asha', 'Rao', final.unsubscribe_token, final.click_token]) expect(logged).not.toContain(secret)
    for (const [, details] of log.mock.calls) for (const value of Object.values(details as Record<string, unknown>)) expect(['number', 'boolean']).toContain(typeof value)
  })

  it('stops a sweep on a retryable Resend error and returns the untried final reminders to the queue', async () => {
    await person()
    await person()
    await person()
    await legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)
    await legacyFinalReminderRepository.startPrepared()
    const { ResendApiError } = await import('@/lib/email/resend')
    const resend = { sendEmail: vi.fn(async () => { throw new ResendApiError('rate_limit_exceeded', 429, 'slow down') }) }
    await expect(createLegacyFinalReminderWorker({ resend, liveCounts: NO_COUNTS, log: () => {} }).runSweep(5)).resolves.toMatchObject({ claimed: 3, retrying: 1 })
    expect(await db.query(`select status, attempts from public.legacy_profile_invite_final_reminders order by status, attempts`)).toEqual([
      { status: 'queued', attempts: 0 },
      { status: 'queued', attempts: 0 },
      { status: 'queued', attempts: 1 },
    ])
  })

  it('never hands a do-not-email address to Resend, even when it was queued before the address was suppressed', async () => {
    const someone = await person()
    await legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)
    await legacyFinalReminderRepository.startPrepared()
    const repository = {
      ...legacyFinalReminderRepository,
      claimBatch: async (limit: number) => (await legacyFinalReminderRepository.claimBatch(limit)).map((delivery) => ({ ...delivery, stillEligible: true })),
    }
    await db.query(`insert into public.email_suppressions (email, reason, source) values ($1, 'hard_bounce', 'resend_webhook')`, [someone.email])
    const sendEmail = vi.fn(async () => ({ messageId: 'never' }))
    const worker = createLegacyFinalReminderWorker({ repository, resend: withEmailSuppression({ sendEmail }), liveCounts: NO_COUNTS, log: () => {} })
    await expect(worker.runSweep(5)).resolves.toMatchObject({ failed: 1, sent: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('records delivery events on final reminders and puts bounces and complaints on the do-not-email list', async () => {
    const delivered = await person()
    const bounced = await person()
    await sendAll()
    const deliveredFinal = (await finalFor(delivered.inviteId))!
    const bouncedFinal = (await finalFor(bounced.inviteId))!

    const webhook = (type: string, emailId: string, to: string) => parseResendWebhookEvent(JSON.stringify({
      type: `email.${type}`,
      created_at: new Date().toISOString(),
      data: { email_id: emailId, to: [to], tags: { category: 'legacy_profile_final_reminder' } },
    }), `msg_${Math.random()}`)!
    await emailDeliveryRepository.recordEvent(webhook('delivered', deliveredFinal.resend_message_id as string, delivered.email))
    await emailDeliveryRepository.recordEvent(webhook('bounced', bouncedFinal.resend_message_id as string, bounced.email))

    expect((await finalFor(delivered.inviteId))!).toMatchObject({ last_event: 'delivered' })
    expect((await finalFor(delivered.inviteId))!.delivered_at).not.toBeNull()
    expect((await finalFor(bounced.inviteId))!).toMatchObject({ last_event: 'bounced', delivered_at: null })
    expect(await db.query(`select email, reason from public.email_suppressions`)).toEqual([{ email: bounced.email, reason: 'hard_bounce' }])
    await expect(legacyFinalReminderRepository.firstBatch()).resolves.toMatchObject({ size: 2, finished: 2, delivered: 1, bounced: 1, complained: 0 })
  })
})

describe('auto-pause', () => {
  /** `count` final reminders already sent, each with its own invitation, second reminder and message id. */
  async function bulkSent(count: number) {
    await db.query(`
      do $$
      declare pid uuid; iid uuid; rid uuid;
      begin
        for i in 1..${count} loop
          insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Fixture Bulk') returning id into pid;
          insert into public.legacy_profile_invites (profile_id, email, status, attempts, resend_message_id, sent_at, delivered_at)
            values (pid, 'fixture-bulk-' || i || '@example.test', 'sent', 1, 'bulk-first-' || i, now() - interval '30 days', now() - interval '30 days')
            returning id into iid;
          insert into public.legacy_profile_invite_reminders (invite_id, profile_id, email, status, attempts, resend_message_id, sent_at)
            values (iid, pid, 'fixture-bulk-' || i || '@example.test', 'sent', 1, 'bulk-reminder-' || i, now() - interval '15 days')
            returning id into rid;
          insert into public.legacy_profile_invite_final_reminders (invite_id, reminder_id, profile_id, email, status, attempts, resend_message_id, sent_at)
            values (iid, rid, pid, 'fixture-bulk-' || i || '@example.test', 'sent', 1, 'bulk-final-' || i, now() - interval '2 days');
        end loop;
      end
      $$;
    `)
  }

  async function bulkEvents(type: 'bounced' | 'complained', from: number, to: number) {
    await db.query(
      `insert into public.email_delivery_events (provider_event_id, source, event_type, resend_email_id, occurred_at)
       select 'bulk-' || $1 || '-' || i, 'webhook', $1, 'bulk-final-' || i, now() from generate_series($2::int, $3::int) i`,
      [type, from, to],
    )
  }

  it('pauses just above 0.1% complaints, not at it', async () => {
    await bulkSent(1000)
    await bulkEvents('complained', 1, 1)
    await expect(legacyFinalReminderRepository.rates()).resolves.toMatchObject({ sent: 1000, complained: 1, complaintRate: 0.001 })
    await expect(legacyFinalReminderRepository.autoPauseIfNeeded()).resolves.toEqual({ paused: false, pausedNow: false })
    await bulkEvents('complained', 2, 2)
    await expect(legacyFinalReminderRepository.autoPauseIfNeeded()).resolves.toEqual({ paused: true, pausedNow: true })
    expect(await controlsRow()).toMatchObject({ paused: true, paused_reason: 'Complaint rate 0.20% is above 0.1% (2 of 1000 sent)' })
    expect((await controlsRow()).paused_at).not.toBeNull()
  })

  it('pauses just above 3% bounces, not at it', async () => {
    await bulkSent(1000)
    await bulkEvents('bounced', 1, 30)
    await expect(legacyFinalReminderRepository.autoPauseIfNeeded()).resolves.toMatchObject({ paused: false })
    await bulkEvents('bounced', 31, 31)
    await expect(legacyFinalReminderRepository.autoPauseIfNeeded()).resolves.toMatchObject({ paused: true })
    expect((await controlsRow()).paused_reason).toBe('Bounce rate 3.10% is above 3% (31 of 1000 sent)')
  })

  it('a paused mode claims, prepares and starts nothing; Resume records who and when; old events do not pause it again', async () => {
    const first = await person()
    await sendAll()
    const sent = (await finalFor(first.inviteId))!
    await event('complained', sent.resend_message_id as string, first.email)
    const waiting = await person()
    await legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)
    await legacyFinalReminderRepository.startPrepared()
    const third = await person()

    const resend = { sendEmail: vi.fn(async () => ({ messageId: 'final-after-resume' })) }
    const log = vi.fn()
    const worker = createLegacyFinalReminderWorker({ resend, liveCounts: NO_COUNTS, log })
    await expect(worker.runSweep(5)).resolves.toMatchObject({ claimed: 0, paused: true })
    expect(log).toHaveBeenCalledWith('[legacy_final_reminder_auto_paused]', { paused: true })
    expect(resend.sendEmail).not.toHaveBeenCalled()
    await expect(legacyFinalReminderRepository.claimBatch(5)).resolves.toEqual([])
    await expect(legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)).resolves.toEqual({ status: 'paused' })
    await expect(legacyFinalReminderRepository.startPrepared()).resolves.toEqual({ status: 'paused' })
    expect((await finalFor(waiting.inviteId))!.status).toBe('queued')
    expect(await finalFor(third.inviteId)).toBeUndefined()
    await expect(legacyFinalReminderRepository.controls()).resolves.toMatchObject({ paused: true, pausedReason: expect.stringContaining('Complaint rate') })

    await expect(legacyFinalReminderRepository.resume(ADMIN.id)).resolves.toBe(true)
    expect(await controlsRow()).toMatchObject({ paused: false, resumed_by: ADMIN.id })
    expect((await controlsRow()).resumed_at).not.toBeNull()
    await expect(legacyFinalReminderRepository.controls()).resolves.toMatchObject({ paused: false, resumedByName: 'Fixture Admin' })

    // The complaint from before the resume does not pause it again; the queued one is sent.
    await expect(worker.runSweep(5)).resolves.toMatchObject({ claimed: 1, sent: 1, paused: false })

    // A new complaint after the resume, with the rate still too high, pauses it again.
    await event('complained', (await finalFor(waiting.inviteId))!.resend_message_id as string, waiting.email)
    await expect(worker.runSweep(5)).resolves.toMatchObject({ paused: true })
    expect((await controlsRow()).paused).toBe(true)
  })
})

describe('first batch gate', () => {
  it('allows only the first 100 until they have all finished and 24 hours have passed since the last send', async () => {
    for (let index = 0; index < 103; index += 1) await person()
    await expect(legacyFinalReminderRepository.prepareEligible(50, ADMIN.id)).resolves.toMatchObject({ status: 'prepared', prepared: 50, limitedByFirstBatch: false })
    await expect(legacyFinalReminderRepository.prepareEligible(100, ADMIN.id)).resolves.toMatchObject({ status: 'prepared', prepared: 50, limitedByFirstBatch: true })
    await expect(legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)).resolves.toEqual({ status: 'first_batch_gate', opensAt: null })
    await expect(legacyFinalReminderRepository.firstBatch()).resolves.toMatchObject({ size: 100, finished: 0, open: false, opensAt: null })

    // All sent just now: still closed, and the page can say when it opens.
    await db.query(`update public.legacy_profile_invite_final_reminders set status = 'sent', attempts = 1, resend_message_id = 'gate-' || id::text, sent_at = now() - interval '23 hours'`)
    const waiting = await legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)
    expect(waiting).toMatchObject({ status: 'first_batch_gate' })
    const opensAt = new Date((waiting as { opensAt: string }).opensAt).getTime()
    expect(opensAt - Date.now()).toBeGreaterThan(50 * 60_000)
    expect(opensAt - Date.now()).toBeLessThan(61 * 60_000)

    // One click is counted in the batch.
    const clickToken = (await db.query(`select click_token::text from public.legacy_profile_invite_final_reminders limit 1`))[0]!.click_token
    await legacyFinalReminderRepository.recordClick(clickToken as string)
    await expect(legacyFinalReminderRepository.firstBatch()).resolves.toMatchObject({ size: 100, finished: 100, clicked: 1, open: false })

    await db.query(`update public.legacy_profile_invite_final_reminders set sent_at = now() - interval '25 hours'`)
    await expect(legacyFinalReminderRepository.firstBatch()).resolves.toMatchObject({ open: true, opensAt: null })
    await expect(legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)).resolves.toMatchObject({ status: 'prepared', prepared: 3 })
  })

  it('keeps the gate closed while any of the first 100 is not finished', async () => {
    for (let index = 0; index < 101; index += 1) await person()
    await legacyFinalReminderRepository.prepareEligible(100, ADMIN.id)
    await db.query(`update public.legacy_profile_invite_final_reminders set status = 'sent', attempts = 1, sent_at = now() - interval '3 days'`)
    await db.query(`update public.legacy_profile_invite_final_reminders set status = 'queued' where id = (select id from public.legacy_profile_invite_final_reminders order by created_at, id limit 1)`)
    await expect(legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)).resolves.toEqual({ status: 'first_batch_gate', opensAt: null })
  })
})

describe('final reminder click tracking', () => {
  it('records the first click and every click, then redirects to the same claim link as the first invitation', async () => {
    const someone = await person()
    await sendAll()
    const final = (await finalFor(someone.inviteId))!

    const response = await clickRoute.GET(new Request(`http://10.0.1.23:3000/api/email/legacy/final/claim?t=${final.click_token}`))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${SITE}/auth/claim-profile?invite=${someone.claimToken}`)
    const clicked = (await finalFor(someone.inviteId))!
    expect(clicked.click_count).toBe(1)
    expect(clicked.first_clicked_at).not.toBeNull()

    await clickRoute.GET(new Request(`https://seanshore.in/api/email/legacy/final/claim?t=${final.click_token}`))
    const again = (await finalFor(someone.inviteId))!
    expect(again.click_count).toBe(2)
    expect(again.first_clicked_at).toEqual(clicked.first_clicked_at)
  })

  it('sends an unknown or malformed token to the claim page without changing anything or saying why', async () => {
    const someone = await person()
    await sendAll()
    for (const token of ['44444444-4444-4444-8444-444444444444', "' or 1=1 --", '']) {
      const response = await clickRoute.GET(new Request(`https://seanshore.in/api/email/legacy/final/claim?t=${encodeURIComponent(token)}`))
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe(`${SITE}/auth/claim-profile`)
      expect(await response.text()).toBe('')
    }
    expect((await finalFor(someone.inviteId))!).toMatchObject({ click_count: 0, first_clicked_at: null })
  })

  it('counts a claim only within 30 days after that person first clicked', async () => {
    const soon = await person()
    const late = await person()
    const neverClicked = await person()
    await sendAll()
    for (const someone of [soon, late]) await clickRoute.GET(new Request(`https://seanshore.in/api/email/legacy/final/claim?t=${(await finalFor(someone.inviteId))!.click_token}`))
    await expect(legacyFinalReminderRepository.claimsFromClicks()).resolves.toBe(0)
    await db.query(`update public.legacy_profile_claims set claimed_at = now() + interval '2 days' where email = $1`, [soon.email])
    await db.query(`update public.legacy_profile_claims set claimed_at = now() + interval '31 days' where email = $1`, [late.email])
    await db.query(`update public.legacy_profile_claims set claimed_at = now() where email = $1`, [neverClicked.email])
    await expect(legacyFinalReminderRepository.claimsFromClicks()).resolves.toBe(1)
  })
})

describe('final reminder unsubscribe', () => {
  it('the one-click link and header of a final reminder put the address on the do-not-email list', async () => {
    const someone = await person()
    const resend = await sendAll()
    const final = (await finalFor(someone.inviteId))!
    const token = final.unsubscribe_token as string
    const call = (resend.sendEmail.mock.calls as unknown as Array<[{ headers: Array<{ Name: string; Value: string }>; text: string }]>)[0]![0]
    const header = call.headers.find((item) => item.Name === 'List-Unsubscribe')!.Value
    const oneClick = header.slice(1, -1)
    expect(oneClick).toBe(`${SITE}/api/email/legacy/unsubscribe?token=${token}`)
    expect(call.text).toContain(`Don't email me about this again: ${SITE}/email/legacy/unsubscribe?token=${token}`)

    await expect(legacyReminderRepository.isUnsubscribeToken(token)).resolves.toBe(true)
    const get = await unsubscribeRoute.GET(new Request(oneClick))
    expect(get.status).toBe(303)
    expect(get.headers.get('location')).toBe(`${SITE}/email/legacy/unsubscribe?token=${token}`)
    expect(await db.query(`select 1 from public.email_suppressions`)).toHaveLength(0)

    const post = await unsubscribeRoute.POST(new Request(oneClick, { method: 'POST', body: 'List-Unsubscribe=One-Click' }))
    expect(post.status).toBe(200)
    expect(await db.query(`select email, reason, source from public.email_suppressions`)).toEqual([
      { email: someone.email, reason: 'unsubscribed', source: 'legacy_reminder_unsubscribe' },
    ])
    expect((await unsubscribeRoute.POST(new Request(oneClick, { method: 'POST' }))).status).toBe(200)

    const sendEmail = vi.fn()
    await expect(withEmailSuppression({ sendEmail }).sendEmail({ to: someone.email })).rejects.toMatchObject({ code: 'recipient_do_not_email' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('the unsubscribe page button accepts a final reminder token too', async () => {
    const someone = await person()
    await legacyFinalReminderRepository.prepareEligible(10, ADMIN.id)
    const token = (await finalFor(someone.inviteId))!.unsubscribe_token as string
    const { unsubscribeFromLegacyReminder } = await import('./unsubscribe-actions')
    await expect(unsubscribeFromLegacyReminder(token)).resolves.toEqual({ ok: true })
    expect(await db.query(`select email, reason from public.email_suppressions`)).toEqual([{ email: someone.email, reason: 'unsubscribed' }])
    await expect(unsubscribeFromLegacyReminder('55555555-5555-4555-8555-555555555555')).resolves.toEqual({ ok: false })
  })
})
