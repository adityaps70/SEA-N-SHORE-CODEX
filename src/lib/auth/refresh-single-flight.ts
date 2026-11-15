import { createHash } from 'node:crypto'
import type { CognitoAuthenticationResult } from './cognito-api'

/**
 * Owner-approved 15 Nov: one renewal per refresh token.
 *
 * A device opened again after its 60-minute access cookie expired sends several requests at once (the page, the
 * realtime ticket, polls, prefetches), and each used to renew the sign-in with the same refresh token. With refresh
 * token rotation on, Cognito answers each retry within its 60-second grace with a NEWER refresh token and refuses the
 * one it issued before. The browser keeps whichever response arrives last, so it could keep a refused token, and its
 * next renewal (an hour later, when the member came back to that device) signed it out.
 *
 * Now the first request for a refresh token renews it, and every other request carrying the same token gets that same
 * result: at once on this server (in memory), and through the shared store on the others. The shared store
 * (features/account-security/refresh-renewals) keeps the result sealed for at most 60 seconds. Whenever the store
 * cannot be used (no table, no key, a database error), the request renews as it did before this change.
 */

/** Cognito's retry grace (app client retry_grace_period_seconds): a renewal's result is shared this long. */
export const RENEWAL_SHARE_MS = 60_000
/** How long a request waits for a renewal another server is making, then renews itself (as before). */
export const RENEWAL_WAIT_MS = 2_500
export const RENEWAL_POLL_MS = 100

export type SharedRenewal =
  | { state: 'ready'; authentication: CognitoAuthenticationResult }
  | { state: 'pending' }
  | { state: 'none' }

/** Where servers leave a renewal for each other. Keys are SHA-256 hashes of the refresh token, never the token. */
export type SharedRenewalStore = {
  read(tokenHash: string): Promise<SharedRenewal>
  /** True when this server now owns the renewal for this token (nobody else is making it). */
  claim(tokenHash: string): Promise<boolean>
  publish(tokenHash: string, authentication: CognitoAuthenticationResult): Promise<void>
  /** The renewal failed: forget the claim so waiting requests renew themselves. */
  release(tokenHash: string): Promise<void>
}

export type RefreshRenewal = (
  refreshToken: string,
  refresh: () => Promise<CognitoAuthenticationResult>,
) => Promise<CognitoAuthenticationResult>

export function renewalTokenHash(refreshToken: string) {
  return createHash('sha256').update(`cognito-refresh-renewal:${refreshToken}`).digest('hex')
}

export function createRefreshSingleFlight(input: {
  shared?: SharedRenewalStore
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  shareMs?: number
  waitMs?: number
  pollMs?: number
  warn?: (tag: string, context: Record<string, string>) => void
} = {}): RefreshRenewal {
  const now = input.now ?? Date.now
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const shareMs = input.shareMs ?? RENEWAL_SHARE_MS
  const pollMs = input.pollMs ?? RENEWAL_POLL_MS
  const polls = Math.max(1, Math.ceil((input.waitMs ?? RENEWAL_WAIT_MS) / pollMs))
  const warn = input.warn ?? ((tag, context) => console.warn(tag, context))
  const local = new Map<string, { result: Promise<CognitoAuthenticationResult>; expiresAt: number }>()
  const warnedAt = new Map<string, number>()

  /** A store failure never fails the request; it is logged by stage only (at most once a minute per stage). */
  async function safely<T>(stage: string, work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work()
    } catch {
      const at = now()
      if ((warnedAt.get(stage) ?? -Infinity) <= at - 60_000) {
        warnedAt.set(stage, at)
        warn('[auth_renewal_share_unavailable]', { stage })
      }
      return undefined
    }
  }

  async function renewAndShare(shared: SharedRenewalStore, tokenHash: string, refresh: () => Promise<CognitoAuthenticationResult>) {
    let authentication: CognitoAuthenticationResult
    try {
      authentication = await refresh()
    } catch (error) {
      await safely('release', () => shared.release(tokenHash))
      throw error
    }
    await safely('publish', () => shared.publish(tokenHash, authentication))
    return authentication
  }

  async function throughShared(tokenHash: string, refresh: () => Promise<CognitoAuthenticationResult>) {
    const shared = input.shared
    if (!shared) return refresh()
    const known = await safely('read', () => shared.read(tokenHash))
    if (!known) return refresh()
    if (known.state === 'ready') return known.authentication
    if (known.state === 'none') {
      const won = await safely('claim', () => shared.claim(tokenHash))
      if (won === undefined) return refresh()
      if (won) return renewAndShare(shared, tokenHash, refresh)
    }
    // Another server is renewing this token: wait for its result.
    for (let poll = 0; poll < polls; poll += 1) {
      await sleep(pollMs)
      const seen = await safely('wait', () => shared.read(tokenHash))
      if (!seen) break
      if (seen.state === 'ready') return seen.authentication
      // Its renewal failed (the claim was released): renew here, as before, and get Cognito's own answer.
      if (seen.state === 'none') break
    }
    return refresh()
  }

  return function renew(refreshToken, refresh) {
    const at = now()
    for (const [key, entry] of local) if (entry.expiresAt <= at) local.delete(key)
    const tokenHash = renewalTokenHash(refreshToken)
    const existing = local.get(tokenHash)
    if (existing) return existing.result
    const result = throughShared(tokenHash, refresh)
    local.set(tokenHash, { result, expiresAt: at + shareMs })
    // A failed renewal is not shared later: the next request asks again (and gets Cognito's own answer).
    result.catch(() => {
      if (local.get(tokenHash)?.result === result) local.delete(tokenHash)
    })
    return result
  }
}
