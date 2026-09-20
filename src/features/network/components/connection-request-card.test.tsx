import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NetworkProfile } from '../types'
import { ConnectionRequestCard } from './connection-request-card'

vi.mock('./relationship-controls', () => ({
  RelationshipControls: ({ menuIconOnly }: { menuIconOnly?: boolean }) => (
    <div>{menuIconOnly ? 'Compact request actions' : 'Request actions'}</div>
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
  summary: 'Experienced tanker professional.',
  rank: 'Master',
  currentCompany: 'Ocean Example',
  currentVessel: null,
  sailingExperienceYears: 18,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: false,
  availability: null,
  skills: [],
  relationship: { following: false, connection: { kind: 'incoming_pending', connectionId: '33333333-3333-4333-8333-333333333333' } },
}

afterEach(() => cleanup())

describe('ConnectionRequestCard', () => {
  it('renders an incoming invitation as a compact list row', () => {
    render(<ConnectionRequestCard profile={profile} direction="incoming" />)

    expect(screen.getByRole('link', { name: 'Capt. Meera Nair' })).toHaveAttribute('href', '/people/capt-meera-nair')
    expect(screen.getByText('Wants to connect')).toBeInTheDocument()
    expect(screen.getByText('Compact request actions')).toBeInTheDocument()
  })

  it('renders sent invitations with a request-sent state', () => {
    render(
      <ConnectionRequestCard
        profile={{ ...profile, relationship: { ...profile.relationship, connection: { kind: 'outgoing_pending', connectionId: '33333333-3333-4333-8333-333333333333' } } }}
        direction="sent"
      />,
    )

    expect(screen.getByText('Request sent')).toBeInTheDocument()
  })
})
