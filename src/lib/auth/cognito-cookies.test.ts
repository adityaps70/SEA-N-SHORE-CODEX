import { describe, expect, it } from 'vitest'
import {
  COGNITO_COOKIE_NAMES,
  cognitoCookieOptions,
  createCognitoCookieManager,
} from './cognito-cookies'

type CookieWrite = {
  name: string
  value: string
  options?: Record<string, unknown>
}

function createFakeCookieStore() {
  const values = new Map<string, string>()
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

describe('Cognito cookie primitives', () => {
  it('uses fixed cookie names that contain no user identifiers', () => {
    expect(COGNITO_COOKIE_NAMES).toEqual({
      access: 'sns_cognito_access',
      refresh: 'sns_cognito_refresh',
      challenge: 'sns_cognito_challenge',
      challengeUser: 'sns_cognito_challenge_user',
    })

    for (const name of Object.values(COGNITO_COOKIE_NAMES)) {
      expect(name).not.toContain('@')
      expect(name).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)
    }
  })

  it('marks Cognito cookies HttpOnly, SameSite=Lax and Path=/', () => {
    expect(cognitoCookieOptions('https://staging.example.com')).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
    })
  })

  it('allows non-secure cookies only for an HTTP local development origin', () => {
    expect(cognitoCookieOptions('http://localhost:3000').secure).toBe(false)
    expect(cognitoCookieOptions('https://localhost:3000').secure).toBe(true)
  })

  it('stores access and refresh credentials with bounded lifetimes', () => {
    const fake = createFakeCookieStore()
    const cookies = createCognitoCookieManager(fake.store, 'https://staging.example.com')

    cookies.setAuthentication({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
    })

    expect(fake.writes).toHaveLength(2)
    expect(fake.writes[0]).toMatchObject({
      name: COGNITO_COOKIE_NAMES.access,
      value: 'access-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 3600,
      },
    })
    expect(fake.writes[1]).toMatchObject({
      name: COGNITO_COOKIE_NAMES.refresh,
      value: 'refresh-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      },
    })
  })

  it('limits NEW_PASSWORD_REQUIRED challenge cookies to ten minutes', () => {
    const fake = createFakeCookieStore()
    const cookies = createCognitoCookieManager(fake.store, 'https://staging.example.com')

    cookies.setChallenge({
      session: 'opaque-session',
      username: 'captain@example.com',
    })

    expect(fake.writes).toHaveLength(2)
    for (const write of fake.writes) {
      expect(write.options).toMatchObject({
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 600,
      })
    }
  })

  it('clears every Cognito credential and challenge cookie together', () => {
    const fake = createFakeCookieStore()
    const cookies = createCognitoCookieManager(fake.store, 'https://staging.example.com')

    cookies.clearCognitoCookies()

    expect(fake.deletes).toEqual([
      COGNITO_COOKIE_NAMES.access,
      COGNITO_COOKIE_NAMES.refresh,
      COGNITO_COOKIE_NAMES.challenge,
      COGNITO_COOKIE_NAMES.challengeUser,
    ])
  })
})
