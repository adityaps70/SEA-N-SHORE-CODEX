import { describe, expect, it } from 'vitest'
import { createNewsletterToken } from '@/features/newsletter/tokens'
import { NOTIFICATION_EMAIL_KINDS } from './kinds'
import { createNotificationEmailToken, notificationEmailTokenSecret, verifyNotificationEmailToken } from './tokens'

/** Round H (H3): unsubscribe tokens name one member and one email type, and cannot be forged or repurposed. */
const secret = 'test-secret-that-is-at-least-32-characters-long'
const otherSecret = 'another-test-secret-at-least-32-characters-x'
const member = '11111111-1111-4111-8111-111111111111'
const otherMember = '22222222-2222-4222-8222-222222222222'

function rewritePayload(token: string, change: (payload: Record<string, unknown>) => Record<string, unknown>) {
  const [encoded, signature] = token.split('.')
  const payload = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8')) as Record<string, unknown>
  return `${Buffer.from(JSON.stringify(change(payload)), 'utf8').toString('base64url')}.${signature}`
}

describe('notification email unsubscribe tokens', () => {
  it('round-trips the member and the email type for every type, and holds no email address', () => {
    for (const kind of NOTIFICATION_EMAIL_KINDS) {
      const token = createNotificationEmailToken({ profileId: member, kind, secret })
      expect(verifyNotificationEmailToken(token, { secret })).toEqual({ ok: true, profileId: member, kind })
      expect(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')).not.toContain('@')
    }
  })

  it('cannot be altered to name another type or another member', () => {
    const token = createNotificationEmailToken({ profileId: member, kind: 'comments', secret })
    expect(verifyNotificationEmailToken(rewritePayload(token, (payload) => ({ ...payload, k: 'messages' })), { secret })).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyNotificationEmailToken(rewritePayload(token, (payload) => ({ ...payload, m: otherMember })), { secret })).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyNotificationEmailToken(rewritePayload(token, (payload) => ({ ...payload, e: 9_999_999_999 })), { secret })).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects a token signed with another secret, a newsletter token, garbage and a missing secret', () => {
    const forged = createNotificationEmailToken({ profileId: member, kind: 'mentions', secret: otherSecret })
    expect(verifyNotificationEmailToken(forged, { secret })).toEqual({ ok: false, reason: 'invalid' })
    const newsletter = createNewsletterToken({ subscriberId: member, purpose: 'unsubscribe', secret })
    expect(verifyNotificationEmailToken(newsletter, { secret })).toEqual({ ok: false, reason: 'invalid' })
    for (const value of ['', 'abc', 'a.b.c', 'forged.token', null, undefined, 42, 'x'.repeat(700)]) {
      expect(verifyNotificationEmailToken(value, { secret })).toEqual({ ok: false, reason: 'invalid' })
    }
    const token = createNotificationEmailToken({ profileId: member, kind: 'mentions', secret })
    expect(verifyNotificationEmailToken(token, { secret: null })).toEqual({ ok: false, reason: 'invalid' })
  })

  it('expires (400 days by default)', () => {
    const issued = new Date('2026-01-01T00:00:00Z')
    const token = createNotificationEmailToken({ profileId: member, kind: 'messages', secret, now: issued })
    expect(verifyNotificationEmailToken(token, { secret, now: new Date('2027-01-01T00:00:00Z') }).ok).toBe(true)
    expect(verifyNotificationEmailToken(token, { secret, now: new Date('2027-02-06T00:00:00Z') })).toEqual({ ok: false, reason: 'expired' })
  })

  it('reuses the newsletter signing secret (32+ characters) and is off without it', () => {
    expect(notificationEmailTokenSecret({ NEWSLETTER_TOKEN_SECRET: secret })).toBe(secret)
    expect(notificationEmailTokenSecret({ NEWSLETTER_TOKEN_SECRET: 'short' })).toBeNull()
    expect(notificationEmailTokenSecret({})).toBeNull()
  })
})
