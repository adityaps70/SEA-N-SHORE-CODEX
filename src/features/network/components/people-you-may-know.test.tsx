import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NetworkProfile } from '../types'
import { PeopleYouMayKnow } from './people-you-may-know'

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
  headline: 'Master Mariner | Tankers',
  summary: 'Maritime professional.',
  rank: 'Master',
  currentCompany: 'Example Shipping',
  currentVessel: null,
  sailingExperienceYears: 18,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: false,
  availability: null,
  skills: ['SIRE 2.0'],
  relationship: { following: false, connection: { kind: 'none', connectionId: null } },
}

describe('PeopleYouMayKnow', () => {
  it('renders compact professional suggestions with profile and relationship actions', () => {
    render(<PeopleYouMayKnow profiles={[profile]} />)
    expect(screen.getByRole('heading', { name: /People you may know/i })).toBeInTheDocument()
    expect(screen.getByText('Capt. Meera Nair')).toBeInTheDocument()
    expect(screen.getByText('Master Mariner | Tankers')).toBeInTheDocument()
    expect(screen.getByText('Relationship actions')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Capt. Meera Nair|View profile/i }).length).toBeGreaterThan(0)
  })
})
