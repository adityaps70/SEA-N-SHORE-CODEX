export const COGNITO_COOKIE_NAMES = {
  access: 'sns_cognito_access',
  refresh: 'sns_cognito_refresh',
  challenge: 'sns_cognito_challenge',
  challengeUser: 'sns_cognito_challenge_user',
  phoneChallenge: 'sns_cognito_phone_challenge',
  phoneChallengeUser: 'sns_cognito_phone_challenge_user',
  oauthState: 'sns_cognito_oauth_state',
  oauthVerifier: 'sns_cognito_oauth_verifier',
  oauthIntent: 'sns_cognito_oauth_intent',
  mfaChallenge: 'sns_cognito_mfa_challenge',
  mfaChallengeUser: 'sns_cognito_mfa_challenge_user',
  /** Round H (H3): a server-keyed signature tying the MFA challenge to its user, for the backup code step. */
  mfaChallengeBinding: 'sns_cognito_mfa_binding',
} as const

type CookieOptions = {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: '/'
  maxAge?: number
}

type CookieStore = {
  get(name: string): { name: string; value: string } | undefined
  set(name: string, value: string, options?: CookieOptions): void
  delete(name: string): void
}

type CognitoCookiePolicy = {
  allowInsecureHttp?: boolean
}

/** The refresh cookie lives 30 days from each renewal (it is written again, with this Max-Age, on every refresh). */
export const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const CHALLENGE_MAX_AGE_SECONDS = 10 * 60

export function cognitoCookieOptions(
  siteUrl: string,
  policy: CognitoCookiePolicy = {},
): CookieOptions {
  const url = new URL(siteUrl)
  const isLocalDevelopment =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
  const isExplicitlyAllowedHttp = url.protocol === 'http:' && policy.allowInsecureHttp === true

  if (url.protocol !== 'https:' && !isLocalDevelopment && !isExplicitlyAllowedHttp) {
    throw new Error('Cognito cookies require HTTPS outside local development.')
  }

  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    path: '/',
  }
}

export function createCognitoCookieManager(
  store: CookieStore,
  siteUrl: string,
  policy: CognitoCookiePolicy = {},
) {
  const baseOptions = cognitoCookieOptions(siteUrl, policy)

  return {
    setAuthentication(input: {
      accessToken: string
      refreshToken?: string
      expiresIn: number
    }) {
      store.set(COGNITO_COOKIE_NAMES.access, input.accessToken, {
        ...baseOptions,
        maxAge: input.expiresIn,
      })

      if (input.refreshToken) {
        store.set(COGNITO_COOKIE_NAMES.refresh, input.refreshToken, {
          ...baseOptions,
          maxAge: REFRESH_MAX_AGE_SECONDS,
        })
      }
    },

    setChallenge(input: { session: string; username: string }) {
      const challengeOptions = {
        ...baseOptions,
        maxAge: CHALLENGE_MAX_AGE_SECONDS,
      }

      store.set(COGNITO_COOKIE_NAMES.challenge, input.session, challengeOptions)
      store.set(COGNITO_COOKIE_NAMES.challengeUser, input.username, challengeOptions)
    },

    /** Round 14 (2.11): the Cognito session between the password and the authenticator code (HTTP-only, 10 min). */
    setMfaChallenge(input: { session: string; username: string; binding?: string | null }) {
      const challengeOptions = {
        ...baseOptions,
        maxAge: CHALLENGE_MAX_AGE_SECONDS,
      }

      store.set(COGNITO_COOKIE_NAMES.mfaChallenge, input.session, challengeOptions)
      store.set(COGNITO_COOKIE_NAMES.mfaChallengeUser, input.username, challengeOptions)
      // Round H (H3): only the server can make this value, so a backup code is only ever checked for the member
      // whose password step just succeeded on this browser.
      if (input.binding) store.set(COGNITO_COOKIE_NAMES.mfaChallengeBinding, input.binding, challengeOptions)
    },

    clearMfaChallenge() {
      store.delete(COGNITO_COOKIE_NAMES.mfaChallenge)
      store.delete(COGNITO_COOKIE_NAMES.mfaChallengeUser)
      store.delete(COGNITO_COOKIE_NAMES.mfaChallengeBinding)
    },

    setPhoneChallenge(input: { session: string; username: string }) {
      const challengeOptions = {
        ...baseOptions,
        maxAge: CHALLENGE_MAX_AGE_SECONDS,
      }

      store.set(COGNITO_COOKIE_NAMES.phoneChallenge, input.session, challengeOptions)
      store.set(COGNITO_COOKIE_NAMES.phoneChallengeUser, input.username, challengeOptions)
    },

    clearPhoneChallenge() {
      store.delete(COGNITO_COOKIE_NAMES.phoneChallenge)
      store.delete(COGNITO_COOKIE_NAMES.phoneChallengeUser)
    },

    setOAuthChallenge(input: { state: string; verifier: string; intent: 'sign-in' | 'sign-up' }) {
      const challengeOptions = {
        ...baseOptions,
        maxAge: CHALLENGE_MAX_AGE_SECONDS,
      }

      store.set(COGNITO_COOKIE_NAMES.oauthState, input.state, challengeOptions)
      store.set(COGNITO_COOKIE_NAMES.oauthVerifier, input.verifier, challengeOptions)
      store.set(COGNITO_COOKIE_NAMES.oauthIntent, input.intent, challengeOptions)
    },

    clearOAuthChallenge() {
      store.delete(COGNITO_COOKIE_NAMES.oauthState)
      store.delete(COGNITO_COOKIE_NAMES.oauthVerifier)
      store.delete(COGNITO_COOKIE_NAMES.oauthIntent)
    },

    clearCognitoCookies() {
      store.delete(COGNITO_COOKIE_NAMES.access)
      store.delete(COGNITO_COOKIE_NAMES.refresh)
      store.delete(COGNITO_COOKIE_NAMES.challenge)
      store.delete(COGNITO_COOKIE_NAMES.challengeUser)
      store.delete(COGNITO_COOKIE_NAMES.phoneChallenge)
      store.delete(COGNITO_COOKIE_NAMES.phoneChallengeUser)
      store.delete(COGNITO_COOKIE_NAMES.oauthState)
      store.delete(COGNITO_COOKIE_NAMES.oauthVerifier)
      store.delete(COGNITO_COOKIE_NAMES.oauthIntent)
      store.delete(COGNITO_COOKIE_NAMES.mfaChallenge)
      store.delete(COGNITO_COOKIE_NAMES.mfaChallengeUser)
      store.delete(COGNITO_COOKIE_NAMES.mfaChallengeBinding)
    },
  }
}
