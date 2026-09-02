import { describe, expect, it } from 'vitest'
import type { PublicProfile } from '@/features/profiles/types'
import { RECOMMENDATION_WEIGHTS, scoreRecommendation } from './recommendations'

function profile(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'captain-one',
    profileType: 'seafarer',
    fullName: 'Captain One',
    avatarPath: null,
    location: 'Mumbai, India',
    headline: 'Master Mariner',
    summary: 'Experienced maritime professional.',
    rank: 'Master',
    currentCompany: 'Example Shipping',
    currentVessel: null,
    sailingExperienceYears: 16,
    vesselTypes: ['Oil Tanker'],
    tradingAreas: ['Worldwide'],
    shoreCareerPreference: false,
    availability: null,
    skills: ['SIRE 2.0', 'Navigation'],
    ...overrides,
  }
}

describe('scoreRecommendation', () => {
  it('uses the approved weights', () => {
    expect(RECOMMENDATION_WEIGHTS).toEqual({
      sharedVesselType: 6,
      sharedSkill: 5,
      sharedTradingArea: 4,
      rankMatch: 3,
      sameProfileType: 2,
      sameLocation: 1,
    })
  })

  it('ranks vessel and skill overlap above location-only overlap', () => {
    const viewer = profile()
    const strong = profile({
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'captain-two',
      location: 'Singapore',
      rank: 'Chief Officer',
      vesselTypes: ['oil tanker'],
      skills: ['sire 2.0'],
      tradingAreas: [],
    })
    const locationOnly = profile({
      id: '33333333-3333-4333-8333-333333333333',
      slug: 'engineer-three',
      profileType: 'maritime_professional',
      rank: 'Chief Engineer',
      vesselTypes: ['Container'],
      skills: ['PMS'],
      tradingAreas: ['Coastal India'],
    })

    expect(scoreRecommendation(viewer, strong)).toBeGreaterThan(scoreRecommendation(viewer, locationOnly))
  })

  it('normalizes exact comparisons case-insensitively without fuzzy matching', () => {
    const viewer = profile({ vesselTypes: ['VLCC'], skills: ['Vetting'], tradingAreas: ['Middle East'] })
    const exactCaseVariant = profile({
      id: '44444444-4444-4444-8444-444444444444',
      slug: 'case-variant',
      vesselTypes: ['vlcc'],
      skills: ['VETTING'],
      tradingAreas: ['middle east'],
    })
    const fuzzy = profile({
      id: '55555555-5555-4555-8555-555555555555',
      slug: 'fuzzy',
      vesselTypes: ['VLCC Tanker'],
      skills: ['Vetting Inspector'],
      tradingAreas: ['Middle-East'],
    })

    expect(scoreRecommendation(viewer, exactCaseVariant)).toBeGreaterThan(scoreRecommendation(viewer, fuzzy))
  })
})
