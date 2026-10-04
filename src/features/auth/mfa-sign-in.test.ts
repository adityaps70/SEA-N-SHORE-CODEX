import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'
import { MFA_SIGN_IN_MESSAGES, createMfaSignInActions, createMfaSignInHandler, normalizeAuthenticatorCode } from './mfa-sign-in'

function fakeCookies(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const options = new Map<string, Record<string, unknown> | undefined>()
  return {
    values,
    options,
    store: {
      get(name: string) {
        const value = values.get(name)
        return value === undefined ? undefined : { name, value }
      },
      set(name: string, value: string, cookieOptions?: Record<string, unknown>) {
        values.set(name, value)
        options.set(name, cookieOptions)
      },
      delete(name: string) {
        values.delete(name)
      },
    },
  }
}

const pending = {
  [COGNITO_COOKIE_NAMES.mfaChallenge]: 'mfa-session',
  [COGNITO_COOKIE_NAMES.mfaChallengeUser]: 'internal-user-1',
}

function form(values: Record<string, string>) {
  const data = new FormData()
  Object.entries(values).forEach(([key, value]) => data.set(key, value))
  return data
}

function setup(initial: Record<string, string> = pending) {
  const cookies = fakeCookies(initial)
  const api = {
    respondToSoftwareTokenMfa: vi.fn(async () => ({ accessToken: 'a1', refreshToken: 'r1', expiresIn: 3600 })),
  }
  const actions = createMfaSignInActions({ api, cookieStore: cookies.store, siteUrl: 'https://staging.example.com' })
  return { api, cookies, actions }
}

describe('authenticator code at sign-in (Round 14, 2.11)', () => {
  it('normalizes a 6-digit code typed with spaces or a dash and rejects anything else', () => {
    expect(normalizeAuthenticatorCode('123 456')).toBe('123456')
    expect(normalizeAuthenticatorCode(' 123-456 ')).toBe('123456')
    for (const value of ['12345', '1234567', 'abcdef', '', null]) {
      expect(normalizeAuthenticatorCode(value)).toBeNull()
    }
  })

  it('answers the challenge from the HTTP-only cookies, then swaps them for the session cookies', async () => {
    const { api, cookies, actions } = setup()

    await expect(actions.confirmSignInMfa({}, form({ code: '123 456' }))).resolves.toEqual({ message: 'Signed in.' })

    expect(api.respondToSoftwareTokenMfa).toHaveBeenCalledWith({ username: 'internal-user-1', session: 'mfa-session', code: '123456' })
    expect(cookies.values.has(COGNITO_COOKIE_NAMES.mfaChallenge)).toBe(false)
    expect(cookies.values.has(COGNITO_COOKIE_NAMES.mfaChallengeUser)).toBe(false)
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.access)).toBe('a1')
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.refresh)).toBe('r1')
    expect(cookies.options.get(COGNITO_COOKIE_NAMES.access)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax' })
  })

  it('checks the code format before calling Cognito', async () => {
    const { api, actions } = setup()
    await expect(actions.confirmSignInMfa({}, form({ code: '12ab' }))).resolves.toEqual({ error: MFA_SIGN_IN_MESSAGES.invalidCode })
    expect(api.respondToSoftwareTokenMfa).not.toHaveBeenCalled()
  })

  it('asks to sign in again when the challenge cookies are gone', async () => {
    const { api, actions } = setup({})
    await expect(actions.confirmSignInMfa({}, form({ code: '123456' }))).resolves.toEqual({ error: MFA_SIGN_IN_MESSAGES.expired })
    expect(api.respondToSoftwareTokenMfa).not.toHaveBeenCalled()
  })

  it('explains a wrong code and keeps the challenge so the member can retry', async () => {
    const { api, cookies, actions } = setup()
    api.respondToSoftwareTokenMfa.mockRejectedValueOnce(new CognitoApiError('CodeMismatchException'))

    const result = await actions.confirmSignInMfa({}, form({ code: '000000' }))

    expect(result).toEqual({ error: MFA_SIGN_IN_MESSAGES.wrongCode })
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.mfaChallenge)).toBe('mfa-session')
    expect(cookies.values.has(COGNITO_COOKIE_NAMES.access)).toBe(false)
  })

  it.each(['NotAuthorizedException', 'ExpiredCodeException'])('treats %s as an expired session and clears it', async (code) => {
    const { api, cookies, actions } = setup()
    api.respondToSoftwareTokenMfa.mockRejectedValueOnce(new CognitoApiError(code))

    await expect(actions.confirmSignInMfa({}, form({ code: '123456' }))).resolves.toEqual({ error: MFA_SIGN_IN_MESSAGES.expired })
    expect(cookies.values.has(COGNITO_COOKIE_NAMES.mfaChallenge)).toBe(false)
    expect(cookies.values.has(COGNITO_COOKIE_NAMES.access)).toBe(false)
  })

  it('stops after too many attempts and falls back to a generic error otherwise', async () => {
    const throttled = setup()
    throttled.api.respondToSoftwareTokenMfa.mockRejectedValueOnce(new CognitoApiError('TooManyRequestsException'))
    await expect(throttled.actions.confirmSignInMfa({}, form({ code: '123456' }))).resolves.toEqual({ error: MFA_SIGN_IN_MESSAGES.tooMany })

    const broken = setup()
    broken.api.respondToSoftwareTokenMfa.mockRejectedValueOnce(new Error('network'))
    await expect(broken.actions.confirmSignInMfa({}, form({ code: '123456' }))).resolves.toEqual({ error: MFA_SIGN_IN_MESSAGES.failed })
  })

  it('reports whether a challenge is pending', () => {
    expect(setup().actions.hasPendingChallenge()).toBe(true)
    expect(setup({}).actions.hasPendingChallenge()).toBe(false)
  })

  it('continues to the normal post-sign-in step only after a successful code', async () => {
    const redirect = vi.fn()
    const confirmSignInMfa = vi.fn()
      .mockResolvedValueOnce({ error: MFA_SIGN_IN_MESSAGES.wrongCode })
      .mockResolvedValueOnce({ message: 'Signed in.' })
    const handler = createMfaSignInHandler({ getActions: async () => ({ confirmSignInMfa } as never), redirect })

    await expect(handler({}, form({ code: '000000' }))).resolves.toEqual({ error: MFA_SIGN_IN_MESSAGES.wrongCode })
    expect(redirect).not.toHaveBeenCalled()
    await handler({}, form({ code: '123456' }))
    expect(redirect).toHaveBeenCalledWith('/auth/post-sign-in')
  })
})
