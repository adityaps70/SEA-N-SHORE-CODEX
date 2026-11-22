import { CognitoApiError, type CognitoAuthenticationResult, type CognitoPrincipal } from './cognito-api'
import { COGNITO_COOKIE_NAMES, createCognitoCookieManager } from './cognito-cookies'
import type { RefreshRenewal } from './refresh-single-flight'

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
 * period ago. `record` runs after a successful refresh.
 *
 * Owner (19 Nov): on 'reused', `recover` first returns the renewal that token was exchanged for when the device
 * evidently never received it (at most once); otherwise `endReused` ends the sign-in it belongs to, as before.
 */
export type RefreshTokenLedger = {
  check(refreshToken: string): Promise<'ok' | 'reused'>
  /** The renewal this reused token was exchanged for, handed back once, or null when it cannot be recovered. */
  recover(refreshToken: string): Promise<CognitoAuthenticationResult | null>
  /** Ends the sign-in this reused token belongs to (auth_sessions.reuse_detected_at). Never throws. */
  endReused(refreshToken: string): Promise<void>
  record(input: { previousRefreshToken: string; authentication: CognitoAuthenticationResult }): Promise<void>
  /** Round ARCH: Cognito refused this refresh token as reused; end the sign-in it belongs to in our database too. */
  endSession?(refreshToken: string): Promise<void>
}

/** Where a refresh token reuse was caught: by our ledger before calling Cognito, or by Cognito itself. */
export type RefreshReuseSource = 'ledger' | 'cognito'

export class CognitoUnauthenticatedError extends Error {
  constructor() {
    super('Authentication required.')
    this.name = 'CognitoUnauthenticatedError'
  }
}

function isAuthorizationFailure(error: unknown) {
  return error instanceof CognitoApiError && error.code === 'NotAuthorizedException'
}

/**
 * Round ARCH: Cognito refuses a refresh token that was already exchanged and comes back after the rotation grace
 * period (refresh token rotation, 60 s). Like a refused token, the sign-in is over: it is handled the same way.
 */
function isRefreshTokenReuse(error: unknown) {
  return error instanceof CognitoApiError && error.code === 'RefreshTokenReuseException'
}

export function createCognitoSessionManager(input: {
  cookieStore: CookieStore
  api: CognitoSessionApi
  siteUrl: string
  ledger?: RefreshTokenLedger
  /** Round ARCH: counted (a metric, no member data) each time a reused refresh token is caught. */
  onRefreshReuse?: (source: RefreshReuseSource) => void
  /** Owner (19 Nov): counted (a metric, no member data) each time a lost renewal is recovered instead of ending. */
  onRefreshRecovered?: () => void
  /**
   * Owner-approved 15 Nov: one renewal per refresh token (refresh-single-flight). Requests that carry the same refresh
   * token share one Cognito renewal, so every response sets the same new tokens. Without it, each request renews.
   */
  renew?: RefreshRenewal
}) {
  function reportReuse(source: RefreshReuseSource) {
    try {
      input.onRefreshReuse?.(source)
    } catch {
      // Counting must never break a request.
    }
  }

  function reportRecovered() {
    try {
      input.onRefreshRecovered?.()
    } catch {
      // Counting must never break a request.
    }
  }

  function renewWith(refreshToken: string) {
    return input.renew
      ? input.renew(refreshToken, () => input.api.refresh(refreshToken))
      : input.api.refresh(refreshToken)
  }

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
        const ledger = input.ledger
        // Owner (19 Nov): the device may never have received the renewal this token was exchanged for. If the ledger
        // still holds it (once, and only while no request has carried its access token), renew from ITS refresh
        // token, through the single renewal keyed on that token. The old token is never sent to Cognito here.
        const recoverAndRenew = async () => {
          const recovered = await ledger.recover(refreshToken).catch(() => null)
          const recoveredRefreshToken = recovered?.refreshToken
          if (!recoveredRefreshToken || recoveredRefreshToken === refreshToken) throw new CognitoApiError('NotAuthorizedException')
          const authentication = await renewWith(recoveredRefreshToken)
          await ledger.record({ previousRefreshToken: recoveredRefreshToken, authentication })
          reportRecovered()
          return { ...authentication, refreshToken: authentication.refreshToken ?? recoveredRefreshToken }
        }
        try {
          // A device that wakes sends several requests with the same old token at once: they share this one recovery
          // (keyed on the old token, here and on the other servers), so the second does not find it spent and end
          // the sign-in. Only the request that made it records and counts it.
          const authentication = input.renew ? await input.renew(refreshToken, recoverAndRenew) : await recoverAndRenew()
          cookies.setAuthentication(authentication)
          return true
        } catch {
          // Nothing to recover, or any failure with the recovered token: the sign-in ends, as reuse always did.
        }
        cookies.clearCognitoCookies()
        await ledger.endReused(refreshToken).catch(() => undefined)
        reportReuse('ledger')
        return false
      }

      try {
        const authentication = await renewWith(refreshToken)
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
        if (isRefreshTokenReuse(error)) {
          cookies.clearCognitoCookies()
          reportReuse('cognito')
          // Our record of the sign-in ends too, so the session check agrees with Cognito. Never fails the request.
          await input.ledger?.endSession?.(refreshToken).catch(() => undefined)
          return false
        }
        throw error
      }
    },
  }
}
