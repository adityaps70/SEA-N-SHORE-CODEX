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
          name: 'Captain Example',
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
      name: 'Captain Example',
    })
    expect(api.getUser).toHaveBeenCalledWith('access-token')
  })

  it('refreshes with the refresh cookie and writes it again for another 30 days when Cognito returns no new refresh token (Round I, I3)', async () => {
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
    expect(fake.writes).toHaveLength(2)
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
    // The sliding session: every refresh moves the refresh cookie's expiry 30 days on.
    expect(fake.writes[1]).toEqual({
      name: COGNITO_COOKIE_NAMES.refresh,
      value: 'refresh-token',
      options: { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 30 },
    })
  })

  it('keeps the rotated refresh token and records the rotation (Round I, I3)', async () => {
    const fake = createFakeCookieStore({ [COGNITO_COOKIE_NAMES.refresh]: 'refresh-token-1' })
    const api = createFakeApi({
      refresh: async () => ({ accessToken: 'access-2', refreshToken: 'refresh-token-2', expiresIn: 3600 }),
    })
    const ledger = { check: vi.fn(async () => 'ok' as const), record: vi.fn(async () => undefined) }
    const sessions = createCognitoSessionManager({ cookieStore: fake.store, api, siteUrl: 'https://staging.example.com', ledger })

    await expect(sessions.refreshSession()).resolves.toBe(true)
    expect(fake.values.get(COGNITO_COOKIE_NAMES.refresh)).toBe('refresh-token-2')
    expect(ledger.check).toHaveBeenCalledWith('refresh-token-1')
    expect(ledger.record).toHaveBeenCalledWith({
      previousRefreshToken: 'refresh-token-1',
      authentication: { accessToken: 'access-2', refreshToken: 'refresh-token-2', expiresIn: 3600 },
    })
  })

  it('ends the session without asking Cognito when an already-rotated refresh token comes back (Round I, I3)', async () => {
    const fake = createFakeCookieStore({
      [COGNITO_COOKIE_NAMES.access]: 'expired-access-token',
      [COGNITO_COOKIE_NAMES.refresh]: 'stolen-old-refresh-token',
    })
    const api = createFakeApi()
    const ledger = { check: vi.fn(async () => 'reused' as const), record: vi.fn(async () => undefined) }
    const sessions = createCognitoSessionManager({ cookieStore: fake.store, api, siteUrl: 'https://staging.example.com', ledger })

    await expect(sessions.refreshSession()).resolves.toBe(false)
    expect(api.refresh).not.toHaveBeenCalled()
    expect(ledger.record).not.toHaveBeenCalled()
    expect(fake.values.has(COGNITO_COOKIE_NAMES.access)).toBe(false)
    expect(fake.values.has(COGNITO_COOKIE_NAMES.refresh)).toBe(false)
  })

  it('treats a refresh token Cognito refuses as reused like a refused one: cookies cleared, counted, our record ended (Round ARCH)', async () => {
    const fake = createFakeCookieStore({
      [COGNITO_COOKIE_NAMES.access]: 'expired-access-token',
      [COGNITO_COOKIE_NAMES.refresh]: 'reused-refresh-token',
    })
    const api = createFakeApi({ refresh: async () => { throw new CognitoApiError('RefreshTokenReuseException') } })
    const ledger = { check: vi.fn(async () => 'ok' as const), record: vi.fn(async () => undefined), endSession: vi.fn(async () => undefined) }
    const onRefreshReuse = vi.fn()
    const sessions = createCognitoSessionManager({ cookieStore: fake.store, api, siteUrl: 'https://staging.example.com', ledger, onRefreshReuse })

    await expect(sessions.refreshSession()).resolves.toBe(false)
    expect(fake.values.has(COGNITO_COOKIE_NAMES.access)).toBe(false)
    expect(fake.values.has(COGNITO_COOKIE_NAMES.refresh)).toBe(false)
    expect(onRefreshReuse).toHaveBeenCalledWith('cognito')
    expect(onRefreshReuse).toHaveBeenCalledTimes(1)
    expect(ledger.endSession).toHaveBeenCalledWith('reused-refresh-token')
    expect(ledger.record).not.toHaveBeenCalled()
    expect(new CognitoApiError('RefreshTokenReuseException').message).toBe('This sign-in was renewed elsewhere and has ended.')
  })

  it('never throws on a reused refresh token, even when ending our record or counting it fails (Round ARCH)', async () => {
    const fake = createFakeCookieStore({ [COGNITO_COOKIE_NAMES.refresh]: 'reused-refresh-token' })
    const api = createFakeApi({ refresh: async () => { throw new CognitoApiError('RefreshTokenReuseException') } })
    const ledger = { check: vi.fn(async () => 'ok' as const), record: vi.fn(async () => undefined), endSession: vi.fn(async () => { throw new Error('db down') }) }
    const onRefreshReuse = vi.fn(() => { throw new Error('metrics down') })
    const sessions = createCognitoSessionManager({ cookieStore: fake.store, api, siteUrl: 'https://staging.example.com', ledger, onRefreshReuse })
    await expect(sessions.refreshSession()).resolves.toBe(false)
  })

  it('counts a reuse our ledger catches before asking Cognito (Round ARCH)', async () => {
    const fake = createFakeCookieStore({ [COGNITO_COOKIE_NAMES.refresh]: 'stolen-old-refresh-token' })
    const api = createFakeApi()
    const ledger = { check: vi.fn(async () => 'reused' as const), record: vi.fn(async () => undefined) }
    const onRefreshReuse = vi.fn()
    const sessions = createCognitoSessionManager({ cookieStore: fake.store, api, siteUrl: 'https://staging.example.com', ledger, onRefreshReuse })
    await expect(sessions.refreshSession()).resolves.toBe(false)
    expect(onRefreshReuse).toHaveBeenCalledWith('ledger')
    expect(api.refresh).not.toHaveBeenCalled()
  })

  it('still throws other Cognito errors (a transport failure is not a signed-out visitor)', async () => {
    const fake = createFakeCookieStore({ [COGNITO_COOKIE_NAMES.refresh]: 'refresh-token' })
    const api = createFakeApi({ refresh: async () => { throw new CognitoApiError('TransportError') } })
    const sessions = createCognitoSessionManager({ cookieStore: fake.store, api, siteUrl: 'https://staging.example.com' })
    await expect(sessions.refreshSession()).rejects.toBeInstanceOf(CognitoApiError)
    expect(fake.values.has(COGNITO_COOKIE_NAMES.refresh)).toBe(true)
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
      COGNITO_COOKIE_NAMES.phoneChallenge,
      COGNITO_COOKIE_NAMES.phoneChallengeUser,
      COGNITO_COOKIE_NAMES.oauthState,
      COGNITO_COOKIE_NAMES.oauthVerifier,
      COGNITO_COOKIE_NAMES.oauthIntent,
      COGNITO_COOKIE_NAMES.mfaChallenge,
      COGNITO_COOKIE_NAMES.mfaChallengeUser,
      COGNITO_COOKIE_NAMES.mfaChallengeBinding,
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
        name: 'Captain Example',
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
