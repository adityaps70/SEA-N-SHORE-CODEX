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

describe('post-sign-in routing with a return path (round F)', () => {
  const done = { onboardingCompletedAt: '2026-09-05T00:00:00.000Z' }

  it('sends a member back to the page they signed in from', () => {
    expect(resolvePostSignInDestination(done, '/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe('/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  })

  it('still sends a new member through onboarding first (onboarding then returns them)', () => {
    expect(resolvePostSignInDestination({ onboardingCompletedAt: null }, '/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe('/onboarding')
  })

  it('ignores an unsafe return path', () => {
    expect(resolvePostSignInDestination(done, '//evil.com')).toBe('/home')
    expect(resolvePostSignInDestination(done, 'https://other-site.example/')).toBe('/home')
  })
})
