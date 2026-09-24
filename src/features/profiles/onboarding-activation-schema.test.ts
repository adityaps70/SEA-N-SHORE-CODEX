import { describe, expect, it } from 'vitest'
import { onboardingActivationSchema, onboardingSchema } from './schemas'

const base = {
  persona: 'seafarer',
  profileIntents: JSON.stringify(['find_jobs', 'network']),
  fullName: 'Asha Singh',
  slug: 'asha-singh',
  location: 'Mumbai',
  currentCompany: 'Oceanic Shipping',
  rank: 'Chief Engineer',
  headline: '',
  specialization: '',
  institutionName: '',
  familyRelationship: '',
  contactVisibility: 'members',
}

describe('persona onboarding activation schema', () => {
  it('keeps activation lightweight and stores persona plus user intent', () => {
    const result = onboardingActivationSchema.parse(base)

    expect(result.persona).toBe('seafarer')
    expect(result.profileIntents).toEqual(['find_jobs', 'network'])
    expect(result.rank).toBe('Chief Engineer')
    expect(result.currentCompany).toBe('Oceanic Shipping')
    expect(result.headline).toBe('Chief Engineer')
    expect(result).not.toHaveProperty('identityRoot')
    expect(result).not.toHaveProperty('primaryIdentity')
    expect(result).not.toHaveProperty('summary')
  })

  it('requires a current or recent rank for a seafarer', () => {
    const result = onboardingActivationSchema.safeParse({ ...base, rank: '' })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.flatten().fieldErrors.rank?.[0]).toMatch(/current or most recent rank/i)
  })

  it('supports a recruiter without forcing seafarer-only details', () => {
    const result = onboardingActivationSchema.parse({
      ...base,
      persona: 'recruiter_hr',
      profileIntents: JSON.stringify(['hire', 'network']),
      rank: 'Master',
      headline: 'Crewing Manager',
    })

    expect(result.persona).toBe('recruiter_hr')
    expect(result.rank).toBeUndefined()
    expect(result.headline).toBe('Crewing Manager')
    expect(result.profileIntents).toEqual(['hire', 'network'])
  })

  it('keeps seafarer family onboarding free from irrelevant professional fields', () => {
    const result = onboardingActivationSchema.parse({
      ...base,
      persona: 'seafarer_family',
      profileIntents: JSON.stringify(['community', 'attend_events']),
      currentCompany: 'Should be removed',
      rank: 'Should be removed',
      headline: '',
      familyRelationship: 'Spouse / partner',
    })

    expect(result.persona).toBe('seafarer_family')
    expect(result.currentCompany).toBeUndefined()
    expect(result.rank).toBeUndefined()
    expect(result.specialization).toBeUndefined()
    expect(result.institutionName).toBeUndefined()
    expect(result.familyRelationship).toBe('Spouse / partner')
    expect(result.headline).toBe('Seafarer Family')
  })

  it('keeps student and trainer details limited to their relevant context', () => {
    const student = onboardingActivationSchema.parse({
      ...base,
      persona: 'student_cadet',
      currentCompany: '',
      rank: '',
      institutionName: 'Tolani Maritime Institute',
      headline: '',
    })
    expect(student.institutionName).toBe('Tolani Maritime Institute')
    expect(student.headline).toBe('Student / Cadet')

    const trainer = onboardingActivationSchema.parse({
      ...base,
      persona: 'trainer_instructor',
      rank: '',
      specialization: 'SIRE 2.0 and human factors',
      headline: '',
    })
    expect(trainer.specialization).toBe('SIRE 2.0 and human factors')
    expect(trainer.headline).toBe('SIRE 2.0 and human factors')
  })

  it('rejects unknown personas and intents with corrective messages', () => {
    const result = onboardingActivationSchema.safeParse({
      ...base,
      persona: 'organisation',
      profileIntents: JSON.stringify(['be_everything']),
    })

    expect(result.success).toBe(false)
  })

  it('returns corrective human-readable messages for invalid fields relevant to the selected persona', () => {
    const seafarer = onboardingActivationSchema.safeParse({
      ...base,
      fullName: 'x'.repeat(161),
      location: 'x'.repeat(121),
      currentCompany: 'x'.repeat(161),
      headline: 'x'.repeat(161),
      contactVisibility: 'invalid',
    })

    expect(seafarer.success).toBe(false)
    if (!seafarer.success) {
      const errors = seafarer.error.flatten().fieldErrors
      expect(errors.fullName?.[0]).toMatch(/160 characters or fewer/i)
      expect(errors.location?.[0]).toMatch(/120 characters or fewer/i)
      expect(errors.currentCompany?.[0]).toMatch(/160 characters or fewer/i)
      expect(errors.headline?.[0]).toMatch(/160 characters or fewer/i)
      expect(errors.contactVisibility?.[0]).toMatch(/choose who can see your contact details/i)
    }

    const trainer = onboardingActivationSchema.safeParse({
      ...base,
      persona: 'trainer_instructor',
      rank: '',
      specialization: 'x'.repeat(501),
    })
    expect(trainer.success).toBe(false)
    if (!trainer.success) {
      expect(trainer.error.flatten().fieldErrors.specialization?.[0]).toMatch(/500 characters or fewer/i)
    }

    const student = onboardingActivationSchema.safeParse({
      ...base,
      persona: 'student_cadet',
      rank: '',
      currentCompany: '',
      institutionName: 'x'.repeat(161),
    })
    expect(student.success).toBe(false)
    if (!student.success) {
      expect(student.error.flatten().fieldErrors.institutionName?.[0]).toMatch(/160 characters or fewer/i)
    }

    const family = onboardingActivationSchema.safeParse({
      ...base,
      persona: 'seafarer_family',
      rank: '',
      currentCompany: '',
      familyRelationship: 'x'.repeat(81),
    })
    expect(family.success).toBe(false)
    if (!family.success) {
      expect(family.error.flatten().fieldErrors.familyRelationship?.[0]).toMatch(/80 characters or fewer/i)
    }
  })

  it('keeps legacy profile-edit onboarding validation human-readable', () => {
    const result = onboardingSchema.safeParse({
      profileType: 'seafarer',
      fullName: 'x'.repeat(121),
      slug: 'captain-example',
      location: 'Mumbai',
      headline: 'x'.repeat(161),
      summary: 'short',
      contactVisibility: 'invalid',
      skills: '',
      rank: 'Master',
      currentCompany: 'Example Shipping',
      currentVessel: 'MV Example',
      sailingExperienceYears: '100',
      vesselTypes: '',
      tradingAreas: '',
      shoreCareerPreference: 'false',
      availability: '',
    })

    expect(result.success).toBe(false)
    if (result.success) return

    const errors = result.error.flatten().fieldErrors
    expect(errors.fullName?.[0]).toMatch(/120 characters or fewer/i)
    expect(errors.headline?.[0]).toMatch(/160 characters or fewer/i)
    expect(errors.summary?.[0]).toMatch(/at least 20 characters/i)
    expect(errors.contactVisibility?.[0]).toMatch(/choose who can see your contact details/i)
    expect(errors.sailingExperienceYears?.[0]).toMatch(/between 0 and 70 years/i)
  })
})
