import { describe, expect, it } from 'vitest'
import { createNewsletterToken, verifyNewsletterToken } from './tokens'

const secret = 'test-secret-that-is-at-least-32-characters-long'
const subscriberId = '11111111-1111-4111-8111-111111111111'
const now = new Date('2026-09-27T10:00:00Z')

describe('newsletter tokens', () => {
  it('verifies a valid unsubscribe token without exposing the email', () => {
    const token = createNewsletterToken({ subscriberId, purpose: 'unsubscribe', secret, now })
    expect(token).not.toContain('@')
    const result = verifyNewsletterToken(token, { purpose: 'unsubscribe', secret, now })
    expect(result).toEqual({ ok: true, subscriberId, expiresAt: expect.any(Date) })
  })

  it('rejects tampered, foreign-secret, wrong-purpose and malformed tokens as invalid', () => {
    const token = createNewsletterToken({ subscriberId, purpose: 'unsubscribe', secret, now })
    const [payload, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ s: '22222222-2222-4222-8222-222222222222', p: 'unsubscribe', e: 9999999999 })).toString('base64url')

    expect(verifyNewsletterToken(`${forged}.${signature}`, { purpose: 'unsubscribe', secret, now })).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyNewsletterToken(`${payload}.${signature}x`, { purpose: 'unsubscribe', secret, now })).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyNewsletterToken(token, { purpose: 'unsubscribe', secret: `${secret}-other`, now })).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyNewsletterToken(token, { purpose: 'confirm', secret, now })).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyNewsletterToken('not-a-token', { purpose: 'unsubscribe', secret, now })).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyNewsletterToken(null, { purpose: 'unsubscribe', secret, now })).toEqual({ ok: false, reason: 'invalid' })
  })

  it('reports expired tokens separately so the page can explain what to do', () => {
    const token = createNewsletterToken({ subscriberId, purpose: 'confirm', secret, now, ttlSeconds: 60 })
    const later = new Date(now.getTime() + 61_000)
    expect(verifyNewsletterToken(token, { purpose: 'confirm', secret, now: later })).toEqual({ ok: false, reason: 'expired' })
  })
})
