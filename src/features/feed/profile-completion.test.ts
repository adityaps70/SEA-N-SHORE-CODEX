import { describe, expect, it } from 'vitest'
import { calculateProfileCompletion } from './profile-completion'
import type { OwnProfile } from '@/features/profiles/types'

function profile(overrides: Partial<OwnProfile> = {}): OwnProfile {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'member-a',
    profileType: 'seafarer',
    fullName: 'Member A',
    avatarPath: null,
    location: 'Mumbai, India',
    headline: 'Chief Officer | Oil Tankers',
    summary: 'Experienced tanker officer focused on safe and efficient operations.',
    rank: 'Chief Officer',
    currentCompany: 'Example Shipping',
    currentVessel: null,
    sailingExperienceYears: 12,
    vesselTypes: ['Oil Tanker'],
    tradingAreas: ['Worldwide'],
    shoreCareerPreference: false,
    availability: 'Available in 30 days',
    skills: ['SIRE 2.0'],
    contactVisibility: 'members',
    onboardingCompletedAt: '2026-09-02T10:00:00.000Z',
    ...overrides,
  }
}

const completePortfolio = { experienceCount: 1, credentialCount: 1 }

describe('calculateProfileCompletion', () => {
  it('returns 100 for a fully populated maritime profile with experience and credentials', () => {
    expect(calculateProfileCompletion(profile(), completePortfolio)).toBe(100)
  })

  it('does not report 100 when the professional portfolio is empty', () => {
    expect(calculateProfileCompletion(profile(), { experienceCount: 0, credentialCount: 0 })).toBe(80)
  })

  it('returns 60 when four of ten maritime completion checks are missing', () => {
    expect(calculateProfileCompletion(profile({
      location: null,
      skills: [],
      currentCompany: null,
      sailingExperienceYears: null,
    }), completePortfolio)).toBe(60)
  })

  it('does not impose seafarer completion requirements on Family or Enthusiast personas', () => {
    expect(calculateProfileCompletion(profile({
      profileType: 'maritime_professional',
      persona: 'seafarer_family',
      rank: null,
      currentCompany: null,
      sailingExperienceYears: null,
    }))).toBe(100)

    expect(calculateProfileCompletion(profile({
      profileType: 'maritime_professional',
      persona: 'maritime_enthusiast',
      rank: null,
      currentCompany: null,
      sailingExperienceYears: null,
    }))).toBe(100)
  })

  it('uses persona-specific profile details instead of legacy maritime type for completion', () => {
    expect(calculateProfileCompletion(profile({
      profileType: 'maritime_professional',
      persona: 'student_cadet',
      institutionName: 'Indian Maritime University',
      rank: null,
      currentCompany: null,
      sailingExperienceYears: null,
    }))).toBe(100)

    expect(calculateProfileCompletion(profile({
      profileType: 'trainer',
      persona: 'trainer_instructor',
      specialization: null,
      rank: null,
      sailingExperienceYears: null,
    }))).toBeLessThan(100)
  })

  it('uses only generic fields for non-maritime profile types', () => {
    expect(calculateProfileCompletion(profile({
      profileType: 'mentor',
      rank: null,
      currentCompany: null,
      sailingExperienceYears: null,
    }))).toBe(100)
  })
})
