import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * "Send test to me" for the second reminder, against the real schema (PGlite): the only recipient is the admin's own
 * verified sign-in email, a test never touches the reminder or invitation tables (so it is not a reminder and changes
 * no eligibility or queue), every request is audited, at most 5 an hour per admin, and neither its unsubscribe link
 * nor a bounce or complaint on it adds anyone to the do-not-email list. Placeholder data.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { createLegacyReminderTestSender, LEGACY_REMINDER_TESTS_PER_HOUR } = await import('./reminder-test')
const { legacyReminderRepository } = await import('./reminder-repository')
const { emailDeliveryRepository } = await import('@/features/email-delivery/repository')
const { parseResendWebhookEvent } = await import('@/features/email-delivery/events')
const testUnsubscribeRoute = await import('@/app/api/email/legacy/test-unsubscribe/route')

type SendInput = { to: string; subject: string; text: string; html: string; headers?: Array<{ Name: string; Value: string }>; idempotencyKey?: string; tags?: Array<{ name: string; value: string }> }

let sequence = 0

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await db.query(`delete from public.audit_events`)
  await db.query(`delete from public.legacy_profile_invite_reminders`)
  await db.query(`delete from public.legacy_profile_invites`)
  await db.query(`delete from public.email_suppressions`)
  await db.query(`delete from public.email_delivery_events`)
})

/** An admin profile with a Cognito identity whose email is verified (or not). */
async function admin(options: { verified?: boolean } = {}) {
  sequence += 1
  const email = `fixture-admin-${sequence}@example.test`
  const id = (await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Fixture Admin') returning id`))[0]!.id as string
  await db.query(
    `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, $4)`,
    [id, `fixture-admin-sub-${sequence}`, email, options.verified ?? true],
  )
  return { id, email }
}

/** A first invitation sent 8 days ago and delivered: eligible for the second reminder. */
async function eligibleInvite() {
  sequence += 1
  const email = `fixture-legacy-${sequence}@example.test`
  const profileId = (await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Fixture Member') returning id`))[0]!.id as string
  await db.query(
    `insert into public.legacy_profile_claims (source_system, legacy_object, legacy_id, profile_id, email) values ('beaufortmarine', 'user', $1, $2, $3)`,
    [sequence, profileId, email],
  )
  await db.query(
    `insert into public.legacy_profile_invites (profile_id, email, status, attempts, resend_message_id, sent_at, delivered_at)
     values ($1, $2, 'sent', 1, $3, now() - interval '8 days', now() - interval '8 days')`,
    [profileId, email, `resend-${sequence}`],
  )
  return { email }
}

function fakeResend() {
  let sent = 0
  const sendEmail = vi.fn<(input: SendInput) => Promise<{ messageId: string }>>(async () => ({ messageId: `resend-test-${(sent += 1)}` }))
  return { sendEmail }
}

function sender(resend = fakeResend()) {
  return { resend, tests: createLegacyReminderTestSender({ resend, siteUrl: 'https://seanshore.in' }) }
}

async function auditRows(actorId: string) {
  return db.query(`select action, target_type, metadata from public.audit_events where actor_id = $1 order by id`, [actorId])
}

async function snapshot() {
  return {
    invites: await db.query(`select * from public.legacy_profile_invites order by id`),
    reminders: await db.query(`select * from public.legacy_profile_invite_reminders order by id`),
    suppressions: await db.query(`select * from public.email_suppressions order by email`),
    breakdown: await legacyReminderRepository.breakdown(),
  }
}

describe('second reminder: send test to me', () => {
  it('sends the exact reminder, prefixed [TEST], with sample details, only to the admin\'s own verified email', async () => {
    const me = await admin()
    const { resend, tests } = sender()

    await expect(tests.send({ id: me.id, email: me.email.toUpperCase() })).resolves.toEqual({ status: 'sent', to: me.email })

    expect(resend.sendEmail).toHaveBeenCalledTimes(1)
    const call = resend.sendEmail.mock.calls[0]![0]
    expect(call.to).toBe(me.email)
    expect(call).toMatchObject({ from: 'Sea N Shore <accounts@mail.seanshore.in>', subject: '[TEST] Reminder: your Sea N Shore profile is waiting' })
    expect(call.tags).toEqual([{ name: 'category', value: 'legacy_profile_reminder_test' }])
    expect(call.idempotencyKey).toMatch(/^legacy-profile-reminder-test\/[0-9a-f-]{36}$/)
    expect(call.html).toContain('Hi Test,')
    expect(call.html).toContain('<strong>test.admin@example.com</strong>')
    expect(call.text).toContain('Reclaim my Sea N Shore profile: https://seanshore.in/email/legacy/test-link')
    expect(call.text).toContain('Unsubscribe: https://seanshore.in/email/legacy/test-link?link=unsubscribe')
    expect(`${call.html}\n${call.text}`).not.toMatch(/claim-profile|invite=|token=/)
    expect(call.headers).toEqual([
      { Name: 'List-Unsubscribe', Value: '<https://seanshore.in/api/email/legacy/test-unsubscribe>' },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ])
  })

  it('refuses when the admin\'s sign-in email is missing, unverified, or not the admin\'s own', async () => {
    const unverified = await admin({ verified: false })
    const someoneElse = await admin()
    const me = await admin()
    const { resend, tests } = sender()

    await expect(tests.send({ id: unverified.id, email: unverified.email })).resolves.toEqual({ status: 'no_verified_email' })
    await expect(tests.send({ id: me.id, email: null })).resolves.toEqual({ status: 'no_verified_email' })
    // Another person's verified address is never a recipient, even if it is passed in as the sign-in email.
    await expect(tests.send({ id: me.id, email: someoneElse.email })).resolves.toEqual({ status: 'no_verified_email' })

    expect(resend.sendEmail).not.toHaveBeenCalled()
    // Each refusal is in the audit log.
    expect((await auditRows(unverified.id)).map((row) => [row.action, row.metadata])).toEqual([['legacy_reminder.test_refused', { reason: 'no_verified_email' }]])
    expect((await auditRows(me.id)).map((row) => [row.action, row.metadata])).toEqual([
      ['legacy_reminder.test_refused', { reason: 'no_verified_email' }],
      ['legacy_reminder.test_refused', { reason: 'no_verified_email' }],
    ])
  })

  it('refuses, and audits the refusal, when sending is not configured', async () => {
    const me = await admin()
    const tests = createLegacyReminderTestSender({ loadApiKey: async () => null })
    await expect(tests.send(me)).resolves.toEqual({ status: 'unavailable' })
    expect((await auditRows(me.id)).map((row) => [row.action, row.metadata])).toEqual([['legacy_reminder.test_refused', { reason: 'unavailable' }]])
  })

  it('is not a reminder: it leaves invitations, reminders, the queue and eligibility exactly as they were', async () => {
    const me = await admin()
    await eligibleInvite()
    await eligibleInvite()
    await legacyReminderRepository.prepareEligible(10, me.id)
    await eligibleInvite()
    const before = await snapshot()
    expect(before.reminders).toHaveLength(2)
    expect(before.breakdown.eligible).toBe(1)

    const { tests } = sender()
    await expect(tests.send(me)).resolves.toMatchObject({ status: 'sent' })

    expect(await snapshot()).toEqual(before)
    await expect(legacyReminderRepository.metrics()).resolves.toMatchObject({ prepared: 2, queued: 0, sending: 0, sent: 0 })
  })

  it('records every request and its outcome in the audit log', async () => {
    const me = await admin()
    const resend = fakeResend()
    resend.sendEmail.mockResolvedValueOnce({ messageId: 'resend-ok' })
    resend.sendEmail.mockRejectedValueOnce(new Error('resend_down'))
    const { tests } = sender(resend)

    await expect(tests.send(me)).resolves.toEqual({ status: 'sent', to: me.email })
    await expect(tests.send(me)).resolves.toEqual({ status: 'failed', to: me.email })

    const rows = await auditRows(me.id)
    expect(rows.map((row) => row.action)).toEqual([
      'legacy_reminder.test_requested',
      'legacy_reminder.test_sent',
      'legacy_reminder.test_requested',
      'legacy_reminder.test_failed',
    ])
    expect(rows.every((row) => row.target_type === 'legacy_reminder_test')).toBe(true)
    expect(rows[1]!.metadata).toEqual({ to: me.email, resendEmailId: 'resend-ok' })
    expect(rows[3]!.metadata).toEqual({ to: me.email, error: 'resend_down' })
  })

  it('allows at most 5 tests per admin per hour, failed ones included, and does not send the 6th', async () => {
    const me = await admin()
    const other = await admin()
    const resend = fakeResend()
    resend.sendEmail.mockRejectedValueOnce(new Error('resend_down'))
    const { tests } = sender(resend)

    const results = []
    for (let index = 0; index < LEGACY_REMINDER_TESTS_PER_HOUR + 1; index += 1) results.push((await tests.send(me)).status)
    expect(results).toEqual(['failed', 'sent', 'sent', 'sent', 'sent', 'rate_limited'])
    expect(resend.sendEmail).toHaveBeenCalledTimes(5)
    expect((await auditRows(me.id)).at(-1)).toMatchObject({ action: 'legacy_reminder.test_refused', metadata: { reason: 'rate_limited' } })
    await expect(tests.send(me)).resolves.toEqual({ status: 'rate_limited' })

    // The limit is per admin.
    await expect(tests.send(other)).resolves.toMatchObject({ status: 'sent' })
    // Requests older than an hour no longer count, and the two recent refusals never did.
    await db.query(
      `update public.audit_events set created_at = now() - interval '61 minutes' where actor_id = $1 and action <> 'legacy_reminder.test_refused'`,
      [me.id],
    )
    await expect(tests.send(me)).resolves.toMatchObject({ status: 'sent' })
  })

  it('holds the limit when several requests arrive at once', async () => {
    const me = await admin()
    const { resend, tests } = sender()

    const results = await Promise.all(Array.from({ length: 8 }, () => tests.send(me)))

    expect(results.filter((result) => result.status === 'sent')).toHaveLength(5)
    expect(results.filter((result) => result.status === 'rate_limited')).toHaveLength(3)
    expect(resend.sendEmail).toHaveBeenCalledTimes(5)
  })

  it('has an unsubscribe that does nothing: one-click answers 200 and adds no one to do-not-email', async () => {
    const me = await admin()
    const { resend, tests } = sender()
    await tests.send(me)
    const target = resend.sendEmail.mock.calls[0]![0].headers![0]!.Value.slice(1, -1)

    const response = await testUnsubscribeRoute.POST()
    expect(target).toBe('https://seanshore.in/api/email/legacy/test-unsubscribe')
    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('This was a test email. Nothing was changed.')

    const opened = await testUnsubscribeRoute.GET(new Request(target))
    expect(opened.status).toBe(303)
    expect(opened.headers.get('location')).toBe('https://seanshore.in/email/legacy/test-link?link=unsubscribe')
    expect(await db.query(`select 1 from public.email_suppressions`)).toHaveLength(0)
  })

  it('never adds the recipient to do-not-email when the test bounces or is marked as spam', async () => {
    const me = await admin()
    for (const [index, type] of ['email.bounced', 'email.complained', 'email.suppressed'].entries()) {
      const event = parseResendWebhookEvent(JSON.stringify({
        type,
        created_at: '2026-10-11T10:00:00.000Z',
        data: { email_id: `resend-test-${index}`, to: [me.email], tags: { category: 'legacy_profile_reminder_test' }, bounce: { type: 'Permanent' } },
      }), `msg_test_${index}`)!
      await expect(emailDeliveryRepository.recordEvent(event)).resolves.toEqual({ status: 'recorded', suppressed: 0 })
    }

    expect(await db.query(`select event_type from public.email_delivery_events order by id`)).toEqual([
      { event_type: 'bounced' }, { event_type: 'complained' }, { event_type: 'suppressed' },
    ])
    expect(await db.query(`select 1 from public.email_suppressions`)).toHaveLength(0)
  })
})
