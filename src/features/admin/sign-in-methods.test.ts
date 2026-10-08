import { describe, expect, it } from 'vitest'
import { signInMethodsLabel } from './sign-in-methods'

describe('signInMethodsLabel', () => {
  it('names how many sign-ins a member has and which kinds', () => {
    expect(signInMethodsLabel({ loginMethods: 3, loginKinds: ['email', 'google'] })).toBe('3 sign-in methods: Email, Google')
    expect(signInMethodsLabel({ loginMethods: 2, loginKinds: ['email', 'phone'] })).toBe('2 sign-in methods: Email, Mobile')
  })

  it('stays silent for a single sign-in or none', () => {
    expect(signInMethodsLabel({ loginMethods: 1, loginKinds: ['email'] })).toBeNull()
    expect(signInMethodsLabel({ loginMethods: 0, loginKinds: [] })).toBeNull()
  })
})
