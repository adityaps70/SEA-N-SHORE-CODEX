import { describe, expect, it, vi } from 'vitest'
import { createAuthActionHandlers, type AuthActionState } from './action-handlers'

const form = (entries: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}

describe('production Cognito auth action routing', () => {
  it('crosses a fresh request boundary after successful sign-in', async () => {
    const redirect = vi.fn()
    const signIn = vi.fn(async (): Promise<AuthActionState> => ({ message: 'Signed in.' }))
    const handlers = createAuthActionHandlers({
      getActions: async () => ({ signIn } as never),
      redirect,
    })

    await handlers.signIn({}, form({ email: 'captain@example.com', password: 'very-secure-password' }))

    expect(signIn).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/auth/post-sign-in')
  })

  it('preserves Next redirect control flow after successful sign-in', async () => {
    const nextRedirect = new Error('NEXT_REDIRECT')
    const redirect = vi.fn(() => {
      throw nextRedirect
    })
    const handlers = createAuthActionHandlers({
      getActions: async () => ({ signIn: vi.fn(async () => ({ message: 'Signed in.' })) } as never),
      redirect,
    })

    await expect(
      handlers.signIn({}, form({ email: 'captain@example.com', password: 'very-secure-password' })),
    ).rejects.toBe(nextRedirect)
    expect(redirect).toHaveBeenCalledWith('/auth/post-sign-in')
  })

  it('routes NEW_PASSWORD_REQUIRED to the existing update-password surface', async () => {
    const redirect = vi.fn()
    const handlers = createAuthActionHandlers({
      getActions: async () => ({ signIn: vi.fn(async () => ({ next: 'new-password' })) } as never),
      redirect,
    })

    await handlers.signIn({}, form({ email: 'captain@example.com', password: 'temporary-password' }))
    expect(redirect).toHaveBeenCalledWith('/auth/update-password?mode=new-password')
  })

  it('crosses the same fresh request boundary after NEW_PASSWORD_REQUIRED completion', async () => {
    const redirect = vi.fn()
    const handlers = createAuthActionHandlers({
      getActions: async () => ({
        completeNewPassword: vi.fn(async () => ({ message: 'Password updated.' })),
      } as never),
      redirect,
    })

    await handlers.updatePassword(
      {},
      form({ mode: 'new-password', password: 'new-very-secure-password' }),
    )
    expect(redirect).toHaveBeenCalledWith('/auth/post-sign-in')
  })

  it('routes sign-up to confirmation without exposing whether an account pre-existed', async () => {
    const redirect = vi.fn()
    const handlers = createAuthActionHandlers({
      getActions: async () => ({ signUp: vi.fn(async () => ({ message: 'Check your email to continue.' })) } as never),
      redirect,
    })

    await handlers.signUp({}, form({ email: 'new@example.com', password: 'very-secure-password', fullName: 'New Mariner' }))
    expect(redirect).toHaveBeenCalledWith('/auth/sign-up?confirm=1&email=new%40example.com')
  })

  it('routes password-reset requests to code confirmation', async () => {
    const redirect = vi.fn()
    const handlers = createAuthActionHandlers({
      getActions: async () => ({ requestPasswordReset: vi.fn(async () => ({ next: 'confirm-reset' })) } as never),
      redirect,
    })

    await handlers.requestPasswordReset({}, form({ email: 'captain@example.com' }))
    expect(redirect).toHaveBeenCalledWith('/auth/update-password?mode=confirm-reset&email=captain%40example.com')
  })

  it('always redirects locally after Cognito sign-out completes', async () => {
    const redirect = vi.fn()
    const signOut = vi.fn(async () => undefined)
    const handlers = createAuthActionHandlers({
      getActions: async () => ({ signOut } as never),
      redirect,
    })

    await handlers.signOut()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/')
  })
})
