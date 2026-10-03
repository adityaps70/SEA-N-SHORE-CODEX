import { describe, expect, it } from 'vitest'
import { getPublicVisitorActions } from './public-visitor-actions'

describe('getPublicVisitorActions', () => {
  it('shows guest actions when there is no authenticated viewer', () => {
    expect(getPublicVisitorActions(false)).toEqual({
      primary: { label: 'Join Sea N Shore', href: '/auth/sign-up' },
      secondary: { label: 'Sign in', href: '/auth/sign-in' },
      heroPrimary: { label: 'Create your professional profile', href: '/auth/sign-up' },
      heroSecondary: { label: 'Sign in', href: '/auth/sign-in' },
    })
  })

  it('never shows guest actions to an authenticated viewer', () => {
    const actions = getPublicVisitorActions(true)
    expect(actions).toEqual({
      primary: { label: 'My Profile', href: '/profile' },
      secondary: { label: 'Home', href: '/home' },
      heroPrimary: { label: 'Go to Home', href: '/home' },
      heroSecondary: { label: 'View My Profile', href: '/profile' },
    })
    expect(JSON.stringify(actions)).not.toMatch(/Sign in|Join Sea N Shore|Create your professional profile/)
  })
})
