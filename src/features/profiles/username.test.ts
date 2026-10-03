import { describe, expect, it } from 'vitest'
import { normalizeUsername, usernameSchema } from './username'

describe('Sea N Shore usernames', () => {
  it('normalizes usernames to lowercase while preserving supported separators', () => {
    expect(normalizeUsername('  Captain.Saurabh_01  ')).toBe('captain.saurabh_01')
    expect(normalizeUsername('Chief-Officer')).toBe('chief-officer')
  })

  it('accepts a stable maritime username format', () => {
    expect(usernameSchema.safeParse('capt.saurabh_01').success).toBe(true)
    expect(usernameSchema.safeParse('chief-officer').success).toBe(true)
  })

  it('rejects malformed or reserved usernames before checking the database', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false)
    expect(usernameSchema.safeParse('.captain').success).toBe(false)
    expect(usernameSchema.safeParse('captain..saurabh').success).toBe(false)
    expect(usernameSchema.safeParse('jobs').success).toBe(false)
    expect(usernameSchema.safeParse('SeaNShore').success).toBe(false)
  })
})
