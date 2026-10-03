import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NetworkProfile } from '../types'
import { NetworkPersonListRow } from './network-person-list-row'

vi.mock('./relationship-controls', () => ({
  RelationshipControls: () => <div>Connection actions</div>,
}))

vi.mock('./follow-toggle-button', () => ({
  FollowToggleButton: ({ following, followerView }: { following: boolean; followerView?: boolean }) => (
    <button type="button">{following ? 'Following' : followerView ? 'Follow back' : 'Follow'}</button>
  ),
}))

const profile: NetworkProfile = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'capt-meera-nair',
  profileType: 'seafarer',
  fullName: 'Capt. Meera Nair',
  avatarPath: null,
  location: 'Mumbai, India',
  headline: 'Master Mariner | Tanker Operations',
  summary: 'Maritime professional focused on safe tanker operations.',
  rank: 'Master',
  currentCompany: 'Ocean Example',
  currentVessel: null,
  sailingExperienceYears: 18,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: false,
  availability: 'Available for mentorship',
  skills: ['SIRE 2.0'],
  relationship: { following: true, connection: { kind: 'connected', connectionId: '33333333-3333-4333-8333-333333333333' } },
  relationshipSince: '2026-09-09T10:00:00.000Z',
}

afterEach(() => cleanup())

describe('NetworkPersonListRow', () => {
  it('renders connections as LinkedIn-style rows with connection date and actions', () => {
    render(<NetworkPersonListRow profile={profile} kind="connection" />)

    expect(screen.getByRole('link', { name: 'Capt. Meera Nair' })).toHaveAttribute('href', '/people/capt-meera-nair')
    expect(screen.getByText('Master Mariner | Tanker Operations')).toBeInTheDocument()
    expect(screen.getByText(/Connected on/)).toBeInTheDocument()
    expect(screen.getByText('Connection actions')).toBeInTheDocument()
  })

  it('renders following and follower rows with the relevant follow CTA', () => {
    const { rerender } = render(<NetworkPersonListRow profile={profile} kind="following" />)
    expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument()

    rerender(
      <NetworkPersonListRow
        profile={{ ...profile, relationship: { ...profile.relationship, following: false } }}
        kind="follower"
      />,
    )
    expect(screen.getByRole('button', { name: 'Follow back' })).toBeInTheDocument()
  })
})
