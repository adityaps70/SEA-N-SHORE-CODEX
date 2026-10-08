import { createHmac } from 'node:crypto'

/**
 * Round 14 (2.6): per-email and per-IP limits for the three email flows (sign-up, confirmation-code
 * resend, password reset), counted in public.auth_email_events (migration 0065).
 *
 * Every attempt that passes the check leaves one row, even when Cognito then fails, so repeated
 * failures still count. Limited attempts are not recorded. The email (lower-cased, trimmed) and the
 * IP are stored only as keyed HMAC hashes; neither ever reaches a query string, a log line or the
 * table in clear. Attempts for one email and one IP are serialized with transaction-scoped
 * advisory locks, so quick parallel requests cannot all slip under the limit.
 */
export type AuthEmailAction = 'sign_up' | 'resend_code' | 'password_reset'

type AuthEmailLimit = {
  /** Most attempts for one email address inside the window. */
  perEmail: number
  /** Most attempts from one client IP inside the window. */
  perIp: number
  /** Rolling window, as a Postgres interval. */
  window: string
}

export const AUTH_EMAIL_LIMITS: Readonly<Record<AuthEmailAction, AuthEmailLimit>> = {
  sign_up: { perEmail: 3, perIp: 10, window: '1 hour' },
  resend_code: { perEmail: 5, perIp: 15, window: '1 hour' },
  password_reset: { perEmail: 5, perIp: 15, window: '1 hour' },
}

/** Rows older than this are no longer needed by any window and are pruned as attempts arrive. */
export const AUTH_EMAIL_EVENT_RETENTION = '2 days'
/** Upper bound on rows pruned per key per attempt, so one request never does unbounded work. */
export const AUTH_EMAIL_PRUNE_BATCH = 50

export type AuthEmailLimitDecision =
  | { allowed: true; counted: boolean }
  | { allowed: false; reason: 'rate_limited'; scope: 'email' | 'ip' }
  | { allowed: false; reason: 'unavailable' }

export type AuthEmailLimitInput = {
  action: AuthEmailAction
  email: string
  ip: string | null
}

export type AuthEmailLimiter = {
  consume(input: AuthEmailLimitInput): Promise<AuthEmailLimitDecision>
}

export type AuthEmailLimitQuery = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

type Warn = (tag: string, context: Record<string, string>) => void

const defaultWarn: Warn = (tag, context) => console.warn(tag, context)

const KEY_INFO = 'sea-n-shore/auth-email-limits/v1'

/**
 * The hashing key for this limiter, derived from an existing server secret so it differs from
 * every other use of that secret. Null without a usable secret.
 */
export function deriveAuthEmailLimitKey(secret: string | null | undefined): Buffer | null {
  const value = secret?.trim()
  if (!value || value.length < 32) return null
  return createHmac('sha256', value).update(KEY_INFO).digest()
}

/** Keyed, truncated hash of the lower-cased, trimmed email address. */
export function hashAuthEmail(email: string, key: Buffer) {
  return createHmac('sha256', key).update(`auth-email:${email.trim().toLowerCase()}`).digest('hex').slice(0, 32)
}

/** Keyed, truncated hash of the client IP (as the newsletter hashes it), or null without an IP. */
export function hashAuthIp(ip: string | null | undefined, key: Buffer) {
  const value = ip?.trim()
  if (!value) return null
  return createHmac('sha256', key).update(`auth-ip:${value}`).digest('hex').slice(0, 32)
}

const CONNECTIVITY_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
])

const CONNECTIVITY_SQLSTATES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '57014', // query_canceled (statement timeout)
  '28000', // invalid_authorization_specification (credentials mid-rotation)
  '28P01', // invalid_password (credentials mid-rotation)
])

const CONNECTIVITY_MESSAGES = /connection terminated|timeout exceeded when trying to connect|connection error|connect etimedout|aurora_secret_/i

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

/**
 * True for errors that mean the database cannot be reached or cannot serve right now: network
 * failures, SQLSTATE class 08 (connection exception) and 53 (insufficient resources, such as too
 * many connections), server shutdown or start-up, statement timeouts, failed database
 * authentication while credentials rotate, and the pool's own connection timeouts.
 */
export function isDatabaseConnectivityError(error: unknown) {
  const code = errorCode(error)
  if (code) {
    if (CONNECTIVITY_ERROR_CODES.has(code) || CONNECTIVITY_SQLSTATES.has(code)) return true
    if (/^(08|53)[0-9A-Z]{3}$/.test(code)) return true
  }
  const message = error instanceof Error ? error.message : ''
  return CONNECTIVITY_MESSAGES.test(message)
}

/** Only a SQLSTATE or a Node error code is ever logged, never a message (which could carry values). */
function safeErrorCode(error: unknown) {
  const code = errorCode(error)
  return code && /^[A-Z0-9_]{2,32}$/.test(code) ? code : 'none'
}

/**
 * Checks and records one attempt inside a transaction. Fails open (allowed, not counted) only when
 * the events table does not exist yet: it is looked up with to_regclass in the same statement as
 * the first lock, so a missing table never raises. Any query error propagates to the caller.
 */
export async function consumeAuthEmailLimit(
  query: AuthEmailLimitQuery,
  input: { action: AuthEmailAction; emailHash: string; ipHash: string | null },
  options: { warn?: Warn } = {},
): Promise<AuthEmailLimitDecision> {
  const limit = AUTH_EMAIL_LIMITS[input.action]
  const warn = options.warn ?? defaultWarn

  const [lock] = await query(
    `select pg_advisory_xact_lock(hashtext('auth_email_limit:' || $1::text || ':email:' || $2::text)) as locked,
            to_regclass('public.auth_email_events') is not null as ready`,
    [input.action, input.emailHash],
  )
  if (lock?.ready !== true) {
    warn('[auth_email_limit_skipped]', { action: input.action, reason: 'events_table_missing' })
    return { allowed: true, counted: false }
  }
  // Always email first, then IP: one lock order for every request, so two requests never deadlock.
  if (input.ipHash) {
    await query(
      `select pg_advisory_xact_lock(hashtext('auth_email_limit:' || $1::text || ':ip:' || $2::text)) as locked`,
      [input.action, input.ipHash],
    )
  }

  const [usage] = await query(
    `select
       (select count(*)
          from (
            select 1
            from public.auth_email_events e
            where e.action = $1
              and e.email_hash = $2
              and e.created_at > now() - $4::interval
            order by e.created_at desc
            limit $5
          ) recent)::int as email_total,
       (select count(*)
          from (
            select 1
            from public.auth_email_events e
            where $3::text is not null
              and e.action = $1
              and e.ip_hash = $3::text
              and e.created_at > now() - $4::interval
            order by e.created_at desc
            limit $6
          ) recent)::int as ip_total`,
    [input.action, input.emailHash, input.ipHash, limit.window, limit.perEmail, limit.perIp],
  )
  if (Number(usage?.email_total ?? 0) >= limit.perEmail) {
    return { allowed: false, reason: 'rate_limited', scope: 'email' }
  }
  if (input.ipHash && Number(usage?.ip_total ?? 0) >= limit.perIp) {
    return { allowed: false, reason: 'rate_limited', scope: 'ip' }
  }

  await query(
    `with pruned_email as (
       delete from public.auth_email_events
       where id in (
         select e.id
         from public.auth_email_events e
         where e.action = $1
           and e.email_hash = $2
           and e.created_at < now() - $4::interval
         order by e.created_at
         limit $5
       )
     ),
     pruned_ip as (
       delete from public.auth_email_events
       where id in (
         select e.id
         from public.auth_email_events e
         where $3::text is not null
           and e.action = $1
           and e.ip_hash = $3::text
           and e.created_at < now() - $4::interval
         order by e.created_at
         limit $5
       )
     )
     insert into public.auth_email_events (action, email_hash, ip_hash)
     values ($1, $2, $3::text)`,
    [input.action, input.emailHash, input.ipHash, AUTH_EMAIL_EVENT_RETENTION, AUTH_EMAIL_PRUNE_BATCH],
  )
  return { allowed: true, counted: true }
}

export type AuthEmailLimiterDependencies = {
  /** Runs `fn` in one database transaction (the advisory locks are held until it ends). */
  withTransaction<T>(fn: (query: AuthEmailLimitQuery) => Promise<T>): Promise<T>
  /** The hashing key (see deriveAuthEmailLimitKey), read at call time. */
  getKey(): Buffer | null
  /** False when no database is configured for this process (e.g. local development). */
  isDatabaseConfigured?(): boolean
  warn?: Warn
}

/**
 * The limiter the auth actions use. It never throws:
 * - fails open (allowed) when the events table is missing, when the database cannot be reached
 *   (see isDatabaseConnectivityError), when no database is configured, or when no hashing secret
 *   is configured, each with a warning that names only the action, a reason and an error code;
 * - fails closed ({ reason: 'unavailable' }) on any other error, such as a permission or SQL
 *   error, so a broken limiter is noticed instead of silently switched off.
 */
export function createAuthEmailLimiter(deps: AuthEmailLimiterDependencies): AuthEmailLimiter {
  const warn = deps.warn ?? defaultWarn

  return {
    async consume(input) {
      if (deps.isDatabaseConfigured && !deps.isDatabaseConfigured()) {
        warn('[auth_email_limit_skipped]', { action: input.action, reason: 'database_not_configured' })
        return { allowed: true, counted: false }
      }
      const key = deps.getKey()
      if (!key) {
        warn('[auth_email_limit_skipped]', { action: input.action, reason: 'hash_secret_missing' })
        return { allowed: true, counted: false }
      }
      const emailHash = hashAuthEmail(input.email, key)
      const ipHash = hashAuthIp(input.ip, key)

      try {
        const decision = await deps.withTransaction((query) => consumeAuthEmailLimit(
          query,
          { action: input.action, emailHash, ipHash },
          { warn },
        ))
        if (!decision.allowed && decision.reason === 'rate_limited') {
          warn('[auth_email_limited]', { action: input.action, scope: decision.scope })
        }
        return decision
      } catch (error) {
        if (isDatabaseConnectivityError(error)) {
          warn('[auth_email_limit_skipped]', {
            action: input.action,
            reason: 'database_unavailable',
            code: safeErrorCode(error),
          })
          return { allowed: true, counted: false }
        }
        warn('[auth_email_limit_failed]', { action: input.action, code: safeErrorCode(error) })
        return { allowed: false, reason: 'unavailable' }
      }
    },
  }
}
