import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError, type CognitoSignInResult } from '@/lib/auth/cognito-api'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'
import { createCognitoAuthActions } from './cognito-actions'

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

function fakeApi() {
  return {
    signIn: vi.fn(async (): Promise<CognitoSignInResult> => ({
      kind: 'authenticated',
      authentication: { accessToken: 'a1', refreshToken: 'r1', expiresIn: 3600 },
    })),
    respondToNewPassword: vi.fn(async () => ({
      accessToken: 'a2', refreshToken: 'r2', expiresIn: 3600,
    })),
    signUp: vi.fn(async () => ({ userSub: 'sub1', userConfirmed: false })),
    confirmSignUp: vi.fn(async () => undefined),
    forgotPassword: vi.fn(async () => undefined),
    confirmForgotPassword: vi.fn(async () => undefined),
    globalSignOut: vi.fn(async () => undefined),
  }
}

function form(values: Record<string, string>) {
  const data = new FormData()
  Object.entries(values).forEach(([key, value]) => data.set(key, value))
  return data
}

function setup(api = fakeApi(), cookies = fakeCookies()) {
  return {
    api,
    cookies,
    actions: createCognitoAuthActions({
      api,
      cookieStore: cookies.store,
      siteUrl: 'https://staging.example.com',
    }),
  }
}

describe('Cognito auth actions', () => {
  it('validates sign-in before Cognito', async () => {
    const { api, actions } = setup()
    await expect(actions.signIn({}, form({ email: 'bad', password: '' }))).resolves.toEqual({
      error: 'Enter a valid email and password.',
    })
    expect(api.signIn).not.toHaveBeenCalled()
  })

  it.each(['NotAuthorizedException', 'UserNotFoundException'])(
    'uses the same sign-in error for %s',
    async (code) => {
      const api = fakeApi()
      api.signIn.mockRejectedValueOnce(new CognitoApiError(code))
      const { actions } = setup(api)
      await expect(
        actions.signIn({}, form({ email: 'captain@example.com', password: 'LongEnoughPass1' })),
      ).resolves.toEqual({ error: 'Email or password is incorrect.' })
    },
  )

  it('stores NEW_PASSWORD_REQUIRED state in challenge cookies', async () => {
    const api = fakeApi()
    api.signIn.mockResolvedValueOnce({
      kind: 'new-password-required',
      session: 's1',
      username: 'captain@example.com',
    })
    const { actions, cookies } = setup(api)
    await expect(
      actions.signIn({}, form({ email: 'captain@example.com', password: 'LongEnoughPass1' })),
    ).resolves.toEqual({ next: 'new-password' })
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.challenge)).toBe('s1')
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.challengeUser)).toBe('captain@example.com')
  })

  it('writes auth cookies after successful sign-in', async () => {
    const { actions, cookies } = setup()
    await expect(
      actions.signIn({}, form({ email: 'captain@example.com', password: 'LongEnoughPass1' })),
    ).resolves.toEqual({ message: 'Signed in.' })
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.access)).toBe('a1')
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.refresh)).toBe('r1')
  })

  it('completes a new-password challenge and replaces challenge cookies with auth cookies', async () => {
    const cookies = fakeCookies({
      [COGNITO_COOKIE_NAMES.challenge]: 's1',
      [COGNITO_COOKIE_NAMES.challengeUser]: 'captain@example.com',
    })
    const { actions, api } = setup(fakeApi(), cookies)
    await expect(
      actions.completeNewPassword(
        {},
        form({ password: 'NewLongPass123', passwordConfirmation: 'NewLongPass123' }),
      ),
    ).resolves.toEqual({ message: 'Password updated.' })
    expect(api.respondToNewPassword).toHaveBeenCalledWith({
      username: 'captain@example.com',
      newPassword: 'NewLongPass123',
      session: 's1',
    })
    expect(cookies.values.has(COGNITO_COOKIE_NAMES.challenge)).toBe(false)
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.access)).toBe('a2')
  })

  it('keeps sign-up non-enumerating for an existing username', async () => {
    const api = fakeApi()
    api.signUp.mockRejectedValueOnce(new CognitoApiError('UsernameExistsException'))
    const { actions } = setup(api)
    await expect(
      actions.signUp(
        {},
        form({ fullName: 'New Mariner', email: 'new@example.com', password: 'LongEnoughPass1' }),
      ),
    ).resolves.toEqual({ message: 'Check your email to continue.' })
  })

  it('keeps forgot-password non-enumerating for a missing user', async () => {
    const api = fakeApi()
    api.forgotPassword.mockRejectedValueOnce(new CognitoApiError('UserNotFoundException'))
    const { actions } = setup(api)
    await expect(
      actions.requestPasswordReset({}, form({ email: 'missing@example.com' })),
    ).resolves.toEqual({
      message: 'If the account exists, a reset code is on its way.',
      next: 'confirm-reset',
    })
  })

  it('maps an invalid reset code to a safe retry error', async () => {
    const api = fakeApi()
    api.confirmForgotPassword.mockRejectedValueOnce(new CognitoApiError('CodeMismatchException'))
    const { actions } = setup(api)
    await expect(
      actions.confirmPasswordReset(
        {},
        form({
          email: 'captain@example.com',
          code: '000000',
          password: 'ResetLongPass1',
          passwordConfirmation: 'ResetLongPass1',
        }),
      ),
    ).resolves.toEqual({ error: 'The reset code is invalid or expired. Try again.' })
  })

  it('clears local cookies even if remote sign-out fails', async () => {
    const api = fakeApi()
    api.globalSignOut.mockRejectedValueOnce(new CognitoApiError('NotAuthorizedException'))
    const cookies = fakeCookies({
      [COGNITO_COOKIE_NAMES.access]: 'a1',
      [COGNITO_COOKIE_NAMES.refresh]: 'r1',
    })
    const { actions } = setup(api, cookies)
    await expect(actions.signOut()).resolves.toBeUndefined()
    expect(api.globalSignOut).toHaveBeenCalledWith('a1')
    expect(cookies.values.size).toBe(0)
  })
})