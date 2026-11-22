import { createHash } from 'node:crypto'
import { decodeAccessTokenClaims } from '@/lib/auth/access-token-claims'
import type { SessionRequestContext } from './request-context'
import { SESSION_LIST_WINDOW_DAYS, type SessionRepository, type SessionSignInMethod } from './session-repository'

/**
 * Round H (H3): the revoked-session check, run where the verified user is resolved (getAwsVerifiedUser), so every
 * page, server action and API route refuses a signed-out device.
 *
 * The device is identified by the access token's origin_jti claim (read only after Cognito accepted the token). It
 * survives token refreshes and cannot be removed or swapped by the browser, unlike a cookie, so a stolen token
 * cannot escape a revocation by dropping a cookie. The first time a sign-in is seen its row is created: right after
 * sign-in (every sign-in path lands on /auth/post-sign-in, which resolves the user), and, for sessions that existed
 * before this release, on their first request after it.
 *
 * Each server keeps the answer for 30 seconds, so a device signed out elsewhere is refused within 30 seconds;
 * revocations made by this server apply at once. With the cache-clear hub (owner, 18 Nov) a sign-in ended on any
 * server is dropped from every server's cache at once. last_seen_at moves at most every 5 minutes.
 *
 * Round I (I3): a sign-in also ends when it has not been used for 30 days (idle), or when one of its refresh tokens
 * was used again after it had been exchanged for a newer one (refresh_reuse, see refresh-token-ledger).
 */

/** Why a session is refused: signed out (from this or another device, or a password change), idle, or token reuse. */
export type SessionEndReason = 'signed_out' | 'idle' | 'refresh_reuse'

export type SessionCheck =
  | { status: 'active'; sessionId: string }
  | { status: 'revoked'; sessionId: string; reason: SessionEndReason }
  | { status: 'untracked' }

type CacheEntry = { sessionId: string; profileId: string; ended: SessionEndReason | null; expiresAt: number }

export const SESSION_CHECK_CACHE_MS = 30 * 1000
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000
/** Round I (I3): the sliding session. A sign-in not used for this long is refused. */
export const SESSION_IDLE_LIMIT_MS = SESSION_LIST_WINDOW_DAYS * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 2000

export function sessionOriginHash(originJti: string) {
  return createHash('sha256').update(`cognito-origin:${originJti}`).digest('hex')
}

/** The origin hash of a (Cognito-verified) access token, or null when it carries no origin_jti. */
export function accessTokenOriginHash(accessToken: string) {
  const { originJti } = decodeAccessTokenClaims(accessToken)
  return originJti ? sessionOriginHash(originJti) : null
}

function signInMethodOf(accessToken: string): SessionSignInMethod {
  // The hosted (Google) sign-in always adds the openid scope; password sign-ins never get it.
  return decodeAccessTokenClaims(accessToken).scopes.includes('openid') ? 'google' : 'password'
}

function isMissingTable(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '42P01'
}

export function createSessionGuard(input: {
  repository: Pick<SessionRepository, 'findOrCreate' | 'touch'>
  now?: () => number
  cacheTtlMs?: number
  touchIntervalMs?: number
  idleLimitMs?: number
  hashIp?: (ip: string | null) => string | null
  warn?: (tag: string, context: Record<string, string>) => void
  /**
   * Owner (18 Nov): the cache-clear hub. A sign-in ended on any server (migration 0111: s:<origin hash>) is dropped
   * here at once, so a sign-out applies everywhere immediately instead of within 30 seconds. If the hub's listener is
   * lost, everything kept is dropped; the 30-second limit still applies as before.
   */
  clearHub?: { register(cache: { dropTag(tag: string): void; dropAll(): void }): unknown }
}) {
  const now = input.now ?? Date.now
  const cacheTtlMs = input.cacheTtlMs ?? SESSION_CHECK_CACHE_MS
  const touchIntervalMs = input.touchIntervalMs ?? SESSION_TOUCH_INTERVAL_MS
  const idleLimitMs = input.idleLimitMs ?? SESSION_IDLE_LIMIT_MS
  const warn = input.warn ?? ((tag, context) => console.warn(tag, context))
  const cache = new Map<string, CacheEntry>()
  input.clearHub?.register({
    dropTag(tag) {
      if (tag.startsWith('s:')) cache.delete(tag.slice(2))
    },
    dropAll() {
      cache.clear()
    },
  })
  let warnedUntracked = false
  let warnedMissingTable = false

  function remember(originHash: string, entry: CacheEntry) {
    if (cache.size >= MAX_ENTRIES) {
      const timestamp = now()
      for (const [key, value] of cache) if (value.expiresAt <= timestamp) cache.delete(key)
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
    }
    cache.set(originHash, entry)
  }

  function checkOf(sessionId: string, ended: SessionEndReason | null): SessionCheck {
    return ended ? { status: 'revoked', sessionId, reason: ended } : { status: 'active', sessionId }
  }

  return {
    async check(request: {
      accessToken: string
      profileId: string
      context: () => SessionRequestContext | Promise<SessionRequestContext>
    }): Promise<SessionCheck> {
      const originHash = accessTokenOriginHash(request.accessToken)
      if (!originHash) {
        if (!warnedUntracked) {
          warnedUntracked = true
          warn('[auth_session_untracked]', { reason: 'no_origin_jti' })
        }
        return { status: 'untracked' }
      }

      const timestamp = now()
      const cached = cache.get(originHash)
      if (cached && cached.expiresAt > timestamp && cached.profileId === request.profileId) {
        return checkOf(cached.sessionId, cached.ended)
      }

      try {
        const context = await request.context()
        const row = await input.repository.findOrCreate({
          profileId: request.profileId,
          originHash,
          signInMethod: signInMethodOf(request.accessToken),
          userAgentSummary: context.userAgentSummary,
          city: context.city,
          country: context.country,
          ipHash: input.hashIp ? input.hashIp(context.ip) : null,
        })
        // A sign-in that belongs to another profile is never accepted for this one.
        const idleFor = timestamp - row.lastSeenAt.getTime()
        const ended: SessionEndReason | null = row.revoked || row.profileId !== request.profileId
          ? 'signed_out'
          : row.reuseDetected
            ? 'refresh_reuse'
            : idleFor > idleLimitMs
              ? 'idle'
              : null
        if (!ended && idleFor >= touchIntervalMs) await input.repository.touch(row.id)
        remember(originHash, { sessionId: row.id, profileId: request.profileId, ended, expiresAt: now() + cacheTtlMs })
        return checkOf(row.id, ended)
      } catch (error) {
        // Until migration 0088 is applied the table does not exist: sessions are simply not tracked yet.
        if (isMissingTable(error)) {
          if (!warnedMissingTable) {
            warnedMissingTable = true
            warn('[auth_session_untracked]', { reason: 'table_missing' })
          }
          return { status: 'untracked' }
        }
        throw error
      }
    },

    /** This server applies its own revocations at once (other servers within the cache time). */
    markRevoked(sessionIds: readonly string[]) {
      if (sessionIds.length === 0) return
      const ids = new Set(sessionIds)
      for (const entry of cache.values()) if (ids.has(entry.sessionId)) entry.ended = 'signed_out'
    },

    /** The cached session id for this access token, if this server checked it recently. */
    cachedSessionId(accessToken: string) {
      const originHash = accessTokenOriginHash(accessToken)
      const cached = originHash ? cache.get(originHash) : undefined
      return cached && cached.expiresAt > now() ? cached.sessionId : null
    },
  }
}

export type SessionGuard = ReturnType<typeof createSessionGuard>
