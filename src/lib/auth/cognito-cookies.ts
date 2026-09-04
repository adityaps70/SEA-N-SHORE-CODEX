export const COGNITO_COOKIE_NAMES = {
  access: 'sns_cognito_access',
  refresh: 'sns_cognito_refresh',
  challenge: 'sns_cognito_challenge',
  challengeUser: 'sns_cognito_challenge_user',
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

const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const CHALLENGE_MAX_AGE_SECONDS = 10 * 60

export function cognitoCookieOptions(siteUrl: string): CookieOptions {
  const url = new URL(siteUrl)
  const isLocalDevelopment =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')

  if (url.protocol !== 'https:' && !isLocalDevelopment) {
    throw new Error('Cognito cookies require HTTPS outside local development.')
  }

  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    path: '/',
  }
}

export function createCognitoCookieManager(store: CookieStore, siteUrl: string) {
  const baseOptions = cognitoCookieOptions(siteUrl)

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

    clearCognitoCookies() {
      store.delete(COGNITO_COOKIE_NAMES.access)
      store.delete(COGNITO_COOKIE_NAMES.refresh)
      store.delete(COGNITO_COOKIE_NAMES.challenge)
      store.delete(COGNITO_COOKIE_NAMES.challengeUser)
    },
  }
}
