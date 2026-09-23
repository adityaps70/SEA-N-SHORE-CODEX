import { describe, expect, it, vi } from 'vitest'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'
import { createPhoneAuthActions } from './phone-auth-actions'

function fakeCookies(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    store: {
      get(name: string) {
        const value = values.get(name)
        return value === undefined ? undefined : { name, value }
      },
      set(name: string, value: string) {
        values.set(name, value)
      },
      delete(name: string) {
        values.delete(name)
      },
    },
  }
}

function form(values: Record<string, string>) {
  const data = new FormData()
  Object.entries(values).forEach(([key, value]) => data.set(key, value))
  return data
}

describe('phone OTP auth actions', () => {
  it('starts OTP sign-in for an existing verified phone identity', async () => {
    const cookies = fakeCookies()
    const api = {
      startCustomAuth: vi.fn(async () => ({
        kind: 'challenge' as const,
        session: 'phone-session',
        username: 'uuid-user',
      })),
      respondToCustomChallenge: vi.fn(),
    }
    const admin = {
      findUserByPhone: vi.fn(async () => ({ username: 'uuid-user', verified: true })),
      createPhoneUser: vi.fn(),
      markPhoneVerified: vi.fn(),
    }
    const actions = createPhoneAuthActions({
      api: api as never,
      admin,
      cookieStore: cookies.store,
      siteUrl: 'https://staging.example.com',
    })

    await expect(actions.requestOtp({}, form({
      intent: 'sign-in',
      phoneNumber: '+919876543210',
    }))).resolves.toEqual({
      message: 'Verification code sent.',
      next: 'confirm-phone',
    })

    expect(api.startCustomAuth).toHaveBeenCalledWith('uuid-user')
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.phoneChallenge)).toBe('phone-session')
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.phoneChallengeUser)).toBe('uuid-user')
  })

  it('creates a phone-first Cognito user for OTP sign-up when no phone identity exists', async () => {
    const cookies = fakeCookies()
    const api = {
      startCustomAuth: vi.fn(async () => ({
        kind: 'challenge' as const,
        session: 'new-session',
        username: 'new-user',
      })),
      respondToCustomChallenge: vi.fn(),
    }
    const admin = {
      findUserByPhone: vi.fn(async () => null),
      createPhoneUser: vi.fn(async () => ({ username: 'new-user' })),
      markPhoneVerified: vi.fn(),
    }
    const actions = createPhoneAuthActions({
      api: api as never,
      admin,
      cookieStore: cookies.store,
      siteUrl: 'https://staging.example.com',
    })

    await expect(actions.requestOtp({}, form({
      intent: 'sign-up',
      phoneNumber: '+919876543210',
      fullName: 'Captain Phone',
    }))).resolves.toMatchObject({ next: 'confirm-phone' })

    expect(admin.createPhoneUser).toHaveBeenCalledWith({
      phoneNumber: '+919876543210',
      fullName: 'Captain Phone',
    })
  })

  it('reuses an unverified prior phone sign-up rather than creating another Cognito user', async () => {
    const cookies = fakeCookies()
    const api = {
      startCustomAuth: vi.fn(async () => ({
        kind: 'challenge' as const,
        session: 'retry-session',
        username: 'pending-user',
      })),
      respondToCustomChallenge: vi.fn(),
    }
    const admin = {
      findUserByPhone: vi.fn(async () => ({ username: 'pending-user', verified: false })),
      createPhoneUser: vi.fn(),
      markPhoneVerified: vi.fn(),
    }
    const actions = createPhoneAuthActions({
      api: api as never,
      admin,
      cookieStore: cookies.store,
      siteUrl: 'https://staging.example.com',
    })

    await actions.requestOtp({}, form({
      intent: 'sign-up',
      phoneNumber: '+919876543210',
      fullName: 'Captain Phone',
    }))

    expect(admin.createPhoneUser).not.toHaveBeenCalled()
    expect(api.startCustomAuth).toHaveBeenCalledWith('pending-user')
  })

  it('does not allow an unverified pending phone identity to use sign-in mode', async () => {
    const cookies = fakeCookies()
    const api = {
      startCustomAuth: vi.fn(),
      respondToCustomChallenge: vi.fn(),
    }
    const admin = {
      findUserByPhone: vi.fn(async () => ({ username: 'pending-user', verified: false })),
      createPhoneUser: vi.fn(),
      markPhoneVerified: vi.fn(),
    }
    const actions = createPhoneAuthActions({
      api: api as never,
      admin,
      cookieStore: cookies.store,
      siteUrl: 'https://staging.example.com',
    })

    await expect(actions.requestOtp({}, form({
      intent: 'sign-in',
      phoneNumber: '+919876543210',
    }))).resolves.toEqual({
      error: 'We could not send a verification code. Check the number or create an account.',
    })
    expect(api.startCustomAuth).not.toHaveBeenCalled()
  })

  it('marks the phone verified and stores auth tokens only after a correct OTP', async () => {
    const cookies = fakeCookies({
      [COGNITO_COOKIE_NAMES.phoneChallenge]: 'phone-session',
      [COGNITO_COOKIE_NAMES.phoneChallengeUser]: 'uuid-user',
    })
    const api = {
      startCustomAuth: vi.fn(),
      respondToCustomChallenge: vi.fn(async () => ({
        kind: 'authenticated' as const,
        authentication: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresIn: 3600,
        },
      })),
    }
    const admin = {
      findUserByPhone: vi.fn(),
      createPhoneUser: vi.fn(),
      markPhoneVerified: vi.fn(async () => undefined),
    }
    const actions = createPhoneAuthActions({
      api: api as never,
      admin,
      cookieStore: cookies.store,
      siteUrl: 'https://staging.example.com',
    })

    await expect(actions.confirmOtp({}, form({ code: '123456' }))).resolves.toEqual({
      message: 'Signed in.',
    })

    expect(api.respondToCustomChallenge).toHaveBeenCalledWith({
      username: 'uuid-user',
      session: 'phone-session',
      answer: '123456',
    })
    expect(admin.markPhoneVerified).toHaveBeenCalledWith('uuid-user')
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.access)).toBe('access-token')
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.refresh)).toBe('refresh-token')
    expect(cookies.values.has(COGNITO_COOKIE_NAMES.phoneChallenge)).toBe(false)
  })

  it('keeps the challenge active and rejects an incorrect OTP without authenticating', async () => {
    const cookies = fakeCookies({
      [COGNITO_COOKIE_NAMES.phoneChallenge]: 'phone-session',
      [COGNITO_COOKIE_NAMES.phoneChallengeUser]: 'uuid-user',
    })
    const api = {
      startCustomAuth: vi.fn(),
      respondToCustomChallenge: vi.fn(async () => ({
        kind: 'challenge' as const,
        session: 'next-session',
        username: 'uuid-user',
      })),
    }
    const admin = {
      findUserByPhone: vi.fn(),
      createPhoneUser: vi.fn(),
      markPhoneVerified: vi.fn(),
    }
    const actions = createPhoneAuthActions({
      api: api as never,
      admin,
      cookieStore: cookies.store,
      siteUrl: 'https://staging.example.com',
    })

    await expect(actions.confirmOtp({}, form({ code: '000000' }))).resolves.toEqual({
      error: 'That code is incorrect or expired. Try again.',
      next: 'confirm-phone',
    })
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.phoneChallenge)).toBe('next-session')
    expect(admin.markPhoneVerified).not.toHaveBeenCalled()
    expect(cookies.values.has(COGNITO_COOKIE_NAMES.access)).toBe(false)
  })
})
