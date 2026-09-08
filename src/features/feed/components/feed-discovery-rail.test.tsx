import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NetworkProfile } from '@/features/network/types'
import type { OwnProfile } from '@/features/profiles/types'
import { FeedDiscoveryRail } from './feed-discovery-rail'

vi.mock('@/features/network/components/relationship-controls', () => ({
  RelationshipControls: () => <button type="button">Follow</button>,
}))

const viewer: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'chief-officer-a',
  profileType: 'seafarer',
  identityRoot: 'professional',
  primaryIdentity: 'Master',
  primaryIdentityFamily: 'deck',
  secondaryIdentities: ['Mentor'],
  fullName: 'Chief Officer A',
  avatarPath: null,
  location: 'Mumbai, India',
  headline: 'Chief Officer | Tankers',
  summary: null,
  rank: 'Chief Officer',
  currentCompany: 'Viewer Shipping',
  currentVessel: null,
  sailingExperienceYears: 8,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: [],
  shoreCareerPreference: true,
  availability: 'Available in 30 days',
  skills: [],
  contactVisibility: 'members',
  onboardingCompletedAt: '2026-09-02T10:00:00.000Z',
}

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
    summary: null,
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
  it('shows people, profile-based job signals, and organisations without inventing vacancies', () => {
    render(<FeedDiscoveryRail profile={viewer} suggestions={suggestions} />)

    expect(screen.getByRole('heading', { name: 'People you may know' })).toBeInTheDocument()
    expect(screen.getByText('Master B')).toBeInTheDocument()
    expect(screen.queryByText('Bluewater Shipping', { selector: 'h2 + div a' })).not.toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Jobs for you' })).toBeInTheDocument()
    expect(screen.getByText('Chief Officer opportunities')).toBeInTheDocument()
    expect(screen.getByText('Oil Tanker opportunities')).toBeInTheDocument()
    expect(screen.getByText('Shore career pathways')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Explore maritime jobs' })).toHaveAttribute('href', '/jobs')

    expect(screen.getByRole('heading', { name: 'Organisations to follow' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Bluewater Shipping' })).toHaveAttribute('href', '/people/bluewater-shipping')
    expect(screen.getByRole('link', { name: 'Oceanic Lines' })).toHaveAttribute('href', '/network?tab=discover&q=Oceanic%20Lines')
    expect(screen.getAllByRole('button', { name: 'Follow' }).length).toBeGreaterThan(0)

    expect(screen.queryByRole('heading', { name: 'Join the conversation' })).not.toBeInTheDocument()
  })
})
