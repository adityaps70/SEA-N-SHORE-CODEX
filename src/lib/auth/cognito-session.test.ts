import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError, type CognitoPrincipal } from './cognito-api'
import { COGNITO_COOKIE_NAMES } from './cognito-cookies'
import {
  CognitoUnauthenticatedError,
  createCognitoSessionManager,
} from './cognito-session'

type CookieWrite = {
  name: string
  value: string
  options?: Record<string, unknown>
}

function createFakeCookieStore(initial: Record<string, string> = {}) {
  const values = new Map<string, string>(Object.entries(initial))
  const writes: CookieWrite[] = []
  const deletes: string[] = []

  return {
    values,
    writes,
    deletes,
    store: {
      get(name: string) {
        const value = values.get(name)
        return value === undefined ? undefined : { name, value }
      },
      set(name: string, value: string, options?: Record<string, unknown>) {
        values.set(name, value)
        writes.push({ name, value, options })
      },
      delete(name: string) {
        values.delete(name)
        deletes.push(name)
      },
    },
  }
}

function createFakeApi(overrides: Partial<{
  getUser: (accessToken: string) => Promise<CognitoPrincipal>
  refresh: (refreshToken: string) => Promise<{
    accessToken: string
    idToken?: string
    refreshToken?: string
    expiresIn: number
  }>
}> = {}) {
  return {
    getUser: vi.fn(
      overrides.getUser ??
        (async () => ({
          sub: 'cognito-sub-123',
          email: 'captain@example.com',
          emailVerified: true,
        })),
    ),
    refresh: vi.fn(
      overrides.refresh ??
        (async () => ({
          accessToken: 'rotated-access-token',
          expiresIn: 3600,
        })),
    ),
  }
}

describe('Cognito server session verification', () => {
  it('returns null when no access cookie exists', async () => {
    const fake = createFakeCookieStore()
    const api = createFakeApi()
    const sessions = createCognitoSessionManager({
      cookieStore: fake.store,
      api,
      siteUrl: 'https://staging.example.com',
    })

    await expect(sessions.getVerifiedPrincipal()).resolves.toBeNull()
    expect(api.getUser).not.toHaveBeenCalled()
  })

  it('verifies the access cookie with Cognito GetUser and returns the principal', async () => {
    const fake = createFakeCookieStore({
      [COGNITO_COOKIE_NAMES.access]: 'access-token',
    })
    const api = createFakeApi()
    const sessions = createCognitoSessionManager({
      cookieStore: fake.store,
      api,
      siteUrl: 'https://staging.example.com',
    })

    await expect(sessions.getVerifiedPrincipal()).resolves.toEqual({
      sub: 'cognito-sub-123',
      email: 'captain@example.com',
      emailVerified: true,
    })
    expect(api.getUser).toHaveBeenCalledWith('access-token')
  })

  it('refreshes with the refresh cookie and rotates only the access cookie when Cognito returns no new refresh token', async () => {
    const fake = createFakeCookieStore({
      [COGNITO_COOKIE_NAMES.access]: 'expired-access-token',
      [COGNITO_COOKIE_NAMES.refresh]: 'refresh-token',
    })
    const api = createFakeApi()
    const sessions = createCognitoSessionManager({
      cookieStore: fake.store,
      api,
      siteUrl: 'https://staging.example.com',
    })

    await expect(sessions.refreshSession()).resolves.toBe(true)
    expect(api.refresh).toHaveBeenCalledWith('refresh-token')
    expect(fake.values.get(COGNITO_COOKIE_NAMES.access)).toBe('rotated-access-token')
    expect(fake.values.get(COGNITO_COOKIE_NAMES.refresh)).toBe('refresh-token')
    expect(fake.writes).toHaveLength(1)
    expect(fake.writes[0]).toMatchObject({
      name: COGNITO_COOKIE_NAMES.access,
      value: 'rotated-access-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 3600,
      },
    })
  })

  it('clears every Cognito cookie when refresh authorization fails', async () => {
    const fake = createFakeCookieStore({
      [COGNITO_COOKIE_NAMES.access]: 'expired-access-token',
      [COGNITO_COOKIE_NAMES.refresh]: 'invalid-refresh-token',
      [COGNITO_COOKIE_NAMES.challenge]: 'challenge-session',
      [COGNITO_COOKIE_NAMES.challengeUser]: 'captain@example.com',
    })
    const api = createFakeApi({
      refresh: async () => {
        throw new CognitoApiError('NotAuthorizedException')
      },
    })
    const sessions = createCognitoSessionManager({
      cookieStore: fake.store,
      api,
      siteUrl: 'https://staging.example.com',
    })

    await expect(sessions.refreshSession()).resolves.toBe(false)
    expect(fake.deletes).toEqual([
      COGNITO_COOKIE_NAMES.access,
      COGNITO_COOKIE_NAMES.refresh,
      COGNITO_COOKIE_NAMES.challenge,
      COGNITO_COOKIE_NAMES.challengeUser,
    ])
  })

  it('rejects a GetUser response without a Cognito sub as unauthenticated', async () => {
    const fake = createFakeCookieStore({
      [COGNITO_COOKIE_NAMES.access]: 'access-token',
    })
    const api = createFakeApi({
      getUser: async () => ({
        sub: '',
        email: 'captain@example.com',
        emailVerified: true,
      }),
    })
    const sessions = createCognitoSessionManager({
      cookieStore: fake.store,
      api,
      siteUrl: 'https://staging.example.com',
    })

    await expect(sessions.getVerifiedPrincipal()).resolves.toBeNull()
  })

  it('requireVerifiedPrincipal throws a generic unauthenticated error without token data', async () => {
    const fake = createFakeCookieStore()
    const api = createFakeApi()
    const sessions = createCognitoSessionManager({
      cookieStore: fake.store,
      api,
      siteUrl: 'https://staging.example.com',
    })

    await expect(sessions.requireVerifiedPrincipal()).rejects.toBeInstanceOf(
      CognitoUnauthenticatedError,
    )
    await expect(sessions.requireVerifiedPrincipal()).rejects.toThrow('Authentication required.')
  })
})
