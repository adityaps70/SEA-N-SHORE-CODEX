import { createHmac } from 'node:crypto'

/** Lower-case and trim; the database stores one canonical form per address. */
export function normalizeNewsletterEmail(value: string) {
  return value.trim().toLowerCase()
}

/**
 * Keyed, truncated hash of the client IP. Used only for abuse protection
 * (rate limiting) and consent evidence; the IP itself is never stored.
 */
export function hashClientIp(ip: string | null | undefined, secret: string | null) {
  const value = ip?.trim()
  if (!value || !secret) return null
  return createHmac('sha256', secret).update(`newsletter-ip:${value}`).digest('hex').slice(0, 32)
}

/** First address in X-Forwarded-For (CloudFront/ALB), else X-Real-IP. */
export function clientIpFromHeaders(headers: Pick<Headers, 'get'>) {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || headers.get('x-real-ip')?.trim() || null
}

const BROWSERS: Array<[RegExp, string]> = [
  [/edg\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/samsungbrowser/i, 'Samsung Internet'],
  [/firefox|fxios/i, 'Firefox'],
  [/chrome|crios/i, 'Chrome'],
  [/safari/i, 'Safari'],
]

const SYSTEMS: Array<[RegExp, string]> = [
  [/android/i, 'Android'],
  [/iphone|ipad|ipod/i, 'iOS'],
  [/windows/i, 'Windows'],
  [/mac os x|macintosh/i, 'macOS'],
  [/cros/i, 'ChromeOS'],
  [/linux/i, 'Linux'],
]

/** Coarse "Browser on OS" summary. The raw user agent is never stored. */
export function summarizeUserAgent(userAgent: string | null | undefined) {
  const value = userAgent ?? ''
  if (!value.trim()) return null
  const browser = BROWSERS.find(([pattern]) => pattern.test(value))?.[1] ?? 'Other browser'
  const system = SYSTEMS.find(([pattern]) => pattern.test(value))?.[1] ?? 'other system'
  return `${browser} on ${system}`
}
