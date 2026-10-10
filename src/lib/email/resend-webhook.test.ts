import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  loadResendWebhookSecret,
  resendWebhookSecretId,
  signResendWebhook,
  verifyResendWebhook,
  webhookSecretFromSecretString,
} from './resend-webhook'

// A made-up test secret in Svix's format ("whsec_" + base64 key). Not a real credential.
const SECRET = 'whsec_' + Buffer.from('sea-n-shore-test-signing-key-0123456789').toString('base64')
const BODY = JSON.stringify({ type: 'email.delivered', created_at: '2026-10-10T10:00:00.000Z', data: { email_id: 'e1', to: ['a@example.com'] } })
const NOW = 1_791_000_000

function signed(overrides: Partial<Parameters<typeof verifyResendWebhook>[0]> = {}) {
  return verifyResendWebhook({
    secret: SECRET,
    id: 'msg_1',
    timestamp: String(NOW),
    signature: signResendWebhook({ secret: SECRET, id: 'msg_1', timestamp: NOW, body: BODY }),
    body: BODY,
    nowSeconds: NOW,
    ...overrides,
  })
}

describe('Resend (Svix) webhook signature check', () => {
  it('accepts a correctly signed delivery and matches Svix’s documented HMAC-SHA256 scheme', () => {
    const independent = createHmac('sha256', Buffer.from(SECRET.slice(6), 'base64')).update(`msg_1.${NOW}.${BODY}`).digest('base64')
    expect(signResendWebhook({ secret: SECRET, id: 'msg_1', timestamp: NOW, body: BODY })).toBe(`v1,${independent}`)
    expect(signed()).toEqual({ ok: true })
  })

  it('refuses a changed body, a different id or timestamp, or another secret', () => {
    expect(signed({ body: BODY.replace('delivered', 'bounced') })).toEqual({ ok: false, reason: 'bad_signature' })
    expect(signed({ body: BODY + ' ' })).toEqual({ ok: false, reason: 'bad_signature' })
    expect(signed({ id: 'msg_2' })).toEqual({ ok: false, reason: 'bad_signature' })
    expect(signed({ timestamp: String(NOW + 1) })).toEqual({ ok: false, reason: 'bad_signature' })
    const other = 'whsec_' + Buffer.from('another-test-signing-key-9876543210').toString('base64')
    expect(signed({ secret: other })).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('refuses replays outside the 5-minute window, in either direction', () => {
    expect(signed({ nowSeconds: NOW + 300 })).toEqual({ ok: true })
    expect(signed({ nowSeconds: NOW + 301 })).toEqual({ ok: false, reason: 'stale_timestamp' })
    expect(signed({ nowSeconds: NOW - 301 })).toEqual({ ok: false, reason: 'stale_timestamp' })
  })

  it('refuses missing or malformed headers', () => {
    expect(signed({ id: null })).toEqual({ ok: false, reason: 'missing_headers' })
    expect(signed({ timestamp: null })).toEqual({ ok: false, reason: 'missing_headers' })
    expect(signed({ timestamp: 'yesterday' })).toEqual({ ok: false, reason: 'missing_headers' })
    expect(signed({ signature: '' })).toEqual({ ok: false, reason: 'missing_headers' })
    expect(signed({ signature: 'garbage' })).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('accepts any one matching v1 signature in a space-separated list (secret rotation) and ignores other versions', () => {
    const good = signResendWebhook({ secret: SECRET, id: 'msg_1', timestamp: NOW, body: BODY })
    expect(signed({ signature: `v1,AAAA ${good}` })).toEqual({ ok: true })
    expect(signed({ signature: good.replace('v1,', 'v2,') })).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('refuses everything when the configured secret is malformed', () => {
    expect(signed({ secret: 'not-a-secret' })).toEqual({ ok: false, reason: 'bad_signature' })
  })
})

describe('Resend webhook signing secret', () => {
  it('reads the bare secret or a JSON object, and nothing else', () => {
    expect(webhookSecretFromSecretString(SECRET)).toBe(SECRET)
    expect(webhookSecretFromSecretString(JSON.stringify({ signing_secret: SECRET, webhook_id: 'w1' }))).toBe(SECRET)
    expect(webhookSecretFromSecretString('re_api_key_not_a_webhook_secret')).toBeNull()
    expect(webhookSecretFromSecretString('')).toBeNull()
  })

  it('uses the sea-n-shore/resend-webhook-signing secret in production, which the sea-n-shore/resend* grant covers', () => {
    expect(resendWebhookSecretId({ NODE_ENV: 'production' })).toBe('sea-n-shore/resend-webhook-signing')
    expect('sea-n-shore/resend-webhook-signing'.startsWith('sea-n-shore/resend')).toBe(true)
    expect(resendWebhookSecretId({ NODE_ENV: 'test' })).toBeNull()
  })

  it('returns null without throwing while the secret does not exist yet', async () => {
    const error = Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' })
    const loadSecret = vi.fn(async () => { throw error })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(loadResendWebhookSecret({ environment: { NODE_ENV: 'production' }, loadSecret, useCache: false })).resolves.toBeNull()
    expect(log.mock.calls.flat().join(' ')).not.toContain('whsec_')
    log.mockRestore()
  })
})
