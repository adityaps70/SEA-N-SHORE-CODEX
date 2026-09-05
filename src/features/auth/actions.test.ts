import { describe, expect, it, vi } from 'vitest'
import { createAuthActionHandlers, type AuthActionState } from './action-handlers'

const form = (entries: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}

describe('production Cognito auth action routing', () => {
  it('routes a successful sign-in by Aurora onboarding state', async () => {
    const redirect = vi.fn()
    const signIn = vi.fn(async (): Promise<AuthActionState> => ({ message: 'Signed in.' }))
    const handlers = createAuthActionHandlers({
      getActions: async () => ({ signIn } as never),
      getProfileProgress: async () => ({ onboardingCompletedAt: '2026-09-05T00:00:00.000Z' }),
      redirect,
    })

    await handlers.signIn({}, form({ email: 'captain@example.com', password: 'very-secure-password' }))

    expect(redirect).toHaveBeenCalledWith('/home')
  })

  it('routes an incomplete profile to onboarding after sign-in', async () => {
    const redirect = vi.fn()
    const handlers = createAuthActionHandlers({
      getActions: async () => ({ signIn: vi.fn(async () => ({ message: 'Signed in.' })) } as never),
      getProfileProgress: async () => ({ onboardingCompletedAt: null }),
      redirect,
    })

    await handlers.signIn({}, form({ email: 'captain@example.com', password: 'very-secure-password' }))
    expect(redirect).toHaveBeenCalledWith('/onboarding')
  })

  it('returns a controlled error when post-auth profile resolution fails', async () => {
    const redirect = vi.fn()
    const handlers = createAuthActionHandlers({
      getActions: async () => ({ signIn: vi.fn(async () => ({ message: 'Signed in.' })) } as never),
      getProfileProgress: async () => {
        throw new Error('database unavailable')
      },
      redirect,
    })

    await expect(
      handlers.signIn({}, form({ email: 'captain@example.com', password: 'very-secure-password' })),
    ).resolves.toEqual({ error: 'We signed you in, but could not load your profile. Please try again.' })
    expect(redirect).not.toHaveBeenCalled()
  })

  it('routes NEW_PASSWORD_REQUIRED to the existing update-password surface', async () => {
    const redirect = vi.fn()
    const handlers = createAuthActionHandlers({
      getActions: async () => ({ signIn: vi.fn(async () => ({ next: 'new-password' })) } as never),
      getProfileProgress: vi.fn(),
      redirect,
    })

    await handlers.signIn({}, form({ email: 'captain@example.com', password: 'temporary-password' }))
    expect(redirect).toHaveBeenCalledWith('/auth/update-password?mode=new-password')
  })

  it('routes sign-up to confirmation without exposing whether an account pre-existed', async () => {
    const redirect = vi.fn()
    const handlers = createAuthActionHandlers({
      getActions: async () => ({ signUp: vi.fn(async () => ({ message: 'Check your email to continue.' })) } as never),
      getProfileProgress: vi.fn(),
      redirect,
    })

    await handlers.signUp({}, form({ email: 'new@example.com', password: 'very-secure-password', fullName: 'New Mariner' }))
    expect(redirect).toHaveBeenCalledWith('/auth/sign-up?confirm=1&email=new%40example.com')
  })

  it('routes password-reset requests to code confirmation', async () => {
    const redirect = vi.fn()
    const handlers = createAuthActionHandlers({
      getActions: async () => ({ requestPasswordReset: vi.fn(async () => ({ next: 'confirm-reset' })) } as never),
      getProfileProgress: vi.fn(),
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
      getProfileProgress: vi.fn(),
      redirect,
    })

    await handlers.signOut()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/')
  })
})
