import { describe, expect, it } from 'vitest'
import { profileIdentitySectionSchema } from './profile-inline-schemas'

describe('inline profile username validation', () => {
  const base = {
    fullName: 'Captain Example',
    slug: 'captain-example',
    location: 'Mumbai',
    headline: 'Master Mariner',
    currentCompany: 'Example Shipping',
    contactVisibility: 'members' as const,
  }

  it('uses the same normalized username contract as onboarding', () => {
    const result = profileIdentitySectionSchema.safeParse({
      ...base,
      slug: '  Captain.Saurabh_01  ',
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.slug).toBe('captain.saurabh_01')
  })

  it('rejects reserved usernames in inline editing', () => {
    expect(profileIdentitySectionSchema.safeParse({ ...base, slug: 'jobs' }).success).toBe(false)
  })
})
