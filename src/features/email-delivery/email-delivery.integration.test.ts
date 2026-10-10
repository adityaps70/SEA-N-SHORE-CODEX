import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { ResendApiError } from '@/lib/email/resend'

/**
 * Resend delivery events against the real schema (PGlite): the general email log, the legacy invitation's
 * "Last event", the do-not-email list, the status backfill and the suppression list sync. Addresses are placeholders.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { emailDeliveryRepository } = await import('./repository')
const { parseResendWebhookEvent, backfillEvent } = await import('./events')
const { createDeliveryBackfillWorker } = await import('./backfill')
const { emailSuppressions, withEmailSuppression } = await import('@/lib/email/suppression')

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

let sequence = 0
async function sentInvite(options: { email?: string; daysAgo?: number } = {}) {
  sequence += 1
  const email = options.email ?? `fixture-legacy-${sequence}@example.test`
  const profile = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`, [`Fixture Legacy ${sequence}`])
  const messageId = `resend-email-${sequence}`
  const rows = await db.query(
    `insert into public.legacy_profile_invites (profile_id, email, status, attempts, resend_message_id, sent_at)
     values ($1, $2, 'sent', 1, $3, now() - make_interval(days => $4)) returning id`,
    [profile[0]!.id, email, messageId, options.daysAgo ?? 7],
  )
  return { id: rows[0]!.id as string, email, messageId }
}

function webhook(type: string, emailId: string, to: string, options: { id?: string; at?: string; bounceType?: string } = {}) {
  return parseResendWebhookEvent(JSON.stringify({
    type: `email.${type}`,
    created_at: options.at ?? '2026-10-04T10:00:00.000Z',
    data: { email_id: emailId, to: [to], tags: { category: 'legacy_profile_invite' }, ...(options.bounceType ? { bounce: { type: options.bounceType } } : {}) },
  }), options.id ?? `msg_${Math.random()}`)!
}

async function invite(id: string) {
  return (await db.query(`select last_event, last_event_at, delivered_at, delivery_checked_at from public.legacy_profile_invites where id = $1`, [id]))[0]!
}

describe('recording Resend delivery events', () => {
  it('fills the invitation’s Last event and delivered time, and writes the general email log', async () => {
    const sent = await sentInvite()
    await expect(emailDeliveryRepository.recordEvent(webhook('delivered', sent.messageId, sent.email))).resolves.toEqual({ status: 'recorded', suppressed: 0 })
    const row = await invite(sent.id)
    expect(row.last_event).toBe('delivered')
    expect(row.delivered_at).not.toBeNull()
    const log = await db.query(`select source, event_type, recipient, category from public.email_delivery_events where resend_email_id = $1`, [sent.messageId])
    expect(log).toEqual([{ source: 'webhook', event_type: 'delivered', recipient: sent.email, category: 'legacy_profile_invite' }])
  })

  it('keeps each svix delivery once, so Resend’s retries change nothing', async () => {
    const sent = await sentInvite()
    const event = webhook('delivered', sent.messageId, sent.email, { id: 'msg_retry' })
    await emailDeliveryRepository.recordEvent(event)
    await expect(emailDeliveryRepository.recordEvent(event)).resolves.toEqual({ status: 'duplicate', suppressed: 0 })
    expect(await db.query(`select 1 from public.email_delivery_events where provider_event_id = 'msg_retry'`)).toHaveLength(1)
  })

  it('lets the newest event win when deliveries arrive out of order', async () => {
    const sent = await sentInvite()
    await emailDeliveryRepository.recordEvent(webhook('complained', sent.messageId, sent.email, { at: '2026-10-05T10:00:00.000Z' }))
    await emailDeliveryRepository.recordEvent(webhook('delivered', sent.messageId, sent.email, { at: '2026-10-04T10:00:00.000Z' }))
    const row = await invite(sent.id)
    expect(row.last_event).toBe('complained')
    expect(row.delivered_at).not.toBeNull()
  })

  it('puts hard bounces, complaints and suppressions on the do-not-email list, but not temporary bounces', async () => {
    const hard = await sentInvite({ email: 'Fixture-Hard@Example.test'.toLowerCase() })
    const soft = await sentInvite()
    const complained = await sentInvite()
    const suppressed = await sentInvite()
    await expect(emailDeliveryRepository.recordEvent(webhook('bounced', hard.messageId, 'Fixture-Hard@Example.test', { bounceType: 'Permanent' }))).resolves.toEqual({ status: 'recorded', suppressed: 1 })
    await emailDeliveryRepository.recordEvent(webhook('bounced', soft.messageId, soft.email, { bounceType: 'Transient' }))
    await emailDeliveryRepository.recordEvent(webhook('complained', complained.messageId, complained.email))
    await emailDeliveryRepository.recordEvent(webhook('suppressed', suppressed.messageId, suppressed.email))

    const rows = await db.query(`select email, reason, source from public.email_suppressions where email = any($1::text[]) order by email`, [[hard.email, soft.email, complained.email, suppressed.email]])
    expect(rows).toEqual(expect.arrayContaining([
      { email: 'fixture-hard@example.test', reason: 'hard_bounce', source: 'resend_webhook' },
      { email: complained.email, reason: 'complaint', source: 'resend_webhook' },
      { email: suppressed.email, reason: 'provider_suppressed', source: 'resend_webhook' },
    ]))
    expect(rows.map((row) => row.email)).not.toContain(soft.email)
    await expect(emailSuppressions.isSuppressed('FIXTURE-HARD@example.test')).resolves.toBe(true)
  })

  it('refuses to send to a do-not-email address from any wrapped sender, before Resend is called', async () => {
    const sent = await sentInvite()
    await emailDeliveryRepository.recordEvent(webhook('complained', sent.messageId, sent.email))
    const sendEmail = vi.fn<(input: { to: string }) => Promise<{ messageId: string }>>(async () => ({ messageId: 'x' }))
    const guarded = withEmailSuppression({ sendEmail })
    await expect(guarded.sendEmail({ to: sent.email.toUpperCase() })).rejects.toMatchObject({ code: 'recipient_do_not_email', retryable: false })
    await expect(guarded.sendEmail({ to: 'fixture-fine@example.test' })).resolves.toEqual({ messageId: 'x' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('delivery status backfill', () => {
  it('fetches each settled invitation once, records its final status and never overwrites the webhook', async () => {
    await db.query(`update public.legacy_profile_invites set delivery_checked_at = now() where delivery_checked_at is null`)
    const delivered = await sentInvite({ daysAgo: 7 })
    const bounced = await sentInvite({ daysAgo: 7 })
    const missing = await sentInvite({ daysAgo: 7 })
    const webhookFirst = await sentInvite({ daysAgo: 7 })
    const tooNew = await sentInvite({ daysAgo: 0 })
    await emailDeliveryRepository.recordEvent(webhook('complained', webhookFirst.messageId, webhookFirst.email))

    const statuses: Record<string, string> = {
      [delivered.messageId]: 'delivered',
      [bounced.messageId]: 'bounced',
      [webhookFirst.messageId]: 'delivered',
    }
    const getEmail = vi.fn(async (id: string) => {
      if (id === missing.messageId) throw new ResendApiError('not_found', 404, 'Email not found')
      return { id, lastEvent: statuses[id] ?? null, to: [], createdAt: null }
    })
    const worker = createDeliveryBackfillWorker({ resend: { getEmail, listSuppressions: vi.fn() }, sleep: async () => {} })

    expect(await emailDeliveryRepository.backfillProgress()).toMatchObject({ remaining: 3 })
    await expect(worker.runStatusSweep(20)).resolves.toMatchObject({ checked: 3, recorded: 2, suppressed: 1, stopped: null })
    expect(getEmail).not.toHaveBeenCalledWith(tooNew.messageId)
    expect(getEmail).not.toHaveBeenCalledWith(webhookFirst.messageId)
    expect((await invite(delivered.id)).last_event).toBe('delivered')
    expect((await invite(delivered.id)).delivered_at).not.toBeNull()
    expect((await invite(bounced.id)).last_event).toBe('bounced')
    expect((await invite(missing.id)).delivery_checked_at).not.toBeNull()
    await expect(emailSuppressions.isSuppressed(bounced.email)).resolves.toBe(true)
    const log = await db.query(`select source from public.email_delivery_events where resend_email_id = $1`, [bounced.messageId])
    expect(log).toEqual([{ source: 'backfill' }])

    // A later sweep has nothing left; the webhook's newer data is never overwritten by a backfill.
    await expect(worker.runStatusSweep(20)).resolves.toMatchObject({ checked: 0 })
    const late = backfillEvent({ resendEmailId: webhookFirst.messageId, lastEvent: 'delivered', recipients: [webhookFirst.email] })!
    await emailDeliveryRepository.recordEvent(late)
    expect((await invite(webhookFirst.id)).last_event).toBe('complained')
  })

  it('stops a sweep on a rate limit and tries the same email again next time', async () => {
    await db.query(`update public.legacy_profile_invites set delivery_checked_at = now() where delivery_checked_at is null`)
    const first = await sentInvite()
    const second = await sentInvite()
    const getEmail = vi.fn()
      .mockRejectedValueOnce(new ResendApiError('rate_limit_exceeded', 429, 'Too many requests'))
      .mockImplementation(async (id: string) => ({ id, lastEvent: 'delivered', to: [], createdAt: null }))
    const worker = createDeliveryBackfillWorker({ resend: { getEmail, listSuppressions: vi.fn() }, sleep: async () => {} })
    await expect(worker.runStatusSweep(20)).resolves.toMatchObject({ checked: 0, stopped: 'rate_limited' })
    expect((await invite(first.id)).delivery_checked_at).toBeNull()
    await expect(worker.runStatusSweep(20)).resolves.toMatchObject({ checked: 2, recorded: 2 })
    expect((await invite(second.id)).last_event).toBe('delivered')
  })

  it('stops for good when the Resend key cannot read emails', async () => {
    await sentInvite()
    const log = vi.fn()
    const getEmail = vi.fn(async () => { throw new ResendApiError('restricted_api_key', 401, 'This API key is restricted to only send emails') })
    const worker = createDeliveryBackfillWorker({ resend: { getEmail, listSuppressions: vi.fn() }, sleep: async () => {}, log })
    await expect(worker.runStatusSweep(20)).resolves.toMatchObject({ stopped: 'forbidden' })
    await expect(worker.runStatusSweep(20)).resolves.toMatchObject({ disabled: true })
    expect(getEmail).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('resend_status_backfill_forbidden', { status: 401 })
  })
})

describe('Resend suppression list sync', () => {
  it('pages through the list and puts every address on the do-not-email list once', async () => {
    const listSuppressions = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: 's1', email: 'fixture-sup-a@example.test', origin: 'bounce', sourceId: 'e1' }, { id: 's2', email: 'Fixture-Sup-B@Example.test', origin: 'complaint', sourceId: null }], hasMore: true })
      .mockResolvedValueOnce({ data: [{ id: 's3', email: 'fixture-sup-c@example.test', origin: 'manual', sourceId: null }], hasMore: false })
    const worker = createDeliveryBackfillWorker({ resend: { getEmail: vi.fn(), listSuppressions }, sleep: async () => {} })
    await expect(worker.runSuppressionSync()).resolves.toEqual({ seen: 3, added: 3, disabled: false })
    expect(listSuppressions).toHaveBeenNthCalledWith(2, { after: 's2', limit: 100 })
    const rows = await db.query(`select email, reason, source from public.email_suppressions where email like 'fixture-sup-%' order by email`)
    expect(rows).toEqual([
      { email: 'fixture-sup-a@example.test', reason: 'hard_bounce', source: 'resend_suppression_list' },
      { email: 'fixture-sup-b@example.test', reason: 'complaint', source: 'resend_suppression_list' },
      { email: 'fixture-sup-c@example.test', reason: 'provider_suppressed', source: 'resend_suppression_list' },
    ])
  })
})
