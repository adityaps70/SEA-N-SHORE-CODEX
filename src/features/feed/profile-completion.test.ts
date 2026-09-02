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

describe('calculateProfileCompletion', () => {
  it('returns 100 for a fully populated maritime profile', () => {
    expect(calculateProfileCompletion(profile())).toBe(100)
  })

  it('returns 50 when four of eight maritime completion fields are missing', () => {
    expect(calculateProfileCompletion(profile({
      location: null,
      skills: [],
      currentCompany: null,
      sailingExperienceYears: null,
    }))).toBe(50)
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
