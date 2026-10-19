import { CognitoApiError, type CognitoAuthenticationResult, type CognitoPrincipal } from './cognito-api'
import { COGNITO_COOKIE_NAMES, createCognitoCookieManager } from './cognito-cookies'

type CookieStore = {
  get(name: string): { name: string; value: string } | undefined
  set(
    name: string,
    value: string,
    options?: {
      httpOnly: true
      sameSite: 'lax'
      secure: boolean
      path: '/'
      maxAge?: number
    },
  ): void
  delete(name: string): void
}

type CognitoSessionApi = {
  getUser(accessToken: string): Promise<CognitoPrincipal>
  refresh(refreshToken: string): Promise<CognitoAuthenticationResult>
}

/**
 * Round I (I3): the server-side record of refresh tokens (features/account-security/refresh-token-ledger). `check`
 * runs before Cognito is asked: 'reused' means this token was already exchanged for a newer one more than the grace
 * period ago, so the sign-in it belongs to is ended. `record` runs after a successful refresh.
 */
export type RefreshTokenLedger = {
  check(refreshToken: string): Promise<'ok' | 'reused'>
  record(input: { previousRefreshToken: string; authentication: CognitoAuthenticationResult }): Promise<void>
}

export class CognitoUnauthenticatedError extends Error {
  constructor() {
    super('Authentication required.')
    this.name = 'CognitoUnauthenticatedError'
  }
}

function isAuthorizationFailure(error: unknown) {
  return error instanceof CognitoApiError && error.code === 'NotAuthorizedException'
}

export function createCognitoSessionManager(input: {
  cookieStore: CookieStore
  api: CognitoSessionApi
  siteUrl: string
  ledger?: RefreshTokenLedger
}) {
  const cookies = createCognitoCookieManager(input.cookieStore, input.siteUrl)

  return {
    async getVerifiedPrincipal(): Promise<CognitoPrincipal | null> {
      const accessToken = input.cookieStore.get(COGNITO_COOKIE_NAMES.access)?.value
      if (!accessToken) return null

      try {
        const principal = await input.api.getUser(accessToken)
        return principal.sub ? principal : null
      } catch (error) {
        if (isAuthorizationFailure(error)) return null
        throw error
      }
    },

    async requireVerifiedPrincipal(): Promise<CognitoPrincipal> {
      const principal = await this.getVerifiedPrincipal()
      if (!principal) throw new CognitoUnauthenticatedError()
      return principal
    },

    async refreshSession(): Promise<boolean> {
      const refreshToken = input.cookieStore.get(COGNITO_COOKIE_NAMES.refresh)?.value
      if (!refreshToken) return false

      if (input.ledger && (await input.ledger.check(refreshToken)) === 'reused') {
        cookies.clearCognitoCookies()
        return false
      }

      try {
        const authentication = await input.api.refresh(refreshToken)
        // Round I (I3): the refresh cookie is written again on every refresh, with a fresh 30-day Max-Age, so the
        // sign-in lasts until 30 days pass without the site being opened. With rotation on, Cognito returns a new
        // refresh token; without it the same token is kept.
        cookies.setAuthentication({ ...authentication, refreshToken: authentication.refreshToken ?? refreshToken })
        await input.ledger?.record({ previousRefreshToken: refreshToken, authentication })
        return true
      } catch (error) {
        if (isAuthorizationFailure(error)) {
          cookies.clearCognitoCookies()
          return false
        }
        throw error
      }
    },
  }
}
