import { withTransaction } from '@/lib/db/client'
import { getNewsletterConfig } from '@/features/newsletter/config'
import { createAuthEmailLimiter, deriveAuthEmailLimitKey, type AuthEmailLimiter } from './email-limits'

/**
 * The production limiter: Aurora through the shared pool, hashing with a key derived from
 * NEWSLETTER_TOKEN_SECRET (already injected into the web task and used to hash newsletter IPs).
 */
export function createProductionAuthEmailLimiter(): AuthEmailLimiter {
  return createAuthEmailLimiter({
    withTransaction: (fn) => withTransaction((client) => fn(async (text, values) => (await client.query(text, values)).rows)),
    getKey: () => deriveAuthEmailLimitKey(getNewsletterConfig().tokenSecret),
    isDatabaseConfigured: () => Boolean(process.env.AURORA_HOST?.trim()),
  })
}
