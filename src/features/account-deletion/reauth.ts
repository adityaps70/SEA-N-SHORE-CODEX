import { isPhoneLoginEmail } from '@/features/auth/phone-login-email'
import type { SignInIdentity } from '@/features/auth/sign-in-identity-repository'

/**
 * How a member proves it is really them before deleting the account, decided from the
 * session they are signed in with:
 * - email sign-in             -> their password (as before)
 * - legacy mobile-only sign-in -> unavailable: mobile-number sign-in and SMS codes are retired
 *                                (Round 15), so support deletes these accounts on request
 * - Google sign-in (no password at Sea N Shore) -> a Google sign-in within the last
 *                                10 minutes, read from the access token's auth_time claim
 *                                (Cognito keeps the original sign-in time across refreshes)
 */

export const RECENT_SIGN_IN_MINUTES = 10

export type DeletionReauth =
  | { method: 'password' }
  | { method: 'recent_sign_in'; username: string; fresh: boolean }
  | { method: 'unavailable' }

/** What the delete-account screen needs (no usernames). */
export type DeletionReauthView =
  | { method: 'password' }
  | { method: 'recent_sign_in'; fresh: boolean }
  | { method: 'unavailable' }

export function reauthView(reauth: DeletionReauth): DeletionReauthView {
  if (reauth.method === 'recent_sign_in') return { method: 'recent_sign_in', fresh: reauth.fresh }
  return { method: reauth.method }
}

const FEDERATED_USERNAME = /^(google|facebook|signinwithapple|loginwithamazon)_/i

/** Claims of a Cognito access token (already validated with Cognito by the session check). */
export function accessTokenClaims(accessToken: string | null | undefined): { authTime: Date | null; username: string | null } {
  const payload = accessToken?.split('.')[1]
  if (!payload) return { authTime: null, username: null }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { auth_time?: unknown; username?: unknown }
    return {
      authTime: typeof decoded.auth_time === 'number' && Number.isFinite(decoded.auth_time) ? new Date(decoded.auth_time * 1000) : null,
      username: typeof decoded.username === 'string' && decoded.username ? decoded.username : null,
    }
  } catch {
    return { authTime: null, username: null }
  }
}

/** Pure: which check applies to this session. */
export function resolveDeletionReauth(input: {
  /** The identity_accounts row of the Cognito user this session belongs to. */
  identity: Pick<SignInIdentity, 'email' | 'providerUsername'> | null
  sessionEmail: string | null
  sessionUsername: string | null
  authTime: Date | null
  now: Date
}): DeletionReauth {
  const username = input.identity?.providerUsername ?? input.sessionUsername
  const email = input.identity?.email ?? input.sessionEmail
  if (username && FEDERATED_USERNAME.test(username)) {
    const fresh = Boolean(input.authTime && input.now.getTime() - input.authTime.getTime() <= RECENT_SIGN_IN_MINUTES * 60_000
      && input.authTime.getTime() <= input.now.getTime() + 60_000)
    return { method: 'recent_sign_in', username, fresh }
  }
  // A legacy mobile-only sign-in has no password the member knows, and SMS codes are retired.
  if (isPhoneLoginEmail(email)) return { method: 'unavailable' }
  return email ? { method: 'password' } : { method: 'unavailable' }
}
