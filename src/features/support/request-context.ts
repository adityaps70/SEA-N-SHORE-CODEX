import { createHmac } from 'node:crypto'
import { trustedClientIp } from '@/lib/http/client-ip'

/**
 * Round H (H7): the keyed IP hash the Contact form is rate limited by. The key is derived from the
 * newsletter token secret (as the sign-up email limits do) with its own label, so the hash matches no
 * other use of that secret. The IP itself is never stored or logged; without a usable secret there is
 * no IP hash and only the per-address and per-member limits apply.
 */
const KEY_INFO = 'sea-n-shore/support-ticket-limits/v1'

export function supportIpHashKey(secret: string | null | undefined): Buffer | null {
  const value = secret?.trim()
  if (!value || value.length < 32) return null
  return createHmac('sha256', value).update(KEY_INFO).digest()
}

export function hashSupportIp(ip: string | null | undefined, key: Buffer | null) {
  const value = ip?.trim()
  if (!value || !key) return null
  return createHmac('sha256', key).update(`support-ip:${value}`).digest('hex').slice(0, 32)
}

export function supportIpHashFromHeaders(headers: Pick<Headers, 'get'>, secret: string | null | undefined) {
  return hashSupportIp(trustedClientIp(headers), supportIpHashKey(secret))
}
