import { createHash } from 'node:crypto'
import type { CognitoAuthenticationResult } from '@/lib/auth/cognito-api'
import type { RefreshTokenLedger } from '@/lib/auth/cognito-session'
import { accessTokenOriginHash } from './session-guard'
import type { AccountQuery } from './types'

/**
 * Round I (I3): refresh token rotation and reuse detection.
 *
 * With rotation on, every refresh returns a new refresh token, and Cognito retires the old one after a grace period
 * (REFRESH_REUSE_GRACE_SECONDS, the same value as the app client's retry_grace_period_seconds). This ledger keeps a
 * SHA-256 of each refresh token (never the token) with the sign-in it belongs to (the access token's origin_jti hash,
 * as in public.auth_sessions). When a token that was already exchanged comes back after the grace period, someone
 * holds an old copy: the sign-in is ended (auth_sessions.reuse_detected_at), so the session check refuses every
 * token of it, the copy's and the member's alike, and the member signs in again.
 *
 * Requests that arrive together with the same token (parallel page loads) all fall inside the grace period and are
 * not reuse. The ledger never blocks a sign-in on its own failure: a database error is logged and the refresh goes
 * ahead, as it did before this release (Cognito still refuses retired tokens).
 */
export const REFRESH_REUSE_GRACE_SECONDS = 60
/** Retired token rows are kept this long, then pruned (Cognito has refused them since their grace period). */
export const REFRESH_LEDGER_RETENTION_DAYS = 30

export function refreshTokenHash(refreshToken: string) {
  return createHash('sha256').update(`cognito-refresh:${refreshToken}`).digest('hex')
}

function isMissingSchema(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : null
  // 42P01: the table is not there yet; 42703: the reuse_detected_at column is not there yet (before migration 0092).
  return code === '42P01' || code === '42703'
}

export function createRefreshTokenLedger(input: {
  query: AccountQuery
  warn?: (tag: string, context: Record<string, string>) => void
}): RefreshTokenLedger {
  const warn = input.warn ?? ((tag, context) => console.warn(tag, context))

  function failed(stage: string, error: unknown) {
    if (isMissingSchema(error)) return
    warn('[auth_refresh_ledger_unavailable]', { stage })
  }

  return {
    async check(refreshToken) {
      try {
        const rows = await input.query(
          `select origin_hash
           from public.auth_refresh_tokens
           where token_hash = $1
             and superseded_at is not null
             and superseded_at < now() - make_interval(secs => $2::int)`,
          [refreshTokenHash(refreshToken), REFRESH_REUSE_GRACE_SECONDS],
        )
        const originHash = rows[0]?.origin_hash
        if (typeof originHash !== 'string') return 'ok'
        await input.query(
          `update public.auth_sessions
           set reuse_detected_at = now()
           where token_origin_hash = $1
             and reuse_detected_at is null`,
          [originHash],
        )
        warn('[auth_refresh_reuse]', { action: 'session_ended' })
        return 'reused'
      } catch (error) {
        failed('check', error)
        return 'ok'
      }
    },

    /**
     * Round ARCH: Cognito refused this refresh token as reused (RefreshTokenReuseException). The sign-in it belongs to,
     * found through this ledger by the token's hash (never from an unverified cookie), is ended like a reuse we catch
     * ourselves (auth_sessions.reuse_detected_at), so the session check refuses every token of it.
     */
    async endSession(refreshToken) {
      try {
        const updated = await input.query(
          `update public.auth_sessions
           set reuse_detected_at = now()
           where reuse_detected_at is null
             and token_origin_hash = (
               select origin_hash from public.auth_refresh_tokens where token_hash = $1 limit 1
             )
           returning id`,
          [refreshTokenHash(refreshToken)],
        )
        if (updated.length > 0) warn('[auth_refresh_reuse]', { action: 'session_ended', source: 'cognito' })
      } catch (error) {
        failed('end_session', error)
      }
    },
    async record({ previousRefreshToken, authentication }: { previousRefreshToken: string; authentication: CognitoAuthenticationResult }) {
      const next = authentication.refreshToken
      if (!next || next === previousRefreshToken) return
      const originHash = accessTokenOriginHash(authentication.accessToken)
      if (!originHash) return
      try {
        // The old token is retired now (kept as retired if it already was); the new one is current.
        await input.query(
          `insert into public.auth_refresh_tokens (token_hash, origin_hash, superseded_at)
           values ($1, $3, now()), ($2, $3, null)
           on conflict (token_hash) do update
             set superseded_at = coalesce(public.auth_refresh_tokens.superseded_at, excluded.superseded_at)`,
          [refreshTokenHash(previousRefreshToken), refreshTokenHash(next), originHash],
        )
        await input.query(
          `delete from public.auth_refresh_tokens
           where origin_hash = $1
             and superseded_at < now() - make_interval(days => $2::int)`,
          [originHash, REFRESH_LEDGER_RETENTION_DAYS],
        )
      } catch (error) {
        failed('record', error)
      }
    },
  }
}
