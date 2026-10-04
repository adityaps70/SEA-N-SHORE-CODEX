import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

/**
 * Round 14 (2.3): SCORM packages run in a sandbox without allow-same-origin (their own opaque
 * origin), so they cannot read the parent page, its cookies or its storage. Requests from such a
 * document count as cross-site, so the SameSite session cookie is not sent with the package's own
 * scripts and images. The content URL therefore carries a short-lived signed segment
 * (t.<learnerId>.<expiresAt>.<signature>) that every relative URL inside the package inherits.
 * The route still checks enrollment for that learner on every file.
 */
export const SCORM_CONTENT_LINK_TTL_SECONDS = 6 * 60 * 60
const KEY_INFO = 'sea-n-shore/scorm-content-link/v1'
const SIGNATURE_LENGTH = 43
const TOKEN_PATTERN = /^t\.([A-Za-z0-9-]{8,64})\.(\d{10})\.([A-Za-z0-9_-]{43})$/

type Environment = Record<string, string | undefined>

let cachedKey: { source: string; key: Buffer } | null = null

/** Derived (HKDF, own label) from the realtime ticket secret the web task already holds. */
export function scormContentLinkKey(environment: Environment = process.env): Buffer | null {
  const source = environment.REALTIME_TICKET_SECRET?.trim() || ''
  if (source.length < 32) return null
  if (cachedKey?.source === source) return cachedKey.key
  const key = Buffer.from(hkdfSync('sha256', source, Buffer.alloc(0), KEY_INFO, 32))
  cachedKey = { source, key }
  return key
}

function sign(key: Buffer, learnerId: string, lessonId: string, expiresAt: number) {
  return createHmac('sha256', key).update(`${learnerId}\n${lessonId}\n${expiresAt}`).digest('base64url').slice(0, SIGNATURE_LENGTH)
}

/** The signed path segment for one learner and lesson, or null when signing is not configured. */
export function createScormContentToken(
  learnerId: string,
  lessonId: string,
  options: { now?: number; environment?: Environment } = {},
): string | null {
  const key = scormContentLinkKey(options.environment)
  if (!key || !/^[A-Za-z0-9-]{8,64}$/.test(learnerId)) return null
  const expiresAt = Math.floor((options.now ?? Date.now()) / 1000) + SCORM_CONTENT_LINK_TTL_SECONDS
  return `t.${learnerId}.${expiresAt}.${sign(key, learnerId, lessonId, expiresAt)}`
}

export function isScormContentToken(segment: string | undefined): boolean {
  return typeof segment === 'string' && TOKEN_PATTERN.test(segment)
}

export type ScormContentTokenCheck =
  | { ok: true; learnerId: string }
  | { ok: false; reason: 'not_configured' | 'malformed' | 'expired' | 'bad_signature' }

export function verifyScormContentToken(
  segment: string,
  lessonId: string,
  options: { now?: number; environment?: Environment } = {},
): ScormContentTokenCheck {
  const key = scormContentLinkKey(options.environment)
  if (!key) return { ok: false, reason: 'not_configured' }
  const match = TOKEN_PATTERN.exec(segment)
  if (!match) return { ok: false, reason: 'malformed' }
  const [, learnerId, expiresRaw, signature] = match
  const expiresAt = Number(expiresRaw)
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000)
  if (expiresAt <= nowSeconds || expiresAt > nowSeconds + SCORM_CONTENT_LINK_TTL_SECONDS) return { ok: false, reason: 'expired' }
  const expected = Buffer.from(sign(key, learnerId, lessonId, expiresAt))
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad_signature' }
  return { ok: true, learnerId }
}

/**
 * Policy for every SCORM response: scripts run, but in an opaque origin (no allow-same-origin),
 * and only the site itself may frame the package. frame-ancestors takes precedence over the
 * site-wide X-Frame-Options: DENY, which would otherwise block the player's iframe.
 */
export const SCORM_CONTENT_SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-downloads; frame-ancestors 'self'"
