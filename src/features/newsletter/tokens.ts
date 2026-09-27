import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed, login-free newsletter links. Format: base64url(payload).base64url(hmac).
 * The payload holds only the subscriber id, the purpose and an expiry — never the email.
 */
export type NewsletterTokenPurpose = 'unsubscribe' | 'confirm'

export const NEWSLETTER_TOKEN_TTL_SECONDS: Record<NewsletterTokenPurpose, number> = {
  // Unsubscribe links live in old emails, so they stay valid for a long time.
  unsubscribe: 400 * 24 * 60 * 60,
  confirm: 7 * 24 * 60 * 60,
}

type Payload = { s: string; p: NewsletterTokenPurpose; e: number }

export type NewsletterTokenResult =
  | { ok: true; subscriberId: string; expiresAt: Date }
  | { ok: false; reason: 'invalid' | 'expired' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sign(encodedPayload: string, secret: string) {
  return createHmac('sha256', secret).update(`newsletter:${encodedPayload}`).digest('base64url')
}

export function createNewsletterToken(input: {
  subscriberId: string
  purpose: NewsletterTokenPurpose
  secret: string
  now?: Date
  ttlSeconds?: number
}) {
  const now = input.now ?? new Date()
  const ttl = input.ttlSeconds ?? NEWSLETTER_TOKEN_TTL_SECONDS[input.purpose]
  const payload: Payload = { s: input.subscriberId, p: input.purpose, e: Math.floor(now.getTime() / 1000) + ttl }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${sign(encoded, input.secret)}`
}

export function verifyNewsletterToken(
  token: unknown,
  input: { purpose: NewsletterTokenPurpose; secret: string; now?: Date },
): NewsletterTokenResult {
  if (typeof token !== 'string' || token.length > 600) return { ok: false, reason: 'invalid' }
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra !== undefined) return { ok: false, reason: 'invalid' }

  const expected = Buffer.from(sign(encoded, input.secret))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: 'invalid' }
  }

  let payload: Partial<Payload>
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<Payload>
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  if (payload.p !== input.purpose || typeof payload.s !== 'string' || !UUID.test(payload.s) || typeof payload.e !== 'number') {
    return { ok: false, reason: 'invalid' }
  }

  const now = input.now ?? new Date()
  if (payload.e * 1000 <= now.getTime()) return { ok: false, reason: 'expired' }
  return { ok: true, subscriberId: payload.s, expiresAt: new Date(payload.e * 1000) }
}
