import { createHash } from 'node:crypto'
import type { CognitoAuthenticationResult } from '@/lib/auth/cognito-api'
import { REFRESH_MAX_AGE_SECONDS } from '@/lib/auth/cognito-cookies'
import type { RefreshTokenLedger } from '@/lib/auth/cognito-session'
import { sealRecovery, unsealRecovery } from './refresh-renewals'
import { accessTokenJtiHash, accessTokenOriginHash } from './session-guard'
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
 *
 * Owner (19 Nov): recovering a renewal the device never received (migration 0112). The server renews, but the device
 * closes the connection before the response arrives (a sleeping laptop, a phone switching apps, a background tab), so
 * it keeps the OLD refresh token, and its next use after the grace used to end the sign-in as reuse. Now `record`
 * keeps the NEW tokens sealed on the old token's row, and when the old token comes back (`check` says 'reused'),
 * `recover` hands them back, at most once, so the app renews from the new refresh token instead.
 *
 * Why this is safe: recovery is only possible while no request has ever arrived with the new access token
 * (auth_sessions.renewal_seen_at, set by the session check on the first such request), so the device never got it.
 * After that, an old token coming back ends the sign-in exactly as before. Only the latest renewal of a sign-in is
 * kept (older rows are cleared), each row is recovered once (recovered_at, in one atomic statement), and nothing is
 * recovered for a sign-in that was signed out or already ended. A thief holding the old token can therefore obtain no
 * more than the old token already gave (the one renewal it was exchanged for), and whoever presents the old token
 * second, the member or the thief, ends the sign-in for both, as reuse did before.
 */
export const REFRESH_REUSE_GRACE_SECONDS = 60
/** Retired token rows are kept this long, then pruned (Cognito has refused them since their grace period). */
export const REFRESH_LEDGER_RETENTION_DAYS = 30
/**
 * How long a kept renewal can be recovered: the refresh cookie's lifetime, 30 days from each renewal. Cognito's own
 * refresh token validity is 3650 days, so the cookie is the earlier limit, and the kept set never outlives the
 * refresh token it replaces (the owner's condition). It also matches REFRESH_LEDGER_RETENTION_DAYS, after which the
 * old row is pruned anyway.
 */
export const REFRESH_RECOVERY_SECONDS = REFRESH_MAX_AGE_SECONDS

export function refreshTokenHash(refreshToken: string) {
  return createHash('sha256').update(`cognito-refresh:${refreshToken}`).digest('hex')
}

function isMissingSchema(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : null
  // 42P01: the table is not there yet; 42703: a column is not there yet (reuse_detected_at before migration 0092, the
  // recovery columns before 0112).
  return code === '42P01' || code === '42703'
}

export function createRefreshTokenLedger(input: {
  query: AccountQuery
  /** Owner (19 Nov): the 'refresh-recovery' key. Without it nothing is kept for recovery and `recover` finds nothing. */
  recoveryKey?: Buffer | null
  now?: () => number
  warn?: (tag: string, context: Record<string, string>) => void
}): RefreshTokenLedger {
  const warn = input.warn ?? ((tag, context) => console.warn(tag, context))
  const now = input.now ?? Date.now
  const recoveryKey = input.recoveryKey ?? null

  function failed(stage: string, error: unknown) {
    if (isMissingSchema(error)) return
    warn('[auth_refresh_ledger_unavailable]', { stage })
  }

  /**
   * After a renewal: the new tokens are kept sealed on the old token's row (bound to its hash) for
   * REFRESH_RECOVERY_SECONDS, every other row of the sign-in loses what it kept (only the latest renewal can be
   * recovered), and the sign-in remembers the new access token's id, not yet seen. One statement.
   */
  async function keepForRecovery(previousRefreshToken: string, authentication: CognitoAuthenticationResult, originHash: string) {
    if (!recoveryKey) return
    const jtiHash = accessTokenJtiHash(authentication.accessToken)
    if (!jtiHash) return
    const previousHash = refreshTokenHash(previousRefreshToken)
    try {
      await input.query(
        `with kept as (
           update public.auth_refresh_tokens
           set recovery_sealed = $2, recovery_expires_at = now() + make_interval(secs => $4::int)
           where token_hash = $1
             and origin_hash = $3
             and recovered_at is null
           returning token_hash
         ), cleared as (
           update public.auth_refresh_tokens
           set recovery_sealed = null, recovery_expires_at = null
           where origin_hash = $3
             and token_hash <> $1
             and recovery_sealed is not null
           returning token_hash
         )
         update public.auth_sessions
         set renewal_seen_at = case when renewal_jti_hash is distinct from $5 then null else renewal_seen_at end,
             renewal_jti_hash = $5
         where token_origin_hash = $3`,
        [previousHash, sealRecovery(recoveryKey, previousHash, authentication, now()), originHash, REFRESH_RECOVERY_SECONDS, jtiHash],
      )
    } catch (error) {
      failed('recovery_keep', error)
    }
  }

  return {
    /** 'reused': this token was exchanged for a newer one more than the grace period ago. Ends nothing by itself. */
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
        return typeof rows[0]?.origin_hash === 'string' ? 'reused' : 'ok'
      } catch (error) {
        failed('check', error)
        return 'ok'
      }
    },

    /**
     * Owner (19 Nov): the renewal this (reused) token was exchanged for, if it can still be recovered: kept on this
     * token's row, never recovered before, not past recovery_expires_at, and its sign-in neither ended nor seen with
     * the new access token. One atomic statement takes it: the row is locked and its kept set cleared as it is read,
     * so of two requests at once (any servers) at most one gets it. Null otherwise, and on any failure.
     */
    async recover(refreshToken) {
      if (!recoveryKey) return null
      const tokenHash = refreshTokenHash(refreshToken)
      try {
        const rows = await input.query(
          `with target as (
             select t.token_hash, t.recovery_sealed
             from public.auth_refresh_tokens t
             join public.auth_sessions s on s.token_origin_hash = t.origin_hash
             where t.token_hash = $1
               and t.recovery_sealed is not null
               and t.recovered_at is null
               and t.recovery_expires_at > now()
               and s.renewal_seen_at is null
               and s.revoked_at is null
               and s.reuse_detected_at is null
             for update of t
           )
           update public.auth_refresh_tokens r
           set recovered_at = now(), recovery_sealed = null, recovery_expires_at = null
           from target
           where r.token_hash = target.token_hash
             and r.recovered_at is null
           returning target.recovery_sealed as sealed`,
          [tokenHash],
        )
        const sealed = rows[0]?.sealed
        if (typeof sealed !== 'string') return null
        // A set that does not open (another key) is spent all the same: the sign-in ends as reuse.
        const authentication = unsealRecovery(recoveryKey, tokenHash, sealed, now())
        return authentication?.refreshToken ? authentication : null
      } catch (error) {
        failed('recover', error)
        return null
      }
    },

    /** The reused token could not be recovered: the sign-in it belongs to ends (auth_sessions.reuse_detected_at). */
    async endReused(refreshToken) {
      try {
        await input.query(
          `update public.auth_sessions
           set reuse_detected_at = now()
           where reuse_detected_at is null
             and token_origin_hash = (
               select origin_hash from public.auth_refresh_tokens where token_hash = $1 limit 1
             )`,
          [refreshTokenHash(refreshToken)],
        )
        warn('[auth_refresh_reuse]', { action: 'session_ended' })
      } catch (error) {
        failed('end_reused', error)
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
        return
      }
      await keepForRecovery(previousRefreshToken, authentication, originHash)
    },
  }
}
