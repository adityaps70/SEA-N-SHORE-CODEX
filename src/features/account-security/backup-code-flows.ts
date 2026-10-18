import type { CurrentMfaStatus } from '@/features/auth/mfa'
import { normalizeBackupCode } from './backup-codes'

/**
 * Round H (H3): generating 2FA backup codes (Settings › Account) and using one on the 2FA sign-in screen.
 *
 * Generating needs an authenticator app that is on, and the member's current password again. (Cognito has no call
 * that checks a TOTP code for an app that is already set up without a full sign-in, so re-authentication is by
 * password: InitiateAuth answers a correct password with the authenticator challenge and issues no tokens.)
 *
 * Using a code is tied to the sign-in in progress: the MFA challenge cookies must carry the server's signature
 * (mfa-challenge-binding), so a code is only checked for the member whose password step just succeeded. A correct
 * code is marked used in the same transaction that turns the authenticator app off in Cognito
 * (AdminSetUserMFAPreference), so a Cognito failure leaves the code unused. The member then signs in again with
 * their password, and is asked to set up 2FA again. Platform administrators cannot open admin pages until they have
 * (the existing admin MFA gate requires an authenticator app that is on).
 */

export type BackupCodesState =
  | { status: 'idle' }
  | { status: 'error'; error: string; field?: 'currentPassword' }
  | { status: 'ready'; codes: string[]; regenerated: boolean }

export const BACKUP_CODE_MESSAGES = {
  sessionExpired: 'Your session expired. Please sign in again.',
  needsAuthenticator: 'Turn on your authenticator app first. Backup codes are for when you can’t use it.',
  passwordMissing: 'Enter your current password.',
  wrongPassword: 'Your current password is incorrect.',
  tooMany: 'Too many attempts. Please wait 15 minutes and try again.',
  unavailable: 'Backup codes are unavailable right now. Please try again later.',
  failed: 'We couldn’t create backup codes. Please try again.',
} as const

export const BACKUP_SIGN_IN_MESSAGES = {
  invalidCode: 'Enter a backup code: 10 letters and numbers, like ABCDE-23456.',
  wrongCode: 'That backup code didn’t work. Check it, or use another one.',
  expired: 'Your sign-in session expired. Please sign in again.',
  tooMany: 'Too many attempts. Please wait 15 minutes, then sign in again.',
  failed: 'We couldn’t check that backup code. Please try again.',
} as const

type GenerationDependencies = {
  getAccessToken(): Promise<string | null>
  getMfaStatus(accessToken: string): Promise<CurrentMfaStatus>
  /** True when the password is right (Cognito asked for the authenticator code or signed in). */
  verifyPassword(input: { email: string; password: string }): Promise<boolean>
  hasKey(): boolean
  allowAttempt(): Promise<boolean>
  /** Deletes the old batch, stores the new hashes and audits, in one transaction. */
  replaceBatch(): Promise<{ codes: string[]; replaced: boolean }>
}

export function createBackupCodeGeneration(deps: GenerationDependencies) {
  return async function generateBackupCodes(_state: BackupCodesState, formData: FormData): Promise<BackupCodesState> {
    const password = String(formData.get('currentPassword') ?? '')
    if (!password || password.length > 72) return { status: 'error', error: BACKUP_CODE_MESSAGES.passwordMissing, field: 'currentPassword' }

    const accessToken = await deps.getAccessToken()
    if (!accessToken) return { status: 'error', error: BACKUP_CODE_MESSAGES.sessionExpired }
    if (!deps.hasKey()) return { status: 'error', error: BACKUP_CODE_MESSAGES.unavailable }

    try {
      const status = await deps.getMfaStatus(accessToken)
      if (status.kind !== 'eligible' || !status.enabled || !status.email) return { status: 'error', error: BACKUP_CODE_MESSAGES.needsAuthenticator }
      if (!(await deps.allowAttempt())) return { status: 'error', error: BACKUP_CODE_MESSAGES.tooMany }
      if (!(await deps.verifyPassword({ email: status.email, password }))) {
        return { status: 'error', error: BACKUP_CODE_MESSAGES.wrongPassword, field: 'currentPassword' }
      }
      const batch = await deps.replaceBatch()
      return { status: 'ready', codes: batch.codes, regenerated: batch.replaced }
    } catch {
      return { status: 'error', error: BACKUP_CODE_MESSAGES.failed }
    }
  }
}

export type BackupSignInState = { error?: string; reset?: true }

type Challenge = { session: string; username: string; binding: string | null }

type SignInDependencies = {
  readChallenge(): Challenge | null
  verifyBinding(challenge: Challenge): boolean
  resolveProfileId(username: string): Promise<string | null>
  allowAttempt(profileId: string): Promise<boolean>
  /**
   * In one transaction: marks the code used (once), turns the authenticator app off in Cognito, removes the
   * remaining codes, signs out every session and audits. 'no_match' when the code is not an unused code of theirs.
   */
  useCodeAndReset(input: { profileId: string; username: string; code: string }): Promise<'reset' | 'no_match'>
  clearChallenge(): void
}

export function createBackupCodeSignIn(deps: SignInDependencies) {
  return async function signInWithBackupCode(_state: BackupSignInState, formData: FormData): Promise<BackupSignInState> {
    const code = normalizeBackupCode(formData.get('code'))
    if (!code) return { error: BACKUP_SIGN_IN_MESSAGES.invalidCode }

    const challenge = deps.readChallenge()
    if (!challenge || !deps.verifyBinding(challenge)) {
      deps.clearChallenge()
      return { error: BACKUP_SIGN_IN_MESSAGES.expired }
    }

    try {
      const profileId = await deps.resolveProfileId(challenge.username)
      if (!profileId) {
        deps.clearChallenge()
        return { error: BACKUP_SIGN_IN_MESSAGES.expired }
      }
      if (!(await deps.allowAttempt(profileId))) {
        deps.clearChallenge()
        return { error: BACKUP_SIGN_IN_MESSAGES.tooMany }
      }
      const result = await deps.useCodeAndReset({ profileId, username: challenge.username, code })
      if (result === 'no_match') return { error: BACKUP_SIGN_IN_MESSAGES.wrongCode }
      deps.clearChallenge()
      return { reset: true }
    } catch {
      return { error: BACKUP_SIGN_IN_MESSAGES.failed }
    }
  }
}
