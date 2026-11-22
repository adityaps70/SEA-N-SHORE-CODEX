import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError, type CognitoPrincipal } from './cognito-api'
import { COGNITO_COOKIE_NAMES } from './cognito-cookies'
import {
  CognitoUnauthenticatedError,
  createCognitoSessionManager,
} from './cognito-session'
import { createRefreshSingleFlight } from './refresh-single-flight'

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
    const ledger = { check: vi.fn(async () => 'ok' as const), recover: vi.fn(async () => null), endReused: vi.fn(async () => undefined), record: vi.fn(async () => undefined) }
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
    const ledger = { check: vi.fn(async () => 'reused' as const), recover: vi.fn(async () => null), endReused: vi.fn(async () => undefined), record: vi.fn(async () => undefined) }
    const sessions = createCognitoSessionManager({ cookieStore: fake.store, api, siteUrl: 'https://staging.example.com', ledger })

    await expect(sessions.refreshSession()).resolves.toBe(false)
    expect(api.refresh).not.toHaveBeenCalled()
    expect(ledger.record).not.toHaveBeenCalled()
    expect(fake.values.has(COGNITO_COOKIE_NAMES.access)).toBe(false)
    expect(fake.values.has(COGNITO_COOKIE_NAMES.refresh)).toBe(false)
    // Owner (19 Nov): check no longer ends the sign-in itself; with nothing to recover, endReused does.
    expect(ledger.recover).toHaveBeenCalledWith('stolen-old-refresh-token')
    expect(ledger.endReused).toHaveBeenCalledWith('stolen-old-refresh-token')
  })

  it('treats a refresh token Cognito refuses as reused like a refused one: cookies cleared, counted, our record ended (Round ARCH)', async () => {
    const fake = createFakeCookieStore({
      [COGNITO_COOKIE_NAMES.access]: 'expired-access-token',
      [COGNITO_COOKIE_NAMES.refresh]: 'reused-refresh-token',
    })
    const api = createFakeApi({ refresh: async () => { throw new CognitoApiError('RefreshTokenReuseException') } })
    const ledger = { check: vi.fn(async () => 'ok' as const), recover: vi.fn(async () => null), endReused: vi.fn(async () => undefined), record: vi.fn(async () => undefined), endSession: vi.fn(async () => undefined) }
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
    const ledger = { check: vi.fn(async () => 'ok' as const), recover: vi.fn(async () => null), endReused: vi.fn(async () => undefined), record: vi.fn(async () => undefined), endSession: vi.fn(async () => { throw new Error('db down') }) }
    const onRefreshReuse = vi.fn(() => { throw new Error('metrics down') })
    const sessions = createCognitoSessionManager({ cookieStore: fake.store, api, siteUrl: 'https://staging.example.com', ledger, onRefreshReuse })
    await expect(sessions.refreshSession()).resolves.toBe(false)
  })

  it('owner 19 Nov: a reused token whose renewal can be recovered renews from the recovered token, through the single renewal, and is counted', async () => {
    const fake = createFakeCookieStore({ [COGNITO_COOKIE_NAMES.refresh]: 'old-refresh-token' })
    const api = createFakeApi({ refresh: async () => ({ accessToken: 'access-3', refreshToken: 'refresh-token-3', expiresIn: 3600 }) })
    const recovered = { accessToken: 'access-2', refreshToken: 'refresh-token-2', expiresIn: 60 }
    const ledger = {
      check: vi.fn(async () => 'reused' as const),
      recover: vi.fn(async () => recovered),
      endReused: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    }
    const renew = vi.fn(async (_token: string, refresh: () => Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }>) => refresh())
    const onRefreshRecovered = vi.fn()
    const onRefreshReuse = vi.fn()
    const sessions = createCognitoSessionManager({ cookieStore: fake.store, api, siteUrl: 'https://staging.example.com', ledger, renew, onRefreshRecovered, onRefreshReuse })

    await expect(sessions.refreshSession()).resolves.toBe(true)
    expect(ledger.recover).toHaveBeenCalledWith('old-refresh-token')
    // Cognito is sent the recovered token, never the old one: the recovery is shared by requests carrying the old
    // token, and its Cognito renewal is keyed on the recovered token, as for any renewal.
    expect(api.refresh.mock.calls).toEqual([['refresh-token-2']])
    expect(renew.mock.calls.map((call) => call[0])).toEqual(['old-refresh-token', 'refresh-token-2'])
    expect(fake.values.get(COGNITO_COOKIE_NAMES.refresh)).toBe('refresh-token-3')
    expect(fake.values.get(COGNITO_COOKIE_NAMES.access)).toBe('access-3')
    expect(ledger.record).toHaveBeenCalledWith({
      previousRefreshToken: 'refresh-token-2',
      authentication: { accessToken: 'access-3', refreshToken: 'refresh-token-3', expiresIn: 3600 },
    })
    expect(onRefreshRecovered).toHaveBeenCalledTimes(1)
    expect(onRefreshReuse).not.toHaveBeenCalled()
    expect(ledger.endReused).not.toHaveBeenCalled()
  })

  it('owner 19 Nov: requests that wake together with the old token share one recovery instead of the second ending the sign-in', async () => {
    const api = createFakeApi({ refresh: async () => ({ accessToken: 'access-3', refreshToken: 'refresh-token-3', expiresIn: 3600 }) })
    let kept: { accessToken: string; refreshToken: string; expiresIn: number } | null = { accessToken: 'access-2', refreshToken: 'refresh-token-2', expiresIn: 60 }
    const ledger = {
      check: vi.fn(async () => 'reused' as const),
      // Recoverable once: the second call finds it spent.
      recover: vi.fn(async () => { const set = kept; kept = null; return set }),
      endReused: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    }
    const renew = createRefreshSingleFlight()
    const onRefreshRecovered = vi.fn()
    const jars = [0, 1, 2].map(() => createFakeCookieStore({ [COGNITO_COOKIE_NAMES.refresh]: 'old-refresh-token' }))
    const results = await Promise.all(jars.map((jar) => createCognitoSessionManager({ cookieStore: jar.store, api, siteUrl: 'https://staging.example.com', ledger, renew, onRefreshRecovered }).refreshSession()))
    expect(results).toEqual([true, true, true])
    for (const jar of jars) expect(jar.values.get(COGNITO_COOKIE_NAMES.refresh)).toBe('refresh-token-3')
    expect(ledger.recover).toHaveBeenCalledTimes(1)
    expect(api.refresh.mock.calls).toEqual([['refresh-token-2']])
    expect(ledger.record).toHaveBeenCalledTimes(1)
    expect(onRefreshRecovered).toHaveBeenCalledTimes(1)
    expect(ledger.endReused).not.toHaveBeenCalled()
  })

  it('owner 19 Nov: when the recovered token fails at Cognito (or recovery throws), the sign-in ends as reuse always did', async () => {
    for (const failure of ['cognito', 'recover'] as const) {
      const fake = createFakeCookieStore({ [COGNITO_COOKIE_NAMES.access]: 'expired', [COGNITO_COOKIE_NAMES.refresh]: 'old-refresh-token' })
      const api = createFakeApi({ refresh: async () => { throw new CognitoApiError(failure === 'cognito' ? 'NotAuthorizedException' : 'TransportError') } })
      const ledger = {
        check: vi.fn(async () => 'reused' as const),
        recover: vi.fn(async () => {
          if (failure === 'recover') throw new Error('db down')
          return { accessToken: 'access-2', refreshToken: 'refresh-token-2', expiresIn: 60 }
        }),
        endReused: vi.fn(async () => undefined),
        record: vi.fn(async () => undefined),
      }
      const onRefreshRecovered = vi.fn()
      const onRefreshReuse = vi.fn()
      const sessions = createCognitoSessionManager({ cookieStore: fake.store, api, siteUrl: 'https://staging.example.com', ledger, onRefreshRecovered, onRefreshReuse })
      await expect(sessions.refreshSession()).resolves.toBe(false)
      expect(api.refresh.mock.calls).toEqual(failure === 'cognito' ? [['refresh-token-2']] : [])
      expect(fake.values.has(COGNITO_COOKIE_NAMES.refresh)).toBe(false)
      expect(fake.values.has(COGNITO_COOKIE_NAMES.access)).toBe(false)
      expect(ledger.endReused).toHaveBeenCalledWith('old-refresh-token')
      expect(ledger.record).not.toHaveBeenCalled()
      expect(onRefreshReuse).toHaveBeenCalledWith('ledger')
      expect(onRefreshRecovered).not.toHaveBeenCalled()
    }
  })

  it('counts a reuse our ledger catches before asking Cognito (Round ARCH)', async () => {
    const fake = createFakeCookieStore({ [COGNITO_COOKIE_NAMES.refresh]: 'stolen-old-refresh-token' })
    const api = createFakeApi()
    const ledger = { check: vi.fn(async () => 'reused' as const), recover: vi.fn(async () => null), endReused: vi.fn(async () => undefined), record: vi.fn(async () => undefined) }
    const onRefreshReuse = vi.fn()
    const sessions = createCognitoSessionManager({ cookieStore: fake.store, api, siteUrl: 'https://staging.example.com', ledger, onRefreshReuse })
    await expect(sessions.refreshSession()).resolves.toBe(false)
    expect(onRefreshReuse).toHaveBeenCalledWith('ledger')
    expect(api.refresh).not.toHaveBeenCalled()
  })

  it('renews through the shared single renewal when one is given, so parallel requests set the same tokens (owner 15 Nov)', async () => {
    const api = createFakeApi({ refresh: async () => ({ accessToken: 'shared-access', refreshToken: 'shared-refresh', expiresIn: 3600 }) })
    const renew = vi.fn(async (_token: string, refresh: () => Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }>) => refresh())
    const jars = [0, 1].map(() => createFakeCookieStore({ [COGNITO_COOKIE_NAMES.refresh]: 'old-refresh' }))
    const results = await Promise.all(jars.map((jar) => createCognitoSessionManager({ cookieStore: jar.store, api, siteUrl: 'https://staging.example.com', renew }).refreshSession()))
    expect(results).toEqual([true, true])
    expect(renew).toHaveBeenCalledTimes(2)
    expect(renew.mock.calls.map((call) => call[0])).toEqual(['old-refresh', 'old-refresh'])
    for (const jar of jars) expect(jar.values.get(COGNITO_COOKIE_NAMES.refresh)).toBe('shared-refresh')
  })

  it('handles a refusal that comes through the shared renewal like one from Cognito', async () => {
    const fake = createFakeCookieStore({ [COGNITO_COOKIE_NAMES.refresh]: 'refused-refresh' })
    const onRefreshReuse = vi.fn()
    const sessions = createCognitoSessionManager({
      cookieStore: fake.store,
      api: createFakeApi(),
      siteUrl: 'https://staging.example.com',
      onRefreshReuse,
      renew: async () => { throw new CognitoApiError('RefreshTokenReuseException') },
    })
    await expect(sessions.refreshSession()).resolves.toBe(false)
    expect(onRefreshReuse).toHaveBeenCalledWith('cognito')
    expect(fake.values.has(COGNITO_COOKIE_NAMES.refresh)).toBe(false)
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
