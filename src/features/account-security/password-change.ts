import { CognitoApiError } from '@/lib/auth/cognito-api'
import { cognitoPasswordRule, failedPasswordRules, PASSWORD_MAX_LENGTH, passwordRulesMessage } from '@/features/auth/password-rules'
import type { MfaAccountKind } from '@/features/auth/mfa'

/**
 * Round H (H3): Settings › Account › Change password. The current password, then the new one with the sign-up
 * rules (features/auth/password-rules, the same as the pool's policy). Cognito ChangePassword runs with the
 * member's own access token. On success every OTHER session is signed out and this one stays.
 */

export type PasswordChangeState =
  | { status: 'idle' }
  | { status: 'error'; error: string; field?: 'currentPassword' | 'newPassword' | 'newPasswordConfirmation' }
  | { status: 'changed'; message: string; signedOut: number }

export const PASSWORD_CHANGE_MESSAGES = {
  sessionExpired: 'Your session expired. Please sign in again.',
  federated: 'You sign in with Google, so there is no Sea N Shore password to change.',
  currentMissing: 'Enter your current password.',
  confirmMismatch: 'The new passwords don’t match.',
  sameAsCurrent: 'Choose a new password that is different from your current one.',
  wrongCurrent: 'Your current password is incorrect.',
  tooMany: 'Too many attempts. Please wait 15 minutes and try again.',
  failed: 'We couldn’t change your password. Please try again.',
  othersNotSignedOut: 'Password changed, but we couldn’t sign out your other devices. Use “Sign out of all other devices” below.',
} as const

type Dependencies = {
  changePassword(input: { accessToken: string; previousPassword: string; proposedPassword: string }): Promise<void>
  getAccessToken(): Promise<string | null>
  getAccountKind(accessToken: string): Promise<MfaAccountKind>
  /** Records one attempt; false when the member is over the limit. */
  allowAttempt(): Promise<boolean>
  /** Signs out every session but this one; returns how many. */
  signOutOtherSessions(): Promise<number>
  audit(signedOut: number): Promise<void>
}

function signedOutMessage(count: number) {
  if (count === 0) return 'Password changed.'
  return count === 1 ? 'Password changed. We signed you out of 1 other device.' : `Password changed. We signed you out of ${count} other devices.`
}

export function createPasswordChange(deps: Dependencies) {
  return async function changePassword(_state: PasswordChangeState, formData: FormData): Promise<PasswordChangeState> {
    const currentPassword = String(formData.get('currentPassword') ?? '')
    const newPassword = String(formData.get('newPassword') ?? '')
    const confirmation = String(formData.get('newPasswordConfirmation') ?? '')

    if (!currentPassword || currentPassword.length > PASSWORD_MAX_LENGTH) {
      return { status: 'error', error: PASSWORD_CHANGE_MESSAGES.currentMissing, field: 'currentPassword' }
    }
    if (newPassword.length > PASSWORD_MAX_LENGTH) {
      return { status: 'error', error: `Use ${PASSWORD_MAX_LENGTH} characters or fewer for your password.`, field: 'newPassword' }
    }
    const failed = failedPasswordRules(newPassword)
    if (failed.length > 0) return { status: 'error', error: passwordRulesMessage(failed), field: 'newPassword' }
    if (newPassword !== confirmation) return { status: 'error', error: PASSWORD_CHANGE_MESSAGES.confirmMismatch, field: 'newPasswordConfirmation' }
    if (newPassword === currentPassword) return { status: 'error', error: PASSWORD_CHANGE_MESSAGES.sameAsCurrent, field: 'newPassword' }

    const accessToken = await deps.getAccessToken()
    if (!accessToken) return { status: 'error', error: PASSWORD_CHANGE_MESSAGES.sessionExpired }

    try {
      if ((await deps.getAccountKind(accessToken)) === 'federated') return { status: 'error', error: PASSWORD_CHANGE_MESSAGES.federated }
      if (!(await deps.allowAttempt())) return { status: 'error', error: PASSWORD_CHANGE_MESSAGES.tooMany }
      await deps.changePassword({ accessToken, previousPassword: currentPassword, proposedPassword: newPassword })
    } catch (error) {
      if (error instanceof CognitoApiError) {
        if (error.code === 'NotAuthorizedException') {
          return error.reason === 'token'
            ? { status: 'error', error: PASSWORD_CHANGE_MESSAGES.sessionExpired }
            : { status: 'error', error: PASSWORD_CHANGE_MESSAGES.wrongCurrent, field: 'currentPassword' }
        }
        if (error.code === 'InvalidPasswordException') {
          const rule = cognitoPasswordRule(error.reason)
          return { status: 'error', error: passwordRulesMessage(rule ? [rule] : []), field: 'newPassword' }
        }
        if (error.code === 'LimitExceededException' || error.code === 'TooManyRequestsException') {
          return { status: 'error', error: PASSWORD_CHANGE_MESSAGES.tooMany }
        }
      }
      return { status: 'error', error: PASSWORD_CHANGE_MESSAGES.failed }
    }

    // The password is changed; signing the other devices out must not turn that into an error message.
    let signedOut: number
    try {
      signedOut = await deps.signOutOtherSessions()
    } catch {
      console.warn('[account_password_change_followup_failed]', { step: 'sign_out_others' })
      return { status: 'changed', message: PASSWORD_CHANGE_MESSAGES.othersNotSignedOut, signedOut: 0 }
    }
    try {
      await deps.audit(signedOut)
    } catch {
      console.warn('[account_password_change_followup_failed]', { step: 'audit' })
    }
    return { status: 'changed', message: signedOutMessage(signedOut), signedOut }
  }
}
