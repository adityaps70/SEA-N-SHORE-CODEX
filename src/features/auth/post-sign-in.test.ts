import { describe, expect, it } from 'vitest'
import { resolvePostSignInDestination } from './post-sign-in'

describe('post-sign-in routing', () => {
  it('routes completed profiles to home', () => {
    expect(resolvePostSignInDestination({ onboardingCompletedAt: '2026-09-05T00:00:00.000Z' })).toBe('/home')
  })

  it('routes incomplete profiles to onboarding', () => {
    expect(resolvePostSignInDestination({ onboardingCompletedAt: null })).toBe('/onboarding')
  })
})
