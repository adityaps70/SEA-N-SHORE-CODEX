import { CognitoApiError, type CognitoAuthenticationResult, type CognitoSignInResult } from '@/lib/auth/cognito-api'
import { canStepUpForAdmin, satisfiesAdminMfa, type CurrentMfaStatus } from '@/features/auth/mfa'
import { normalizeAuthenticatorCode } from '@/features/auth/mfa-sign-in'
import { normalizeBackupCode } from './backup-codes'
import type { AccountQuery } from './types'

/**
 * Hotfix P1: a platform administrator signed in with Google opens admin pages after confirming it is them, for
 * that sign-in only.
 *
 * Cognito never asks a Google sign-in for the authenticator code, and it can only check an authenticator code as
 * part of an email-and-password sign-in. So the step-up is exactly that sign-in, done in place: the account
 * password, then the authenticator app code (or one backup code instead). Cognito must answer for the same account
 * as this session; the tokens of that check are revoked at once, so no extra session is left behind. On success
 * the current auth_sessions row gets admin_step_up_at, which lasts as long as the sign-in (30-day sliding window)
 * and ends with sign-out, sign-out of other devices or a password change.
 *
 * At most 5 failed attempts per 15 minutes (counted in admin_step_up_attempts; the 6th is refused before Cognito is
 * asked). Codes and passwords are never stored or logged.
 */

export const ADMIN_STEP_UP_MAX_FAILURES = 5
export const ADMIN_STEP_UP_WINDOW_MINUTES = 15

export type AdminStepUpMethod = 'authenticator' | 'backup_code'

export type AdminStepUpResult =
  | { status: 'verified' }
  | { status: 'error'; error: string; field?: 'password' | 'code' }

export const ADMIN_STEP_UP_MESSAGES = {
  notAdmin: 'Only Sea N Shore administrators and country admins can do this.',
  signedOut: 'Your session has ended. Sign in again, then try again.',
  federated: "Your Google sign-in isn't linked to your email-and-password account yet, so we can't confirm your authenticator app from it. Sign in with your email and password for now.",
  noAuthenticator: 'Set up an authenticator app first. Admin pages always need one.',
  notTracked: "We couldn't find this sign-in. Sign out, sign in again, then try once more.",
  passwordMissing: 'Enter your Sea N Shore password.',
  codeInvalid: 'Enter the 6-digit code from your authenticator app.',
  backupCodeInvalid: 'Enter one of your 10-character backup codes.',
  wrongPassword: "That password isn't right. Check it and try again.",
  wrongCode: "That code isn't right or has expired. Enter the newest code from your authenticator app.",
  wrongBackupCode: "That backup code isn't right or was already used.",
  otherAccount: 'That password belongs to a different account. Use the password of the account you are signed in with.',
  tooMany: `Too many attempts. Wait ${ADMIN_STEP_UP_WINDOW_MINUTES} minutes, then try again.`,
  failed: "We couldn't confirm it's you right now. Nothing was changed. Please try again.",
} as const

type SignInApi = {
  signIn(input: { username: string; password: string }): Promise<CognitoSignInResult>
  respondToSoftwareTokenMfa(input: { username: string; session: string; code: string }): Promise<CognitoAuthenticationResult>
  revokeToken(refreshToken: string): Promise<void>
}

export type AdminStepUpDeps = {
  profileId: string
  isPlatformAdministrator: () => Promise<boolean>
  /** The session's own Cognito account: its username (to match Cognito's answer) and status. */
  getAccount: () => Promise<{ username: string | null; status: CurrentMfaStatus } | null>
  currentSessionId: () => Promise<string | null>
  api: SignInApi
  /** Uses one backup code of this member (atomic). False when it does not match or was used. */
  consumeBackupCode: (code: string) => Promise<boolean>
  query: AccountQuery
  audit?: (method: AdminStepUpMethod) => Promise<void>
}

/**
 * Counts this attempt as a failure before anything is checked (so attempts sent in parallel all count), and says
 * whether the member was already at the limit. A successful attempt is turned into a success afterwards.
 */
async function startAttempt(query: AccountQuery, profileId: string): Promise<{ attemptId: string; allowed: boolean }> {
  const rows = await query(
    `with recent as (
       select count(*)::int as failures from public.admin_step_up_attempts
       where profile_id = $1 and not succeeded and created_at > now() - make_interval(mins => $2::int)
     )
     insert into public.admin_step_up_attempts (profile_id, succeeded)
     values ($1, false)
     returning id::text as id, (select failures from recent) as failures`,
    [profileId, ADMIN_STEP_UP_WINDOW_MINUTES],
  )
  await query(`delete from public.admin_step_up_attempts where profile_id = $1 and created_at < now() - interval '30 days'`, [profileId])
  return { attemptId: String(rows[0]?.id), allowed: Number(rows[0]?.failures ?? 0) < ADMIN_STEP_UP_MAX_FAILURES }
}

/** True when this sign-in made the step-up and is still live. */
export async function sessionHasAdminStepUp(query: AccountQuery, input: { profileId: string; sessionId: string }) {
  const rows = await query(
    `select 1 from public.auth_sessions
     where id = $1 and profile_id = $2 and admin_step_up_at is not null and revoked_at is null and reuse_detected_at is null`,
    [input.sessionId, input.profileId],
  )
  return rows.length === 1
}

function cognitoCode(error: unknown) {
  return error instanceof CognitoApiError ? error.code : null
}

export function createAdminStepUp(deps: AdminStepUpDeps) {
  async function revokeQuietly(authentication: CognitoAuthenticationResult) {
    if (authentication.refreshToken) await deps.api.revokeToken(authentication.refreshToken).catch(() => undefined)
  }

  return async function stepUp(input: { method: AdminStepUpMethod; password: string; code: string }): Promise<AdminStepUpResult> {
    const fail = (error: string, field?: 'password' | 'code'): AdminStepUpResult => ({ status: 'error', error, ...(field ? { field } : {}) })
    const password = input.password ?? ''
    if (!password) return fail(ADMIN_STEP_UP_MESSAGES.passwordMissing, 'password')
    const code = input.method === 'backup_code' ? normalizeBackupCode(input.code) : normalizeAuthenticatorCode(input.code)
    if (!code) return fail(input.method === 'backup_code' ? ADMIN_STEP_UP_MESSAGES.backupCodeInvalid : ADMIN_STEP_UP_MESSAGES.codeInvalid, 'code')

    if (!await deps.isPlatformAdministrator()) return fail(ADMIN_STEP_UP_MESSAGES.notAdmin)
    const account = await deps.getAccount()
    if (!account) return fail(ADMIN_STEP_UP_MESSAGES.signedOut)
    const { status, username } = account
    if (satisfiesAdminMfa(status)) return { status: 'verified' }
    if (status.kind !== 'eligible') return fail(ADMIN_STEP_UP_MESSAGES.federated)
    if (!status.enabled) return fail(ADMIN_STEP_UP_MESSAGES.noAuthenticator)
    if (!canStepUpForAdmin(status) || !status.email || !username) return fail(ADMIN_STEP_UP_MESSAGES.failed)
    const sessionId = await deps.currentSessionId()
    if (!sessionId) return fail(ADMIN_STEP_UP_MESSAGES.notTracked)

    const attempt = await startAttempt(deps.query, deps.profileId)
    if (!attempt.allowed) return fail(ADMIN_STEP_UP_MESSAGES.tooMany)
    // From here the attempt already counts as a failure; only a full success turns it into a success.

    // 1. The account password. With an authenticator app on, Cognito answers with the app challenge, not tokens.
    let challenge: CognitoSignInResult
    try {
      challenge = await deps.api.signIn({ username: status.email, password })
    } catch (error) {
      if (['NotAuthorizedException', 'UserNotFoundException', 'PasswordResetRequiredException'].includes(cognitoCode(error) ?? '')) {
        return fail(ADMIN_STEP_UP_MESSAGES.wrongPassword, 'password')
      }
      if (['TooManyRequestsException', 'LimitExceededException'].includes(cognitoCode(error) ?? '')) return fail(ADMIN_STEP_UP_MESSAGES.tooMany)
      throw error
    }
    if (challenge.kind === 'authenticated') {
      // Cognito no longer asks this account for its app: refuse, and leave no extra sign-in behind.
      await revokeQuietly(challenge.authentication)
      return fail(ADMIN_STEP_UP_MESSAGES.noAuthenticator)
    }
    if (challenge.kind !== 'software-token-mfa') return fail(ADMIN_STEP_UP_MESSAGES.failed)
    // Cognito must answer for the account this session belongs to (one email can only reach one account, but the
    // check is cheap and keeps another account's password from unlocking this session).
    if (challenge.username !== username) return fail(ADMIN_STEP_UP_MESSAGES.otherAccount, 'password')

    // 2. The authenticator code (checked by Cognito) or one backup code (checked here, used once).
    if (input.method === 'authenticator') {
      let authentication: CognitoAuthenticationResult
      try {
        authentication = await deps.api.respondToSoftwareTokenMfa({ username: challenge.username, session: challenge.session, code })
      } catch (error) {
        if (['CodeMismatchException', 'NotAuthorizedException', 'ExpiredCodeException', 'EnableSoftwareTokenMFAException'].includes(cognitoCode(error) ?? '')) {
          return fail(ADMIN_STEP_UP_MESSAGES.wrongCode, 'code')
        }
        if (['TooManyRequestsException', 'LimitExceededException'].includes(cognitoCode(error) ?? '')) return fail(ADMIN_STEP_UP_MESSAGES.tooMany)
        throw error
      }
      await revokeQuietly(authentication)
    } else if (!await deps.consumeBackupCode(code)) {
      return fail(ADMIN_STEP_UP_MESSAGES.wrongBackupCode, 'code')
    }

    await deps.query(`update public.auth_sessions set admin_step_up_at = now() where id = $1 and profile_id = $2 and revoked_at is null`, [sessionId, deps.profileId])
    await deps.query(`update public.admin_step_up_attempts set succeeded = true where id = $1::bigint and profile_id = $2`, [attempt.attemptId, deps.profileId])
    await deps.audit?.(input.method)
    return { status: 'verified' }
  }
}
