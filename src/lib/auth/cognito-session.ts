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

      try {
        const authentication = await input.api.refresh(refreshToken)
        cookies.setAuthentication(authentication)
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
