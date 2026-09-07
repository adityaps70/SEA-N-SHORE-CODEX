import { describe, expect, it } from 'vitest'
import { matchesNetworkSearch, relationshipFromRows } from './queries'
import type { NetworkConnectionRow, NetworkProfile } from './types'

const viewerId = '11111111-1111-4111-8111-111111111111'
const targetId = '22222222-2222-4222-8222-222222222222'

function connection(overrides: Partial<NetworkConnectionRow> = {}): NetworkConnectionRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    user_low_id: viewerId,
    user_high_id: targetId,
    requested_by: viewerId,
    status: 'pending',
    created_at: '2026-09-02T10:00:00.000Z',
    updated_at: '2026-09-02T10:00:00.000Z',
    ...overrides,
  }
}

function profile(overrides: Partial<NetworkProfile> = {}): NetworkProfile {
  return {
    id: targetId,
    slug: 'captain-anita-singh',
    profileType: 'seafarer',
    fullName: 'Capt. Anita Singh',
    avatarPath: null,
    location: 'Mumbai, India',
    headline: 'Master Mariner | Oil Tankers',
    summary: 'Experienced tanker professional and mentor.',
    rank: 'Master',
    currentCompany: 'Oceanic Shipping',
    currentVessel: null,
    sailingExperienceYears: 18,
    vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
    tradingAreas: ['Worldwide'],
    shoreCareerPreference: false,
    availability: 'Available for mentoring',
    skills: ['SIRE 2.0', 'Navigation'],
    relationship: { following: false, connection: { kind: 'none', connectionId: null } },
    ...overrides,
  }
}

describe('relationshipFromRows', () => {
  it('returns no connection for unrelated profiles', () => {
    expect(relationshipFromRows(viewerId, targetId, new Set(), [])).toEqual({
      following: false,
      connection: { kind: 'none', connectionId: null },
    })
  })

  it('keeps follow state independent from connection state', () => {
    expect(relationshipFromRows(viewerId, targetId, new Set([targetId]), [])).toEqual({
      following: true,
      connection: { kind: 'none', connectionId: null },
    })
  })

  it('identifies an outgoing pending request', () => {
    expect(relationshipFromRows(viewerId, targetId, new Set(), [connection()])).toEqual({
      following: false,
      connection: { kind: 'outgoing_pending', connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })
  })

  it('identifies an incoming pending request', () => {
    expect(relationshipFromRows(viewerId, targetId, new Set(), [connection({ requested_by: targetId })])).toEqual({
      following: false,
      connection: { kind: 'incoming_pending', connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })
  })

  it('identifies an accepted connection without forcing follow state', () => {
    expect(relationshipFromRows(viewerId, targetId, new Set(), [connection({ status: 'accepted' })])).toEqual({
      following: false,
      connection: { kind: 'connected', connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })
  })
})

describe('matchesNetworkSearch', () => {
  it('matches case-insensitively across maritime profile fields', () => {
    expect(matchesNetworkSearch(profile(), 'anita')).toBe(true)
    expect(matchesNetworkSearch(profile(), 'oil tanker')).toBe(true)
    expect(matchesNetworkSearch(profile(), 'sire')).toBe(true)
    expect(matchesNetworkSearch(profile(), 'mumbai')).toBe(true)
    expect(matchesNetworkSearch(profile(), 'oceanic')).toBe(true)
  })

  it('trims search input and treats an empty query as a match', () => {
    expect(matchesNetworkSearch(profile(), '  master  ')).toBe(true)
    expect(matchesNetworkSearch(profile(), '   ')).toBe(true)
  })

  it('rejects profiles that do not contain every search token', () => {
    expect(matchesNetworkSearch(profile(), 'master tanker')).toBe(true)
    expect(matchesNetworkSearch(profile(), 'master lng')).toBe(false)
  })
})
