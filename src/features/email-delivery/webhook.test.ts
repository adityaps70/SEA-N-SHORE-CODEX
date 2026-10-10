import { describe, expect, it, vi } from 'vitest'
import { signResendWebhook } from '@/lib/email/resend-webhook'
import { parseResendWebhookEvent, suppressionReasonFor } from './events'
import { handleResendWebhook } from './webhook'

const SECRET = 'whsec_' + Buffer.from('sea-n-shore-test-signing-key-0123456789').toString('base64')
const NOW = 1_791_000_000

function bounced(type = 'Permanent') {
  return JSON.stringify({
    type: 'email.bounced',
    created_at: '2026-10-10T10:00:00.000Z',
    data: {
      email_id: 'email-1',
      to: ['Old.Member@Example.com'],
      tags: { category: 'legacy_profile_invite' },
      bounce: { type, subType: 'General', message: 'Mailbox does not exist' },
    },
  })
}

function request(body: string, options: { secret?: string; id?: string; timestamp?: number; headers?: Record<string, string> } = {}) {
  const id = options.id ?? 'msg_1'
  const timestamp = options.timestamp ?? NOW
  return new Request('https://seanshore.in/api/email/resend/webhook', {
    method: 'POST',
    body,
    headers: {
      'svix-id': id,
      'svix-timestamp': String(timestamp),
      'svix-signature': signResendWebhook({ secret: options.secret ?? SECRET, id, timestamp, body }),
      ...options.headers,
    },
  })
}

type RecordEvent = (event: unknown) => Promise<{ status: 'recorded' | 'duplicate'; suppressed: number }>

const deps = (record: RecordEvent = vi.fn(async () => ({ status: 'recorded' as const, suppressed: 1 }))) => ({
  loadSecret: async () => SECRET,
  nowSeconds: () => NOW,
  record,
})

describe('POST /api/email/resend/webhook', () => {
  it('records a correctly signed event with its svix-id', async () => {
    const record = vi.fn(async () => ({ status: 'recorded' as const, suppressed: 1 }))
    const result = await handleResendWebhook(request(bounced()), deps(record))
    expect(result).toEqual({ status: 200, body: { ok: true, status: 'recorded' } })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      providerEventId: 'msg_1',
      source: 'webhook',
      type: 'bounced',
      resendEmailId: 'email-1',
      recipients: ['old.member@example.com'],
      category: 'legacy_profile_invite',
      bounceType: 'Permanent',
      detail: 'Mailbox does not exist',
    }))
  })

  it('refuses a forged or tampered delivery with 400 and records nothing', async () => {
    const record = vi.fn()
    const forged = 'whsec_' + Buffer.from('attacker-chosen-test-key-000000000').toString('base64')
    expect((await handleResendWebhook(request(bounced(), { secret: forged }), deps(record as never))).status).toBe(400)
    const tampered = request(bounced())
    const replaced = new Request(tampered.url, { method: 'POST', headers: tampered.headers, body: bounced('Transient') })
    expect((await handleResendWebhook(replaced, deps(record as never))).status).toBe(400)
    const unsigned = new Request('https://seanshore.in/api/email/resend/webhook', { method: 'POST', body: bounced() })
    expect((await handleResendWebhook(unsigned, deps(record as never))).status).toBe(400)
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses a replayed delivery signed more than 5 minutes ago', async () => {
    const record = vi.fn()
    const result = await handleResendWebhook(request(bounced(), { timestamp: NOW - 600 }), deps(record as never))
    expect(result.status).toBe(400)
    expect(record).not.toHaveBeenCalled()
  })

  it('answers 503 until the signing secret exists, so Resend retries later', async () => {
    const result = await handleResendWebhook(request(bounced()), { ...deps(), loadSecret: async () => null })
    expect(result).toEqual({ status: 503, body: { ok: false, error: 'webhook_not_configured' } })
  })

  it('refuses an oversized body before reading it', async () => {
    const big = new Request('https://seanshore.in/api/email/resend/webhook', { method: 'POST', body: 'x', headers: { 'content-length': String(1024 * 1024) } })
    expect((await handleResendWebhook(big, deps())).status).toBe(413)
  })

  it('acknowledges event types it does not keep, and duplicates, with 200', async () => {
    const opened = JSON.stringify({ type: 'email.opened', data: { email_id: 'email-1' } })
    const record = vi.fn()
    expect(await handleResendWebhook(request(opened), deps(record as never))).toEqual({ status: 200, body: { ok: true, status: 'ignored' } })
    expect(record).not.toHaveBeenCalled()
    const duplicate = vi.fn(async () => ({ status: 'duplicate' as const, suppressed: 0 }))
    expect(await handleResendWebhook(request(bounced()), deps(duplicate))).toEqual({ status: 200, body: { ok: true, status: 'duplicate' } })
  })

  it('answers 500 when recording fails, so Resend redelivers', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const record = vi.fn(async () => { throw new Error('db down') })
    expect((await handleResendWebhook(request(bounced()), deps(record))).status).toBe(500)
    log.mockRestore()
  })
})

describe('delivery event parsing', () => {
  it('maps the six subscribed event types and nothing else', () => {
    for (const type of ['delivered', 'bounced', 'complained', 'delivery_delayed', 'failed', 'suppressed']) {
      const event = parseResendWebhookEvent(JSON.stringify({ type: `email.${type}`, data: { email_id: 'e1', to: 'A <a@example.com>' } }), 'msg')
      expect(event).toMatchObject({ type, recipients: ['a@example.com'] })
    }
    expect(parseResendWebhookEvent(JSON.stringify({ type: 'domain.updated', data: {} }), 'msg')).toBeNull()
    expect(parseResendWebhookEvent(JSON.stringify({ type: 'email.delivered', data: {} }), 'msg')).toBeNull()
    expect(parseResendWebhookEvent('not json', 'msg')).toBeNull()
  })

  it('treats hard bounces, complaints and suppressions as do-not-email, but not temporary bounces', () => {
    expect(suppressionReasonFor({ type: 'bounced', bounceType: 'Permanent' })).toBe('hard_bounce')
    expect(suppressionReasonFor({ type: 'bounced', bounceType: null })).toBe('hard_bounce')
    expect(suppressionReasonFor({ type: 'bounced', bounceType: 'Transient' })).toBeNull()
    expect(suppressionReasonFor({ type: 'complained', bounceType: null })).toBe('complaint')
    expect(suppressionReasonFor({ type: 'suppressed', bounceType: null })).toBe('provider_suppressed')
    expect(suppressionReasonFor({ type: 'delivered', bounceType: null })).toBeNull()
    expect(suppressionReasonFor({ type: 'failed', bounceType: null })).toBeNull()
    expect(suppressionReasonFor({ type: 'delivery_delayed', bounceType: null })).toBeNull()
  })
})
