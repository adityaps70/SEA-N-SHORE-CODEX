import { createHmac, timingSafeEqual } from 'node:crypto'
import { CognitoApiError, type CognitoAuthenticationResult, type CognitoSignInResult } from '@/lib/auth/cognito-api'
import { otpauthUri, type CurrentMfaStatus } from '@/features/auth/mfa'
import { normalizeAuthenticatorCode } from '@/features/auth/mfa-sign-in'
import { ADMIN_STEP_UP_MESSAGES, startAttempt } from './admin-step-up'
import { normalizeBackupCode } from './backup-codes'
import type { AccountQuery } from './types'

/**
 * Admin two-step (owner, 21 Nov): replace the authenticator app (a new phone) without turning two-step verification
 * off. Three steps, all in this signed-in session:
 * 1. Confirm it is you: the account password and a code from the current app (or one backup code). Cognito checks
 *    them through an email-and-password sign-in, whose tokens are revoked at once (as in the admin step-up). Failures
 *    count towards the same 5-per-15-minutes limit as the step-up. Success returns a pass for this session only,
 *    valid for 10 minutes (signed, never stored).
 * 2. Start the new app (Cognito AssociateSoftwareToken): a new QR code and key.
 * 3. Confirm a code from the new app (VerifySoftwareToken, then the app is turned on and preferred). The other
 *    sessions are signed out, the audit log records account.mfa_replaced, and the member is emailed.
 *
 * Unfinished replacement: as we read AWS's documentation, step 2 detaches the old app at once, so a member who stops
 * between 2 and 3 may have no working app. The page warns them to finish; admins and country admins are still held
 * by the admin MFA gate until an app is set up. This is to be confirmed with a test account before the feature is
 * switched on (AUTHENTICATOR_REPLACE_ENABLED); until then the button is not shown and every step refuses.
 */
export const REPLACEMENT_PASS_MINUTES = 10

export type ReplacementConfirmResult = { status: 'confirmed'; pass: string } | { status: 'error'; error: string; field?: 'password' | 'code' }
export type ReplacementStartResult = { status: 'ready'; secret: string; otpauthUri: string; qrDataUrl: string } | { status: 'error'; error: string }
export type ReplacementFinishResult = { status: 'replaced'; message: string } | { status: 'error'; error: string }

export const REPLACEMENT_MESSAGES = {
  off: 'Replacing an authenticator app is not switched on yet.',
  passExpired: 'Confirm it’s you again: this step expired after 10 minutes.',
  notEligible: 'Authenticator apps are for email and password sign-in. Sign in with your email and password to replace yours.',
  noApp: 'You have no authenticator app to replace. Set one up instead.',
  invalidCode: 'Enter the 6-digit code from your new authenticator app.',
  wrongNewCode: 'That code from the new app isn’t right or has expired. Enter the newest code.',
  failed: 'We couldn’t replace your authenticator app right now. Please try again.',
  replaced: 'Your new authenticator app is set up. Your old app no longer works, and your other devices were signed out.',
} as const

type Api = {
  signIn(input: { username: string; password: string }): Promise<CognitoSignInResult>
  respondToSoftwareTokenMfa(input: { username: string; session: string; code: string }): Promise<CognitoAuthenticationResult>
  revokeToken(refreshToken: string): Promise<void>
  associateSoftwareToken(accessToken: string): Promise<{ secretCode: string }>
  verifySoftwareToken(input: { accessToken: string; code: string; friendlyDeviceName?: string }): Promise<{ status: string }>
  setSoftwareTokenMfaPreference(input: { accessToken: string; enabled: boolean }): Promise<void>
}

export type ReplacementDeps = {
  enabled: boolean
  profileId: string
  key: Buffer | null
  now?: () => number
  getAccessToken: () => Promise<string | null>
  getAccount: () => Promise<{ username: string | null; status: CurrentMfaStatus } | null>
  currentSessionId: () => Promise<string | null>
  api: Api
  consumeBackupCode: (code: string) => Promise<boolean>
  query: AccountQuery
  renderQr: (uri: string) => Promise<string>
  /** Signs out every other session of the member and records account.mfa_replaced; returns the signed-out ids. */
  finish: (sessionId: string) => Promise<string[]>
  markRevoked?: (sessionIds: string[]) => void
  sendNotice: (input: { to: string | null; idempotencyKey: string }) => Promise<boolean>
}

function cognitoCode(error: unknown) {
  return error instanceof CognitoApiError ? error.code : null
}

function sign(key: Buffer, payload: string) {
  return createHmac('sha256', key).update(`authenticator-replace:${payload}`).digest('hex')
}

/** A pass for this member and session, valid until `expiresAt` (ms). */
export function issueReplacementPass(key: Buffer, input: { profileId: string; sessionId: string; expiresAt: number }) {
  const payload = `${input.profileId}.${input.sessionId}.${input.expiresAt}`
  return `${payload}.${sign(key, payload)}`
}

export function verifyReplacementPass(key: Buffer | null, pass: unknown, expected: { profileId: string; sessionId: string; now: number }) {
  if (!key || typeof pass !== 'string') return false
  const parts = pass.split('.')
  if (parts.length !== 4) return false
  const [profileId, sessionId, expiresAt, signature] = parts as [string, string, string, string]
  if (profileId !== expected.profileId || sessionId !== expected.sessionId) return false
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < expected.now) return false
  if (!/^[0-9a-f]{64}$/.test(signature)) return false
  const wanted = Buffer.from(sign(key, `${profileId}.${sessionId}.${expiresAt}`), 'hex')
  const actual = Buffer.from(signature, 'hex')
  return wanted.length === actual.length && timingSafeEqual(wanted, actual)
}

export function createAuthenticatorReplacement(deps: ReplacementDeps) {
  const now = deps.now ?? Date.now

  async function revokeQuietly(authentication: CognitoAuthenticationResult) {
    if (authentication.refreshToken) await deps.api.revokeToken(authentication.refreshToken).catch(() => undefined)
  }

  async function passIsValid(pass: unknown) {
    const sessionId = await deps.currentSessionId()
    if (!sessionId) return null
    return verifyReplacementPass(deps.key, pass, { profileId: deps.profileId, sessionId, now: now() }) ? sessionId : null
  }

  /** Step 1: the password and the current app's code (or a backup code). */
  async function confirm(input: { method: 'authenticator' | 'backup_code'; password: string; code: string }): Promise<ReplacementConfirmResult> {
    const fail = (error: string, field?: 'password' | 'code'): ReplacementConfirmResult => ({ status: 'error', error, ...(field ? { field } : {}) })
    if (!deps.enabled) return fail(REPLACEMENT_MESSAGES.off)
    if (!deps.key) return fail(REPLACEMENT_MESSAGES.failed)
    const password = input.password ?? ''
    if (!password) return fail(ADMIN_STEP_UP_MESSAGES.passwordMissing, 'password')
    const code = input.method === 'backup_code' ? normalizeBackupCode(input.code) : normalizeAuthenticatorCode(input.code)
    if (!code) return fail(input.method === 'backup_code' ? ADMIN_STEP_UP_MESSAGES.backupCodeInvalid : ADMIN_STEP_UP_MESSAGES.codeInvalid, 'code')

    const account = await deps.getAccount()
    if (!account) return fail(ADMIN_STEP_UP_MESSAGES.signedOut)
    const { status, username } = account
    if (status.kind !== 'eligible' || !status.email || !username) return fail(REPLACEMENT_MESSAGES.notEligible)
    if (!status.enabled) return fail(REPLACEMENT_MESSAGES.noApp)
    const sessionId = await deps.currentSessionId()
    if (!sessionId) return fail(ADMIN_STEP_UP_MESSAGES.notTracked)

    const attempt = await startAttempt(deps.query, deps.profileId)
    if (!attempt.allowed) return fail(ADMIN_STEP_UP_MESSAGES.tooMany)

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
      await revokeQuietly(challenge.authentication)
      return fail(REPLACEMENT_MESSAGES.noApp)
    }
    if (challenge.kind !== 'software-token-mfa') return fail(REPLACEMENT_MESSAGES.failed)
    if (challenge.username !== username) return fail(ADMIN_STEP_UP_MESSAGES.otherAccount, 'password')

    if (input.method === 'authenticator') {
      try {
        await revokeQuietly(await deps.api.respondToSoftwareTokenMfa({ username: challenge.username, session: challenge.session, code }))
      } catch (error) {
        if (['CodeMismatchException', 'NotAuthorizedException', 'ExpiredCodeException', 'EnableSoftwareTokenMFAException'].includes(cognitoCode(error) ?? '')) {
          return fail(ADMIN_STEP_UP_MESSAGES.wrongCode, 'code')
        }
        if (['TooManyRequestsException', 'LimitExceededException'].includes(cognitoCode(error) ?? '')) return fail(ADMIN_STEP_UP_MESSAGES.tooMany)
        throw error
      }
    } else if (!await deps.consumeBackupCode(code)) {
      return fail(ADMIN_STEP_UP_MESSAGES.wrongBackupCode, 'code')
    }

    await deps.query(`update public.admin_step_up_attempts set succeeded = true where id = $1::bigint and profile_id = $2`, [attempt.attemptId, deps.profileId])
    return { status: 'confirmed', pass: issueReplacementPass(deps.key, { profileId: deps.profileId, sessionId, expiresAt: now() + REPLACEMENT_PASS_MINUTES * 60_000 }) }
  }

  /** Step 2: the new app's QR code and key. */
  async function start(pass: unknown): Promise<ReplacementStartResult> {
    if (!deps.enabled) return { status: 'error', error: REPLACEMENT_MESSAGES.off }
    if (!await passIsValid(pass)) return { status: 'error', error: REPLACEMENT_MESSAGES.passExpired }
    const accessToken = await deps.getAccessToken()
    if (!accessToken) return { status: 'error', error: ADMIN_STEP_UP_MESSAGES.signedOut }
    const account = await deps.getAccount()
    if (!account || account.status.kind !== 'eligible') return { status: 'error', error: REPLACEMENT_MESSAGES.notEligible }
    try {
      const { secretCode } = await deps.api.associateSoftwareToken(accessToken)
      const uri = otpauthUri({ secret: secretCode, account: account.status.email ?? 'Sea N Shore member' })
      return { status: 'ready', secret: secretCode, otpauthUri: uri, qrDataUrl: await deps.renderQr(uri) }
    } catch (error) {
      if (['TooManyRequestsException', 'LimitExceededException'].includes(cognitoCode(error) ?? '')) return { status: 'error', error: ADMIN_STEP_UP_MESSAGES.tooMany }
      return { status: 'error', error: REPLACEMENT_MESSAGES.failed }
    }
  }

  /** Step 3: a code from the new app turns it on; then sign out other devices, audit and email. */
  async function finish(pass: unknown, codeInput: FormDataEntryValue | null): Promise<ReplacementFinishResult> {
    if (!deps.enabled) return { status: 'error', error: REPLACEMENT_MESSAGES.off }
    const sessionId = await passIsValid(pass)
    if (!sessionId) return { status: 'error', error: REPLACEMENT_MESSAGES.passExpired }
    const code = normalizeAuthenticatorCode(codeInput)
    if (!code) return { status: 'error', error: REPLACEMENT_MESSAGES.invalidCode }
    const accessToken = await deps.getAccessToken()
    if (!accessToken) return { status: 'error', error: ADMIN_STEP_UP_MESSAGES.signedOut }
    try {
      const verification = await deps.api.verifySoftwareToken({ accessToken, code, friendlyDeviceName: 'Authenticator app' })
      if (verification.status !== 'SUCCESS') return { status: 'error', error: REPLACEMENT_MESSAGES.wrongNewCode }
      await deps.api.setSoftwareTokenMfaPreference({ accessToken, enabled: true })
    } catch (error) {
      if (['CodeMismatchException', 'EnableSoftwareTokenMFAException'].includes(cognitoCode(error) ?? '')) return { status: 'error', error: REPLACEMENT_MESSAGES.wrongNewCode }
      if (['TooManyRequestsException', 'LimitExceededException'].includes(cognitoCode(error) ?? '')) return { status: 'error', error: ADMIN_STEP_UP_MESSAGES.tooMany }
      return { status: 'error', error: REPLACEMENT_MESSAGES.failed }
    }
    const revoked = await deps.finish(sessionId)
    deps.markRevoked?.(revoked)
    const account = await deps.getAccount().catch(() => null)
    await deps.sendNotice({ to: account?.status.email ?? null, idempotencyKey: `mfa-replaced/${deps.profileId}/${sessionId}/${Math.floor(now() / 60_000)}` })
    return { status: 'replaced', message: REPLACEMENT_MESSAGES.replaced }
  }

  return { confirm, start, finish }
}
