import { CognitoApiError, type CognitoSoftwareTokenVerification, type CognitoUserMfaSettings } from '@/lib/auth/cognito-api'
import { safeAdminReturnPath } from '@/lib/auth/admin-mfa-paths'
import { normalizeAuthenticatorCode } from './mfa-sign-in'
import { isPhoneLoginEmail } from './phone-login-email'

/**
 * Round 14 (2.11): optional authenticator-app (TOTP) MFA for email/password members, required for
 * platform administrators. Everything here works with the member's own access token; secrets and
 * codes are returned to the member once and never stored or logged.
 */

export const MFA_ISSUER = 'Sea N Shore'

/**
 * - `eligible`: an email/password account (Google may also be linked to it).
 * - `federated`: a Google-only account. Google handles its sign-in; Cognito cannot ask it for a code.
 * - `phone`: a mobile-number sign-in account; it has no password step to protect.
 */
export type MfaAccountKind = 'eligible' | 'federated' | 'phone'

export type CurrentMfaStatus = {
  kind: MfaAccountKind
  enabled: boolean
  email: string | null
  /**
   * True when this session came from the hosted (Google) sign-in. Cognito never asks those
   * sessions for an authenticator code, even on an account that has one.
   */
  hostedSession: boolean
}

export function accessTokenScopes(accessToken: string): string[] {
  const payload = accessToken.split('.')[1]
  if (!payload) return []
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : ''
    const decoded = JSON.parse(atob(normalized + padding)) as { scope?: unknown }
    return typeof decoded.scope === 'string' ? decoded.scope.split(/\s+/).filter(Boolean) : []
  } catch {
    return []
  }
}

/**
 * Builds the status from a GetUser answer for the same access token (so its claims are ones
 * Cognito just accepted). Password and mobile sign-ins get only the
 * `aws.cognito.signin.user.admin` scope; the hosted (Google) sign-in always adds `openid`.
 */
export function describeMfaStatus(settings: CognitoUserMfaSettings, accessToken: string): CurrentMfaStatus {
  const kind: MfaAccountKind = isPhoneLoginEmail(settings.email)
    ? 'phone'
    : /^google_/i.test(settings.username ?? '')
      ? 'federated'
      : 'eligible'
  return {
    kind,
    enabled: settings.softwareTokenEnabled,
    email: settings.email,
    hostedSession: accessTokenScopes(accessToken).includes('openid'),
  }
}

/** The admin console needs an authenticator app and a session that answered it at sign-in. */
export function satisfiesAdminMfa(status: CurrentMfaStatus | null): boolean {
  return Boolean(status && status.kind === 'eligible' && status.enabled && !status.hostedSession)
}

/**
 * Hotfix P1: a Google sign-in on an account that has an authenticator app. Cognito never asked it for a code, so
 * admin pages open only after this sign-in's step-up (password plus authenticator code, or a backup code).
 */
export function canStepUpForAdmin(status: CurrentMfaStatus | null): boolean {
  return Boolean(status && status.kind === 'eligible' && status.enabled && status.hostedSession)
}

export function otpauthUri(input: { secret: string; account: string; issuer?: string }) {
  const issuer = input.issuer ?? MFA_ISSUER
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(input.account)}`
  const params = new URLSearchParams({ secret: input.secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' })
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, '%20')}`
}

export const MFA_MESSAGES = {
  sessionExpired: 'Your session expired. Please sign in again.',
  ineligibleFederated: 'Authenticator apps are for email and password sign-in. Your Google account protects your Google sign-in.',
  ineligiblePhone: 'Authenticator apps are for email and password sign-in. Sign in with your email and password to set one up.',
  alreadyOn: 'Your authenticator app is already on.',
  setupFailed: 'We could not start the authenticator setup. Please try again.',
  invalidCode: 'Enter the 6-digit code from your authenticator app.',
  wrongCode: 'That code didn’t match. Check the time on your phone and enter the current 6-digit code.',
  verifyFailed: 'We could not turn on your authenticator app. Please try again.',
  enabled: 'Authenticator app turned on. You’ll enter a code from it each time you sign in with your password.',
  adminCannotDisable: 'Administrators and country admins must keep two-step verification on.',
  disableFailed: 'We could not turn off your authenticator app. Please try again.',
  disabled: 'Authenticator app turned off. You’ll sign in with your password only.',
  tooMany: 'Too many attempts. Please wait a few minutes and try again.',
} as const

export type MfaSetupStartState =
  | { status: 'ready'; secret: string; otpauthUri: string; qrDataUrl: string }
  | { status: 'error'; error: string }

export type MfaChangeState =
  | { status: 'idle' }
  | { status: 'enabled'; message: string; redirectTo: string | null }
  | { status: 'disabled'; message: string }
  | { status: 'error'; error: string }

type MfaApi = {
  getUserMfaSettings(accessToken: string): Promise<CognitoUserMfaSettings>
  associateSoftwareToken(accessToken: string): Promise<{ secretCode: string }>
  verifySoftwareToken(input: { accessToken: string; code: string; friendlyDeviceName?: string }): Promise<CognitoSoftwareTokenVerification>
  setSoftwareTokenMfaPreference(input: { accessToken: string; enabled: boolean }): Promise<void>
}

function ineligibleMessage(kind: MfaAccountKind) {
  if (kind === 'federated') return MFA_MESSAGES.ineligibleFederated
  if (kind === 'phone') return MFA_MESSAGES.ineligiblePhone
  return null
}

function isCognito(error: unknown, ...codes: string[]) {
  return error instanceof CognitoApiError && codes.includes(error.code)
}

export function createAuthenticatorMfaActions(input: {
  api: MfaApi
  getAccessToken: () => Promise<string | null>
  /** The signed-in member's profile id, used for the administrator check. */
  getProfileId: () => Promise<string>
  isPlatformAdministrator: (profileId: string) => Promise<boolean>
  renderQr: (uri: string) => Promise<string>
  onIssue?: (context: { operation: string; reason: string }) => void
}) {
  function report(operation: string, error: unknown) {
    // Only the operation and Cognito's error code: never a code, secret or token.
    const reason = error instanceof CognitoApiError ? error.code.replace(/Exception$/, '') : 'Error'
    if (input.onIssue) input.onIssue({ operation, reason })
    else console.warn('[cognito_mfa_issue]', { operation, reason })
  }

  async function currentStatus(accessToken: string) {
    return describeMfaStatus(await input.api.getUserMfaSettings(accessToken), accessToken)
  }

  return {
    async startSetup(): Promise<MfaSetupStartState> {
      const accessToken = await input.getAccessToken()
      if (!accessToken) return { status: 'error', error: MFA_MESSAGES.sessionExpired }
      try {
        const status = await currentStatus(accessToken)
        const ineligible = ineligibleMessage(status.kind)
        if (ineligible) return { status: 'error', error: ineligible }
        if (status.enabled) return { status: 'error', error: MFA_MESSAGES.alreadyOn }

        const { secretCode } = await input.api.associateSoftwareToken(accessToken)
        const uri = otpauthUri({ secret: secretCode, account: status.email ?? 'Sea N Shore member' })
        return { status: 'ready', secret: secretCode, otpauthUri: uri, qrDataUrl: await input.renderQr(uri) }
      } catch (error) {
        if (isCognito(error, 'NotAuthorizedException')) return { status: 'error', error: MFA_MESSAGES.sessionExpired }
        report('associateSoftwareToken', error)
        if (isCognito(error, 'TooManyRequestsException', 'LimitExceededException')) return { status: 'error', error: MFA_MESSAGES.tooMany }
        return { status: 'error', error: MFA_MESSAGES.setupFailed }
      }
    },

    async confirmSetup(_state: MfaChangeState, formData: FormData): Promise<MfaChangeState> {
      const code = normalizeAuthenticatorCode(formData.get('code'))
      if (!code) return { status: 'error', error: MFA_MESSAGES.invalidCode }
      const accessToken = await input.getAccessToken()
      if (!accessToken) return { status: 'error', error: MFA_MESSAGES.sessionExpired }

      try {
        const verification = await input.api.verifySoftwareToken({
          accessToken,
          code,
          friendlyDeviceName: 'Authenticator app',
        })
        if (verification.status !== 'SUCCESS') return { status: 'error', error: MFA_MESSAGES.wrongCode }
        await input.api.setSoftwareTokenMfaPreference({ accessToken, enabled: true })
        return {
          status: 'enabled',
          message: MFA_MESSAGES.enabled,
          redirectTo: safeAdminReturnPath(formData.get('returnTo')),
        }
      } catch (error) {
        if (isCognito(error, 'CodeMismatchException', 'EnableSoftwareTokenMFAException')) {
          return { status: 'error', error: MFA_MESSAGES.wrongCode }
        }
        if (isCognito(error, 'NotAuthorizedException')) return { status: 'error', error: MFA_MESSAGES.sessionExpired }
        report('verifySoftwareToken', error)
        if (isCognito(error, 'TooManyRequestsException', 'LimitExceededException')) return { status: 'error', error: MFA_MESSAGES.tooMany }
        return { status: 'error', error: MFA_MESSAGES.verifyFailed }
      }
    },

    async disable(): Promise<MfaChangeState> {
      const accessToken = await input.getAccessToken()
      if (!accessToken) return { status: 'error', error: MFA_MESSAGES.sessionExpired }

      // Fail closed: if the administrator check cannot run, nothing is turned off.
      let administrator: boolean
      try {
        administrator = await input.isPlatformAdministrator(await input.getProfileId())
      } catch {
        return { status: 'error', error: MFA_MESSAGES.disableFailed }
      }
      if (administrator) return { status: 'error', error: MFA_MESSAGES.adminCannotDisable }

      try {
        await input.api.setSoftwareTokenMfaPreference({ accessToken, enabled: false })
        return { status: 'disabled', message: MFA_MESSAGES.disabled }
      } catch (error) {
        if (isCognito(error, 'NotAuthorizedException')) return { status: 'error', error: MFA_MESSAGES.sessionExpired }
        report('setUserMfaPreference', error)
        return { status: 'error', error: MFA_MESSAGES.disableFailed }
      }
    },
  }
}
