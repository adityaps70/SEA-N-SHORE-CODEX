import { CognitoApiError, type CognitoAuthenticationResult } from '@/lib/auth/cognito-api'
import {
  COGNITO_COOKIE_NAMES,
  createCognitoCookieManager,
} from '@/lib/auth/cognito-cookies'
import type { CognitoAuthActionState } from './cognito-actions'

/**
 * Round 14 (2.11): the second sign-in step for members who turned on an authenticator app.
 * The Cognito session from the password step lives only in HTTP-only cookies; the code is sent
 * once to Cognito and is never stored or logged.
 */

type CookieStore = {
  get(name: string): { name: string; value: string } | undefined
  set(name: string, value: string, options?: Record<string, unknown>): void
  delete(name: string): void
}

type MfaSignInApi = {
  respondToSoftwareTokenMfa(input: {
    username: string
    session: string
    code: string
  }): Promise<CognitoAuthenticationResult>
}

export const MFA_SIGN_IN_MESSAGES = {
  invalidCode: 'Enter the 6-digit code from your authenticator app.',
  wrongCode: 'That code didn’t match. Enter the current 6-digit code from your authenticator app.',
  expired: 'Your sign-in session expired. Please sign in again.',
  tooMany: 'Too many attempts. Please wait a few minutes, then sign in again.',
  failed: 'We could not finish signing you in. Please try again.',
  signedIn: 'Signed in.',
} as const

const codeSchema = /^\d{6}$/

export function normalizeAuthenticatorCode(value: FormDataEntryValue | null): string | null {
  const code = String(value ?? '').replace(/[\s-]/g, '')
  return codeSchema.test(code) ? code : null
}

export function createMfaSignInActions(input: {
  api: MfaSignInApi
  cookieStore: CookieStore
  siteUrl: string
  allowInsecureHttpCookies?: boolean
}) {
  const cookies = createCognitoCookieManager(input.cookieStore, input.siteUrl, {
    allowInsecureHttp: input.allowInsecureHttpCookies === true,
  })

  return {
    hasPendingChallenge() {
      return Boolean(
        input.cookieStore.get(COGNITO_COOKIE_NAMES.mfaChallenge)?.value
        && input.cookieStore.get(COGNITO_COOKIE_NAMES.mfaChallengeUser)?.value,
      )
    },

    async confirmSignInMfa(
      _state: CognitoAuthActionState,
      formData: FormData,
    ): Promise<CognitoAuthActionState> {
      const code = normalizeAuthenticatorCode(formData.get('code'))
      if (!code) return { error: MFA_SIGN_IN_MESSAGES.invalidCode }

      const session = input.cookieStore.get(COGNITO_COOKIE_NAMES.mfaChallenge)?.value
      const username = input.cookieStore.get(COGNITO_COOKIE_NAMES.mfaChallengeUser)?.value
      if (!session || !username) return { error: MFA_SIGN_IN_MESSAGES.expired }

      try {
        const authentication = await input.api.respondToSoftwareTokenMfa({ username, session, code })
        cookies.clearMfaChallenge()
        cookies.setAuthentication(authentication)
        return { message: MFA_SIGN_IN_MESSAGES.signedIn }
      } catch (error) {
        if (error instanceof CognitoApiError) {
          if (error.code === 'CodeMismatchException') return { error: MFA_SIGN_IN_MESSAGES.wrongCode }
          if (error.code === 'TooManyRequestsException' || error.code === 'LimitExceededException') {
            cookies.clearMfaChallenge()
            return { error: MFA_SIGN_IN_MESSAGES.tooMany }
          }
          // Cognito answers an expired or already-used session with NotAuthorized / ExpiredCode.
          if (error.code === 'NotAuthorizedException' || error.code === 'ExpiredCodeException') {
            cookies.clearMfaChallenge()
            return { error: MFA_SIGN_IN_MESSAGES.expired }
          }
        }
        return { error: MFA_SIGN_IN_MESSAGES.failed }
      }
    },
  }
}

type MfaSignInActions = ReturnType<typeof createMfaSignInActions>

export function createMfaSignInHandler(input: {
  getActions: () => Promise<MfaSignInActions>
  redirect: (path: string) => void
}) {
  return async function confirmSignInMfa(
    state: CognitoAuthActionState,
    formData: FormData,
  ): Promise<CognitoAuthActionState> {
    const actions = await input.getActions()
    const result = await actions.confirmSignInMfa(state, formData)
    if (result.message === MFA_SIGN_IN_MESSAGES.signedIn) input.redirect('/auth/post-sign-in')
    return result
  }
}
