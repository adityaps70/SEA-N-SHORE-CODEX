import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NetworkProfile } from '../types'
import { NetworkProfileCard } from './network-profile-card'

vi.mock('./relationship-controls', () => ({
  RelationshipControls: () => <div>Relationship actions</div>,
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
  skills: ['SIRE 2.0', 'Navigation', 'Leadership', 'Vetting'],
  relationship: { following: false, connection: { kind: 'none', connectionId: null } },
}

describe('NetworkProfileCard', () => {
  it('shows real maritime profile context and actions', () => {
    render(<NetworkProfileCard profile={profile} />)
    expect(screen.getByText('Capt. Meera Nair')).toBeInTheDocument()
    expect(screen.getByText('Master Mariner | Tanker Operations')).toBeInTheDocument()
    expect(screen.getByText('Mumbai, India')).toBeInTheDocument()
    expect(screen.getByText(/Master · Ocean Example/)).toBeInTheDocument()
    expect(screen.getByText('SIRE 2.0')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('Relationship actions')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View professional profile/i })).toHaveAttribute('href', '/people/capt-meera-nair')
    expect(screen.queryByText(/Verified|Reputation/i)).not.toBeInTheDocument()
  })
})
