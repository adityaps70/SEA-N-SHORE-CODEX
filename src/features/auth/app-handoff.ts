import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import type { AccountQuery } from '@/features/account-security/types'

/**
 * Round I (I3): Google sign-in for the iPhone Home Screen app.
 *
 * On iPhone, the Home Screen app and Safari keep separate cookies. Google sign-in leaves the app's scope (Cognito,
 * then Google), so iOS shows it in a Safari window, and the session it ends with lands in Safari, not in the app.
 * The handoff brings it back:
 *
 * 1. The app starts the sign-in (POST /api/auth/app-handoff). The OAuth state and PKCE verifier cookies are set in
 *    the APP's cookie jar, with a handoff cookie (id + secret). The app shows a 6-digit code.
 * 2. Google returns to /auth/google/callback in the Safari window, which has none of those cookies. The callback
 *    finds the handoff by the state's hash and keeps the authorization code (useless without the verifier, which
 *    only the app has; Cognito accepts it once, for 5 minutes).
 * 3. The Safari page asks for the code the app shows. That is the member confirming the sign-in is their own: a
 *    link someone else started never finishes on its own (the person who clicks it has no app showing the code).
 * 4. The app (polling GET /api/auth/app-handoff with its handoff cookie) exchanges the code with its verifier and
 *    gets its own session cookies. The handoff can be claimed once.
 *
 * If iOS brings the callback back into the app instead, the app's own cookies are there and the normal callback
 * signs it in; the handoff row simply expires. No token is ever stored: only hashes, and the authorization code
 * for at most 10 minutes (cleared when claimed).
 */
export const APP_HANDOFF_COOKIE = 'sns_app_handoff'
export const APP_HANDOFF_CONFIRM_COOKIE = 'sns_app_handoff_confirm'
export const APP_HANDOFF_TTL_SECONDS = 10 * 60
export const APP_HANDOFF_MAX_CODE_ATTEMPTS = 5

export type AppHandoffIntent = 'sign-in' | 'sign-up'
export type AppHandoffStatus = 'waiting' | 'confirm' | 'ready' | 'expired' | 'refused'

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function safeEqualHex(a: unknown, b: string) {
  if (typeof a !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/** "id.secret" from a handoff cookie, or null when it is not one. */
export function parseHandoffCookie(value: string | null | undefined) {
  const [id, secret, extra] = (value ?? '').split('.')
  if (extra !== undefined || !id || !secret || !ID_PATTERN.test(id) || !SECRET_PATTERN.test(secret)) return null
  return { id, secret }
}

export function normalizePairCode(value: unknown) {
  const digits = typeof value === 'string' ? value.replace(/[\s-]/g, '') : ''
  return /^\d{6}$/.test(digits) ? digits : null
}

/** "482 193": easier to read across two screens. */
export function formatPairCode(code: string) {
  return `${code.slice(0, 3)} ${code.slice(3)}`
}

export function createAppHandoffService(input: {
  query: AccountQuery
  /** A server-held key for the code hash (account security keys); null makes every start fail closed. */
  key: Buffer | null
  random?: (size: number) => Buffer
  pairCode?: () => string
  newId?: () => string
}) {
  const random = input.random ?? randomBytes
  const newId = input.newId ?? randomUUID
  const makePairCode = input.pairCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, '0'))

  function codeHash(id: string, code: string) {
    if (!input.key) throw new Error('app_handoff_unavailable')
    return createHmac('sha256', input.key).update(`app-handoff:${id}:${code}`).digest('hex')
  }

  return {
    /** Step 1. The caller sets the OAuth cookies and the handoff cookie (`${id}.${secret}`) in the app. */
    async start(request: { state: string; intent: AppHandoffIntent }) {
      if (!input.key) throw new Error('app_handoff_unavailable')
      await input.query(`delete from public.auth_app_handoffs where expires_at < now() - interval '1 hour'`)
      const id = newId()
      const secret = random(32).toString('base64url')
      const pairCode = makePairCode()
      await input.query(
        `insert into public.auth_app_handoffs (id, secret_hash, state_hash, pair_code_hash, intent, expires_at)
         values ($1, $2, $3, $4, $5, now() + make_interval(secs => $6::int))`,
        [id, sha256Hex(secret), sha256Hex(request.state), codeHash(id, pairCode), request.intent, APP_HANDOFF_TTL_SECONDS],
      )
      return { id, secret, pairCode, expiresInSeconds: APP_HANDOFF_TTL_SECONDS }
    },

    /** Step 2: the callback without the app's cookies. Null when the state belongs to no live handoff. */
    async recordCallback(request: { state: string; authorizationCode: string }) {
      if (request.authorizationCode.length < 1 || request.authorizationCode.length > 512) return null
      const confirmSecret = random(32).toString('base64url')
      const rows = await input.query(
        `update public.auth_app_handoffs
         set status = 'awaiting_code', auth_code = $2, confirm_hash = $3
         where state_hash = $1 and status = 'pending' and expires_at > now()
         returning id`,
        [sha256Hex(request.state), request.authorizationCode, sha256Hex(confirmSecret)],
      )
      const id = rows[0]?.id
      return typeof id === 'string' ? { id, confirmSecret } : null
    },

    /** Step 3: the code the app shows, typed in the Safari window that came back from Google. */
    async confirm(request: { id: string; confirmSecret: string; code: string }): Promise<'ready' | 'wrong' | 'refused' | 'expired'> {
      if (!ID_PATTERN.test(request.id)) return 'expired'
      const rows = await input.query(
        `select status, confirm_hash, pair_code_hash, failed_attempts, expires_at > now() as live
         from public.auth_app_handoffs where id = $1`,
        [request.id],
      )
      const row = rows[0]
      if (!row || row.live !== true || !safeEqualHex(row.confirm_hash, sha256Hex(request.confirmSecret))) return 'expired'
      if (row.status === 'refused') return 'refused'
      if (row.status === 'ready') return 'ready'
      if (row.status !== 'awaiting_code') return 'expired'
      if (safeEqualHex(row.pair_code_hash, codeHash(request.id, request.code))) {
        const updated = await input.query(
          `update public.auth_app_handoffs set status = 'ready' where id = $1 and status = 'awaiting_code' returning id`,
          [request.id],
        )
        return updated.length > 0 ? 'ready' : 'expired'
      }
      const failed = await input.query(
        `update public.auth_app_handoffs
         set failed_attempts = failed_attempts + 1,
             status = case when failed_attempts + 1 >= $2 then 'refused' else status end,
             auth_code = case when failed_attempts + 1 >= $2 then null else auth_code end
         where id = $1 and status = 'awaiting_code'
         returning status`,
        [request.id, APP_HANDOFF_MAX_CODE_ATTEMPTS],
      )
      return failed[0]?.status === 'refused' ? 'refused' : 'wrong'
    },

    /**
     * Step 4: the app asks how its handoff is going. `ready` hands over the authorization code exactly once (the row
     * is marked claimed and the code cleared in the same statement).
     */
    async claim(request: { id: string; secret: string }): Promise<
      { status: Exclude<AppHandoffStatus, 'ready'> } | { status: 'ready'; authorizationCode: string; intent: AppHandoffIntent }
    > {
      const secretHash = sha256Hex(request.secret)
      const claimed = await input.query(
        `with picked as (
           select id, auth_code, intent from public.auth_app_handoffs
           where id = $1 and secret_hash = $2 and status = 'ready' and expires_at > now()
           for update
         )
         update public.auth_app_handoffs h
         set status = 'claimed', auth_code = null
         from picked
         where h.id = picked.id
         returning picked.auth_code, picked.intent`,
        [request.id, secretHash],
      )
      const won = claimed[0]
      if (won && typeof won.auth_code === 'string') {
        return { status: 'ready', authorizationCode: won.auth_code, intent: won.intent === 'sign-up' ? 'sign-up' : 'sign-in' }
      }
      const rows = await input.query(
        `select status, expires_at > now() as live from public.auth_app_handoffs where id = $1 and secret_hash = $2`,
        [request.id, secretHash],
      )
      const row = rows[0]
      if (!row || row.live !== true || row.status === 'claimed') return { status: 'expired' }
      if (row.status === 'refused') return { status: 'refused' }
      return { status: row.status === 'awaiting_code' ? 'confirm' : 'waiting' }
    },
  }
}

export type AppHandoffService = ReturnType<typeof createAppHandoffService>
