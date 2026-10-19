// @vitest-environment node
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { createSessionControls } from '@/features/account-security/session-controls'
import { createSessionGuard } from '@/features/account-security/session-guard'
import type { SessionState } from '@/features/account-security/session-repository'
import { CognitoApiError } from './cognito-api'
import { COGNITO_COOKIE_NAMES, createCognitoCookieManager } from './cognito-cookies'
import { createCognitoProxyHandler } from './cognito-proxy'
import { createCognitoSessionManager } from './cognito-session'

/**
 * Round I (I3): the iPhone Home Screen app, end to end through the real cookie manager, session manager and proxy.
 * The jar behaves like the app's cookie store: cookies without Max-Age are dropped when the app is closed, the rest
 * expire by their Max-Age. Cognito is a fake that issues 60-minute access tokens and rotates refresh tokens.
 */
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const SITE = 'https://seanshore.in'

type Stored = { value: string; expiresAt: number | null; options: Record<string, unknown> | undefined }

function createJar(clock: { now: number }) {
  const cookies = new Map<string, Stored>()
  const live = (name: string) => {
    const cookie = cookies.get(name)
    if (cookie && cookie.expiresAt !== null && cookie.expiresAt <= clock.now) cookies.delete(name)
    return cookies.get(name)
  }
  return {
    cookies,
    store: {
      get(name: string) {
        const cookie = live(name)
        return cookie ? { name, value: cookie.value } : undefined
      },
      set(name: string, value: string, options?: { maxAge?: number }) {
        const maxAge = options?.maxAge
        if (maxAge === 0) cookies.delete(name)
        else cookies.set(name, { value, expiresAt: maxAge === undefined ? null : clock.now + maxAge * 1000, options })
      },
      delete(name: string) {
        cookies.delete(name)
      },
    },
    /** Force-closing the app: session cookies are gone; persistent ones stay until they expire. */
    restart() {
      for (const [name, cookie] of cookies) if (cookie.expiresAt === null) cookies.delete(name)
    },
    header() {
      return [...cookies.keys()].filter((name) => live(name)).map((name) => `${name}=${cookies.get(name)!.value}`).join('; ')
    },
  }
}

function createFakeCognito(clock: { now: number }) {
  let serial = 0
  const access = new Map<string, number>()
  const refresh = new Map<string, { retiredAt: number | null; revoked: boolean }>()
  const issue = (rotateFrom?: string) => {
    serial += 1
    const accessToken = `access-${serial}`
    access.set(accessToken, clock.now + HOUR)
    const refreshToken = `refresh-${serial}`
    refresh.set(refreshToken, { retiredAt: null, revoked: false })
    if (rotateFrom) refresh.get(rotateFrom)!.retiredAt = clock.now
    return { accessToken, refreshToken, expiresIn: 3600 }
  }
  return {
    signIn: () => issue(),
    revoke(refreshToken: string) {
      const entry = refresh.get(refreshToken)
      if (entry) entry.revoked = true
    },
    api: {
      async getUser(accessToken: string) {
        const expiresAt = access.get(accessToken)
        if (!expiresAt || expiresAt <= clock.now) throw new CognitoApiError('NotAuthorizedException')
        return { sub: 'member-sub', email: null, emailVerified: true, name: null }
      },
      async refresh(refreshToken: string) {
        const entry = refresh.get(refreshToken)
        // Rotation with a 60-second grace period, like the app client.
        if (!entry || entry.revoked || (entry.retiredAt !== null && clock.now - entry.retiredAt > 60_000)) {
          throw new CognitoApiError('NotAuthorizedException')
        }
        return issue(refreshToken)
      },
    },
  }
}

function openApp(path: string, jar: ReturnType<typeof createJar>, cognito: ReturnType<typeof createFakeCognito>) {
  const request = new NextRequest(`${SITE}${path}`, { headers: { cookie: jar.header() } })
  const session = createCognitoSessionManager({ cookieStore: jar.store, api: cognito.api, siteUrl: SITE })
  return { response: createCognitoProxyHandler(session)(request), session }
}

async function signedIn(jar: ReturnType<typeof createJar>, cognito: ReturnType<typeof createFakeCognito>, path = '/') {
  const { response, session } = openApp(path, jar, cognito)
  expect((await response).status).toBeLessThan(400)
  return Boolean(await session.getVerifiedPrincipal())
}

describe('Home Screen app session (Round I, I3)', () => {
  it('sets only persistent, HTTP-only, Secure, SameSite=Lax session cookies on the site host', () => {
    const clock = { now: 0 }
    const jar = createJar(clock)
    createCognitoCookieManager(jar.store, SITE).setAuthentication(createFakeCognito(clock).signIn())
    for (const name of [COGNITO_COOKIE_NAMES.access, COGNITO_COOKIE_NAMES.refresh]) {
      const cookie = jar.cookies.get(name)!
      expect(cookie.options, name).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: expect.any(Number) })
      // No Domain: the cookie belongs to seanshore.in itself (www redirects there before any page loads).
      expect(cookie.options).not.toHaveProperty('domain')
    }
    expect(jar.cookies.get(COGNITO_COOKIE_NAMES.refresh)!.options!.maxAge).toBe(30 * 24 * 60 * 60)
  })

  it('stays signed in after the app is force-closed and reopened an hour later and the next day', async () => {
    const clock = { now: 0 }
    const jar = createJar(clock)
    const cognito = createFakeCognito(clock)
    createCognitoCookieManager(jar.store, SITE).setAuthentication(cognito.signIn())

    for (const gap of [HOUR + 5 * 60_000, DAY]) {
      jar.restart()
      clock.now += gap
      // The 60-minute access cookie has expired; the app opens at "/" (its start_url) and is renewed there.
      expect(jar.store.get(COGNITO_COOKIE_NAMES.access)).toBeUndefined()
      await expect(signedIn(jar, cognito, '/')).resolves.toBe(true)
    }
  })

  it('slides: used every 25 days it stays signed in past 30 days, and 30 idle days sign it out', async () => {
    const clock = { now: 0 }
    const jar = createJar(clock)
    const cognito = createFakeCognito(clock)
    createCognitoCookieManager(jar.store, SITE).setAuthentication(cognito.signIn())

    for (let visit = 0; visit < 3; visit += 1) {
      jar.restart()
      clock.now += 25 * DAY
      await expect(signedIn(jar, cognito, '/home')).resolves.toBe(true)
    }
    expect(clock.now).toBe(75 * DAY)

    jar.restart()
    clock.now += 30 * DAY + HOUR
    expect(jar.store.get(COGNITO_COOKIE_NAMES.refresh)).toBeUndefined()
    const { response } = openApp('/home', jar, cognito)
    expect((await response).headers.get('location')).toBe(`${SITE}/auth/sign-in?next=%2Fhome`)
  })

  it('sign-out ends the session at once: the cookies go, the refresh token is refused, and an old copy too', async () => {
    const clock = { now: 0 }
    const jar = createJar(clock)
    const cognito = createFakeCognito(clock)
    const tokens = cognito.signIn()
    createCognitoCookieManager(jar.store, SITE).setAuthentication(tokens)

    const row: SessionState = { id: 'session-1', profileId: 'profile-1', revoked: false, reuseDetected: false, lastSeenAt: new Date(0) }
    const repository = {
      findOrCreate: async () => ({ ...row }),
      touch: async () => undefined,
      revoke: async () => ((row.revoked = true), true),
      revokeOthers: async () => [],
    }
    const guard = createSessionGuard({ repository, now: () => clock.now })
    const accessToken = `x.${Buffer.from(JSON.stringify({ origin_jti: 'origin-home-screen' })).toString('base64url')}.y`
    const check = () => guard.check({ accessToken, profileId: 'profile-1', context: () => ({ userAgentSummary: null, city: null, country: null, ip: null }) })
    await expect(check()).resolves.toMatchObject({ status: 'active' })

    // "Sign out": the device's row is revoked, its refresh token revoked at Cognito, its cookies cleared.
    await createSessionControls({ repository, guard }).signOutSession('profile-1', 'session-1', 'signed_out')
    cognito.revoke(tokens.refreshToken)
    createCognitoCookieManager(jar.store, SITE).clearCognitoCookies()

    await expect(check()).resolves.toEqual({ status: 'revoked', sessionId: 'session-1', reason: 'signed_out' })
    await expect(signedIn(jar, cognito, '/')).resolves.toBe(false)
    // A copy of the refresh cookie taken before sign-out no longer renews anything.
    jar.store.set(COGNITO_COOKIE_NAMES.refresh, tokens.refreshToken, { maxAge: 30 * 24 * 60 * 60 })
    await expect(signedIn(jar, cognito, '/')).resolves.toBe(false)
  })
})
