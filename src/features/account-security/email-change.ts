import { z } from 'zod'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import type { MfaAccountKind } from '@/features/auth/mfa'
import { DISPOSABLE_EMAIL_MESSAGE } from '@/lib/errors/user-messages'
import type { AccountSecurityAction } from './rate-limit'

/**
 * Round H (H3): Settings › Account › Change email. The new address is verified before anything switches:
 *
 * 1. requestEmailChange: Cognito UpdateUserAttributes with the new address. The user pool keeps the OLD address
 *    active until the new one is verified (infra/aws/app/auth.tf: user_attribute_update_settings,
 *    attributes_require_verification_before_update = ["email"]), and Cognito sends a code to the new address.
 *    Nothing in the app's database changes at this step.
 * 2. confirmEmailChange: Cognito VerifyUserAttribute with that code switches the address. Only then is the app's
 *    copy (identity_accounts.email) updated, a notice queued to the OLD address (new one masked) and an audit row
 *    written, in one transaction.
 *
 * Code sends and verifications are rate-limited per member (account_security_attempts) on top of Cognito's own limits.
 */

export type EmailChangeState =
  | { status: 'idle' }
  | { status: 'error'; error: string; field?: 'email' | 'code'; pendingEmail?: string }
  | { status: 'code-sent'; pendingEmail: string; message: string }
  | { status: 'changed'; email: string; message: string }

export const EMAIL_CHANGE_MESSAGES = {
  sessionExpired: 'Your session expired. Please sign in again.',
  invalidEmail: 'Enter a valid email address.',
  sameEmail: 'That is already your email address.',
  federated: 'You sign in with Google, so your email comes from your Google account. Change it there.',
  phone: 'Sign in with your email and password to change your email address.',
  unavailableEmail: 'That email address can’t be used. Try a different one.',
  deliveryFailed: 'We couldn’t send a code to that address. Check it and try again.',
  invalidCode: 'Enter the 6-digit code we sent to your new address.',
  wrongCode: 'That code didn’t match. Check the latest email and try again.',
  expiredCode: 'That code has expired. Send a new code and try again.',
  nothingPending: 'There is no email change waiting. Enter your new address again.',
  tooMany: 'Too many attempts. Please wait a while and try again.',
  failed: 'We couldn’t change your email. Please try again.',
} as const

const emailSchema = z.string().trim().toLowerCase().email().max(254)

type AccountState = { kind: MfaAccountKind; email: string | null }

type Dependencies = {
  getAccessToken(): Promise<string | null>
  /** Uncached: the account kind and the email Cognito holds right now. */
  getAccountState(accessToken: string): Promise<AccountState>
  requestEmailChange(input: { accessToken: string; email: string }): Promise<void>
  verifyEmailChange(input: { accessToken: string; code: string }): Promise<void>
  isDisposableEmail(email: string): boolean
  allowAttempt(action: Extract<AccountSecurityAction, 'email_change_code' | 'email_change_verify'>): Promise<boolean>
  /** Updates the app's copy, queues the notice to the old address and audits, in one transaction. */
  recordChange(input: { oldEmail: string | null; newEmail: string }): Promise<void>
}

function cognitoError(error: unknown, ...codes: string[]) {
  return error instanceof CognitoApiError && codes.includes(error.code)
}

function sessionExpired(error: unknown) {
  return error instanceof CognitoApiError && error.code === 'NotAuthorizedException'
}

export function createEmailChange(deps: Dependencies) {
  async function accountFor(accessToken: string) {
    const state = await deps.getAccountState(accessToken)
    if (state.kind === 'federated') return { error: EMAIL_CHANGE_MESSAGES.federated, state }
    if (state.kind === 'phone') return { error: EMAIL_CHANGE_MESSAGES.phone, state }
    return { error: null, state }
  }

  return {
    async requestEmailChange(_state: EmailChangeState, formData: FormData): Promise<EmailChangeState> {
      const parsed = emailSchema.safeParse(formData.get('email'))
      if (!parsed.success) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.invalidEmail, field: 'email' }
      const email = parsed.data
      if (deps.isDisposableEmail(email)) return { status: 'error', error: DISPOSABLE_EMAIL_MESSAGE, field: 'email' }

      const accessToken = await deps.getAccessToken()
      if (!accessToken) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.sessionExpired }

      try {
        const account = await accountFor(accessToken)
        if (account.error) return { status: 'error', error: account.error }
        if (account.state.email?.toLowerCase() === email) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.sameEmail, field: 'email' }
        if (!(await deps.allowAttempt('email_change_code'))) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.tooMany }
        await deps.requestEmailChange({ accessToken, email })
        return { status: 'code-sent', pendingEmail: email, message: 'We sent a 6-digit code to your new address. Your current address stays active until you enter it.' }
      } catch (error) {
        if (sessionExpired(error)) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.sessionExpired }
        if (cognitoError(error, 'AliasExistsException', 'InvalidParameterException')) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.unavailableEmail, field: 'email' }
        if (cognitoError(error, 'CodeDeliveryFailureException')) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.deliveryFailed, field: 'email' }
        if (cognitoError(error, 'LimitExceededException', 'TooManyRequestsException')) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.tooMany }
        return { status: 'error', error: EMAIL_CHANGE_MESSAGES.failed }
      }
    },

    async confirmEmailChange(_state: EmailChangeState, formData: FormData): Promise<EmailChangeState> {
      const pendingEmail = emailSchema.safeParse(formData.get('pendingEmail')).data
      const code = String(formData.get('code') ?? '').replace(/\s/g, '')
      const withPending = pendingEmail ? { pendingEmail } : {}
      if (!/^\d{6}$/.test(code)) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.invalidCode, field: 'code', ...withPending }

      const accessToken = await deps.getAccessToken()
      if (!accessToken) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.sessionExpired }

      let oldEmail: string | null
      try {
        const account = await accountFor(accessToken)
        if (account.error) return { status: 'error', error: account.error }
        oldEmail = account.state.email?.toLowerCase() ?? null
        if (!(await deps.allowAttempt('email_change_verify'))) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.tooMany, ...withPending }
        await deps.verifyEmailChange({ accessToken, code })
      } catch (error) {
        if (sessionExpired(error)) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.sessionExpired }
        if (cognitoError(error, 'CodeMismatchException')) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.wrongCode, field: 'code', ...withPending }
        if (cognitoError(error, 'ExpiredCodeException')) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.expiredCode, field: 'code', ...withPending }
        if (cognitoError(error, 'AliasExistsException')) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.unavailableEmail }
        if (cognitoError(error, 'LimitExceededException', 'TooManyRequestsException')) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.tooMany, ...withPending }
        return { status: 'error', error: EMAIL_CHANGE_MESSAGES.failed, ...withPending }
      }

      // The address Cognito holds now that the code is verified.
      let newEmail: string | null = null
      try {
        newEmail = (await deps.getAccountState(accessToken)).email?.toLowerCase() ?? null
      } catch {
        newEmail = null
      }
      if (!newEmail) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.failed }
      if (newEmail === oldEmail) return { status: 'error', error: EMAIL_CHANGE_MESSAGES.nothingPending }

      try {
        await deps.recordChange({ oldEmail, newEmail })
      } catch {
        // Cognito already switched the address; the copy is refreshed on the next profile sync.
        console.warn('[account_email_change_followup_failed]', { step: 'record' })
      }
      return {
        status: 'changed',
        email: newEmail,
        message: oldEmail ? 'Email changed. We let your previous address know.' : 'Email changed.',
      }
    },
  }
}

/** The database half of a verified email change (identity copy, notice to the old address, audit). */
export const UPDATE_IDENTITY_EMAIL_SQL = `update public.identity_accounts
   set email = $3, email_verified = true, updated_at = now()
   where profile_id = $1 and provider = 'cognito' and provider_subject = $2`
