import { describe, expect, it } from 'vitest'
import { onboardingActivationSchema } from './schemas'

const base = {
  identityRoot: 'professional',
  primaryIdentity: 'Chief Engineer',
  primaryIdentityFamily: 'Sea-going · Engine',
  secondaryIdentities: JSON.stringify(['Mentor', 'ISM Auditor']),
  fullName: 'Asha Singh',
  slug: 'asha-singh',
  location: 'Mumbai',
  currentCompany: 'Oceanic Shipping',
  headline: '',
  contactVisibility: 'members',
}

describe('onboarding activation schema', () => {
  it('keeps activation lightweight and preserves exact identities', () => {
    const result = onboardingActivationSchema.parse(base)

    expect(result.primaryIdentity).toBe('Chief Engineer')
    expect(result.primaryIdentityFamily).toBe('Sea-going · Engine')
    expect(result.secondaryIdentities).toEqual(['Mentor', 'ISM Auditor'])
    expect(result.headline).toBe('Chief Engineer')
    expect(result).not.toHaveProperty('summary')
    expect(result).not.toHaveProperty('rank')
  })

  it('rejects a catalog identity paired with the wrong family', () => {
    const result = onboardingActivationSchema.safeParse({
      ...base,
      primaryIdentityFamily: 'Legal, Insurance & Finance',
    })

    expect(result.success).toBe(false)
  })

  it('allows a custom exact identity when the user cannot find a catalog role', () => {
    const result = onboardingActivationSchema.parse({
      ...base,
      primaryIdentity: 'Marine Robotics Specialist',
      primaryIdentityFamily: 'Custom identity',
      secondaryIdentities: '[]',
    })

    expect(result.primaryIdentity).toBe('Marine Robotics Specialist')
    expect(result.primaryIdentityFamily).toBe('Custom identity')
  })

  it('supports organisation activation without pretending company features are live', () => {
    const result = onboardingActivationSchema.parse({
      identityRoot: 'organisation',
      primaryIdentity: 'Shipowner',
      primaryIdentityFamily: 'Shipping & Ship Management',
      secondaryIdentities: JSON.stringify(['Technical Ship Manager']),
      fullName: 'Oceanic Marine Pvt Ltd',
      slug: 'oceanic-marine',
      location: 'Mumbai',
      headline: '',
      contactVisibility: 'members',
    })

    expect(result.identityRoot).toBe('organisation')
    expect(result.headline).toBe('Shipowner')
  })
})
