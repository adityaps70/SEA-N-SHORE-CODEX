import { createHmac } from 'node:crypto'
import { getNewsletterConfig } from '@/features/newsletter/config'

/**
 * Round H (H3): keys for account security hashes, each derived from the existing server secret
 * NEWSLETTER_TOKEN_SECRET (already in the web task and used the same way by the auth email limits) with its own
 * label, so no two uses share a key. Null when the secret is missing or too short: callers fail closed for backup
 * codes and simply store no IP hash for sessions.
 *
 * Rotating NEWSLETTER_TOKEN_SECRET makes existing backup codes stop working (members generate new ones).
 */
export type AccountSecurityKeyPurpose = 'mfa-backup-codes' | 'session-ip' | 'mfa-challenge-binding' | 'app-handoff' | 'refresh-renewal'

export function deriveAccountSecurityKey(secret: string | null | undefined, purpose: AccountSecurityKeyPurpose): Buffer | null {
  const value = secret?.trim()
  if (!value || value.length < 32) return null
  return createHmac('sha256', value).update(`sea-n-shore/account-security/${purpose}/v1`).digest()
}

export function accountSecurityKey(purpose: AccountSecurityKeyPurpose): Buffer | null {
  return deriveAccountSecurityKey(getNewsletterConfig().tokenSecret, purpose)
}

/** Keyed, truncated hash of the client IP (never stored in clear), or null without an IP or key. */
export function hashSessionIp(ip: string | null | undefined, key: Buffer | null) {
  const value = ip?.trim()
  if (!value || !key) return null
  return createHmac('sha256', key).update(`session-ip:${value}`).digest('hex').slice(0, 32)
}
