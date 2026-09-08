import { describe, expect, it } from 'vitest'
import { getProfileReadiness } from './profile-readiness'
import type { PublicProfile } from './types'

function buildProfile(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'captain-a',
    profileType: 'seafarer',
    identityRoot: 'professional',
    primaryIdentity: 'Master Mariner',
    primaryIdentityFamily: 'Sea-going professional',
    secondaryIdentities: ['Tanker professional'],
    fullName: 'Captain A',
    avatarPath: 'profiles/a/avatar.webp',
    avatarUrl: 'https://example.test/avatar.webp',
    coverPath: 'profiles/a/cover.webp',
    coverUrl: 'https://example.test/cover.webp',
    location: 'Mumbai, India',
    headline: 'Master Mariner | Oil & Chemical Tankers',
    summary: 'Master Mariner with international tanker command and safety leadership experience.',
    rank: 'Master',
    currentCompany: 'Example Shipping',
    currentVessel: 'MT Example',
    sailingExperienceYears: 18,
    vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
    tradingAreas: ['Worldwide'],
    shoreCareerPreference: true,
    availability: 'ASHORE',
    skills: ['SIRE 2.0', 'Leadership'],
    ...overrides,
  }
}

describe('getProfileReadiness', () => {
  it('scores only real stored profile fields and returns no missing guidance for a complete core passport', () => {
    const result = getProfileReadiness(buildProfile())

    expect(result.score).toBe(100)
    expect(result.completed).toBe(result.total)
    expect(result.nextSteps).toEqual([])
  })

  it('guides a sparse seafarer toward recruiter-useful missing fields', () => {
    const result = getProfileReadiness(buildProfile({
      avatarPath: null,
      coverPath: null,
      summary: null,
      rank: null,
      sailingExperienceYears: null,
      vesselTypes: [],
      tradingAreas: [],
      skills: [],
    }))

    expect(result.score).toBeLessThan(100)
    expect(result.nextSteps).toContain('Add a professional photo')
    expect(result.nextSteps).toContain('Add your rank and sea-service experience')
    expect(result.nextSteps).toContain('Add vessel types and trading areas')
    expect(result.nextSteps).toContain('Add professional skills')
  })
})
