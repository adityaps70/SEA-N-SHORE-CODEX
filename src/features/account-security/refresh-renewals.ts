import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { CognitoAuthenticationResult } from '@/lib/auth/cognito-api'
import { RENEWAL_SHARE_MS, type SharedRenewal, type SharedRenewalStore } from '@/lib/auth/refresh-single-flight'
import type { AccountQuery } from './types'

/**
 * Owner-approved 15 Nov: the shared store behind one renewal per refresh token (lib/auth/refresh-single-flight), in
 * public.auth_refresh_renewals (migration 0104).
 *
 * - Keyed by the SHA-256 of the refresh token, never the token.
 * - The renewed tokens are kept sealed with AES-256-GCM, a key derived from the server secret ('refresh-renewal'),
 *   bound to the row's hash. They are never logged and never stored unsealed.
 * - A row lives 60 seconds (Cognito's retry grace): it is never read after expires_at. The server that claimed it
 *   deletes it once that time is up, and every claim also deletes any expired rows a missed delete left behind.
 * - A claim left without a result for 10 seconds (its server stopped) can be taken over.
 *
 * Without the key there is no shared store (each server still renews once per token in memory). Every failure throws
 * to the caller, which then renews as before.
 */
export const RENEWAL_ABANDONED_SECONDS = 10
const SEAL_VERSION = 'v1'

type Sealed = { a: string; i?: string; r?: string; e: number; t: number }

function aad(tokenHash: string) {
  return Buffer.from(`sea-n-shore/auth-refresh-renewal/${SEAL_VERSION}/${tokenHash}`)
}

export function sealRenewal(key: Buffer, tokenHash: string, authentication: CognitoAuthenticationResult, issuedAt: number) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad(tokenHash))
  const payload: Sealed = { a: authentication.accessToken, e: authentication.expiresIn, t: issuedAt }
  if (authentication.idToken) payload.i = authentication.idToken
  if (authentication.refreshToken) payload.r = authentication.refreshToken
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return [SEAL_VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
}

/** The renewed tokens, with the access token's lifetime counted from when it was issued; null if it does not open. */
export function unsealRenewal(key: Buffer, tokenHash: string, sealed: string, now: number): CognitoAuthenticationResult | null {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== SEAL_VERSION || !iv || !tag || !body) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
    decipher.setAAD(aad(tokenHash))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')) as Sealed
    if (typeof payload.a !== 'string' || typeof payload.e !== 'number' || typeof payload.t !== 'number') return null
    const elapsed = Math.max(0, Math.floor((now - payload.t) / 1000))
    return {
      accessToken: payload.a,
      ...(payload.i ? { idToken: payload.i } : {}),
      ...(payload.r ? { refreshToken: payload.r } : {}),
      expiresIn: Math.max(60, payload.e - elapsed),
    }
  } catch {
    return null
  }
}

export function createRefreshRenewalStore(input: {
  query: AccountQuery
  key: Buffer | null
  now?: () => number
  /** Runs the row's delete once its 60 seconds are up (a timer that never keeps the process alive). */
  schedule?: (work: () => void, ms: number) => void
}): SharedRenewalStore | undefined {
  const { query, key } = input
  if (!key) return undefined
  const now = input.now ?? Date.now
  const schedule = input.schedule ?? ((work, ms) => { setTimeout(work, ms).unref?.() })
  const shareSeconds = Math.round(RENEWAL_SHARE_MS / 1000)

  return {
    async read(tokenHash): Promise<SharedRenewal> {
      const rows = await query(
        `select sealed from public.auth_refresh_renewals where token_hash = $1 and expires_at > now()`,
        [tokenHash],
      )
      if (!rows[0]) return { state: 'none' }
      const sealed = rows[0].sealed
      if (typeof sealed !== 'string') return { state: 'pending' }
      const authentication = unsealRenewal(key, tokenHash, sealed, now())
      // A row that does not open (another key) is ignored: this request renews as before.
      return authentication ? { state: 'ready', authentication } : { state: 'none' }
    },

    async claim(tokenHash) {
      // Cleanup: any row past its 60 seconds that a missed delete left behind.
      await query(`delete from public.auth_refresh_renewals where expires_at <= now()`)
      const rows = await query(
        `insert into public.auth_refresh_renewals (token_hash, expires_at)
         values ($1, now() + make_interval(secs => $2::int))
         on conflict (token_hash) do update
           set sealed = null, claimed_at = now(), expires_at = excluded.expires_at
           where public.auth_refresh_renewals.sealed is null
             and public.auth_refresh_renewals.claimed_at < now() - make_interval(secs => $3::int)
         returning token_hash`,
        [tokenHash, shareSeconds, RENEWAL_ABANDONED_SECONDS],
      )
      const won = rows.length === 1
      if (won) {
        schedule(() => {
          query(`delete from public.auth_refresh_renewals where token_hash = $1 and expires_at <= now()`, [tokenHash]).catch(() => undefined)
        }, RENEWAL_SHARE_MS + 1_000)
      }
      return won
    },

    async publish(tokenHash, authentication) {
      await query(
        `update public.auth_refresh_renewals set sealed = $2 where token_hash = $1 and sealed is null and expires_at > now()`,
        [tokenHash, sealRenewal(key, tokenHash, authentication, now())],
      )
    },

    async release(tokenHash) {
      await query(`delete from public.auth_refresh_renewals where token_hash = $1 and sealed is null`, [tokenHash])
    },
  }
}
