import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { NetworkProfile } from '@/features/network/types'
import { FeedDiscoveryRail } from './feed-discovery-rail'

const suggestions: NetworkProfile[] = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'master-b',
    profileType: 'seafarer',
    identityRoot: 'professional',
    primaryIdentity: 'Master',
    primaryIdentityFamily: 'deck',
    secondaryIdentities: [],
    fullName: 'Master B',
    avatarPath: null,
    location: 'Goa, India',
    headline: 'Master Mariner',
    summary: 'Tanker master with international sailing experience.',
    rank: 'Master',
    currentCompany: 'Oceanic Lines',
    currentVessel: null,
    sailingExperienceYears: 16,
    vesselTypes: ['Oil Tanker'],
    tradingAreas: [],
    shoreCareerPreference: false,
    availability: null,
    skills: [],
    relationship: {
      following: false,
      connection: { kind: 'none', connectionId: null },
    },
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'bluewater-shipping',
    profileType: 'company',
    identityRoot: 'organisation',
    primaryIdentity: 'Shipowner',
    primaryIdentityFamily: 'organisation',
    secondaryIdentities: [],
    fullName: 'Bluewater Shipping',
    avatarPath: null,
    location: 'Singapore',
    headline: 'Shipowner and vessel operator',
    summary: null,
    rank: null,
    currentCompany: null,
    currentVessel: null,
    sailingExperienceYears: null,
    vesselTypes: [],
    tradingAreas: [],
    shoreCareerPreference: false,
    availability: null,
    skills: [],
    relationship: {
      following: false,
      connection: { kind: 'none', connectionId: null },
    },
  },
]

describe('FeedDiscoveryRail', () => {
  it('shows only compact people suggestions on the home right rail', () => {
    render(<FeedDiscoveryRail suggestions={suggestions} />)

    expect(screen.getByRole('heading', { name: 'People you may know' })).toBeInTheDocument()
    expect(screen.getByText('Master B')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View profile/i })).toHaveAttribute('href', '/people/master-b')
    expect(screen.queryByRole('heading', { name: 'Jobs for you' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Organisations to follow' })).not.toBeInTheDocument()
    expect(screen.queryByText('Bluewater Shipping')).not.toBeInTheDocument()
  })
})
