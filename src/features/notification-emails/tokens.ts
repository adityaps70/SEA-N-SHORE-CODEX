import { createHmac, timingSafeEqual } from 'node:crypto'
import { getNewsletterConfig } from '@/features/newsletter/config'
import { isNotificationEmailKind, type NotificationEmailKind } from './kinds'

/**
 * Round H (H3): signed, sign-in-free unsubscribe links for member activity emails. Same approach and secret as the
 * newsletter links (NEWSLETTER_TOKEN_SECRET, HMAC-SHA256, base64url(payload).base64url(mac)), with its own purpose
 * prefix, so a newsletter token is never accepted here and this token is never accepted by the newsletter.
 * The payload names the member and one email type, and nothing else (never an email address). Changing the type
 * breaks the signature, so a link only ever turns off the one type it was sent for, for the member it was sent to.
 */
export const NOTIFICATION_EMAIL_TOKEN_TTL_SECONDS = 400 * 24 * 60 * 60

const PURPOSE = 'member-notification-email-unsubscribe'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Payload = { m: string; k: NotificationEmailKind; e: number }

export type NotificationEmailTokenResult =
  | { ok: true; profileId: string; kind: NotificationEmailKind }
  | { ok: false; reason: 'invalid' | 'expired' }

/** The newsletter's signing secret (32+ characters), or null when it is not configured. */
export function notificationEmailTokenSecret(env: Record<string, string | undefined> = process.env) {
  return getNewsletterConfig(env).tokenSecret
}

function sign(encodedPayload: string, secret: string) {
  return createHmac('sha256', secret).update(`${PURPOSE}:${encodedPayload}`).digest('base64url')
}

export function createNotificationEmailToken(input: {
  profileId: string
  kind: NotificationEmailKind
  secret: string
  now?: Date
  ttlSeconds?: number
}) {
  if (!UUID.test(input.profileId) || !isNotificationEmailKind(input.kind)) throw new Error('notification_email_token_invalid_input')
  const now = input.now ?? new Date()
  const payload: Payload = {
    m: input.profileId.toLowerCase(),
    k: input.kind,
    e: Math.floor(now.getTime() / 1000) + (input.ttlSeconds ?? NOTIFICATION_EMAIL_TOKEN_TTL_SECONDS),
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${sign(encoded, input.secret)}`
}

export function verifyNotificationEmailToken(
  token: unknown,
  input: { secret: string | null; now?: Date },
): NotificationEmailTokenResult {
  if (!input.secret) return { ok: false, reason: 'invalid' }
  if (typeof token !== 'string' || token.length > 600) return { ok: false, reason: 'invalid' }
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra !== undefined) return { ok: false, reason: 'invalid' }

  const expected = Buffer.from(sign(encoded, input.secret))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { ok: false, reason: 'invalid' }

  let payload: Partial<Payload>
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<Payload>
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (typeof payload.m !== 'string' || !UUID.test(payload.m) || !isNotificationEmailKind(payload.k) || typeof payload.e !== 'number') {
    return { ok: false, reason: 'invalid' }
  }
  const now = input.now ?? new Date()
  if (payload.e * 1000 <= now.getTime()) return { ok: false, reason: 'expired' }
  return { ok: true, profileId: payload.m, kind: payload.k }
}
