import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfileDirectoryCard } from '@/features/profiles/components/profile-directory-card'
import type { NetworkProfile } from '../types'
import { ConnectionRequestCard } from './connection-request-card'
import { NetworkProfileCard } from './network-profile-card'
import { PeopleYouMayKnow } from './people-you-may-know'

vi.mock('./relationship-controls', () => ({
  RelationshipControls: () => <div>Relationship actions</div>,
}))

afterEach(cleanup)

const signedAvatarUrl = 'https://media.example.test/signed/capt-meera-nair.jpg?signature=abc123'

const profile: NetworkProfile = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'capt-meera-nair',
  profileType: 'seafarer',
  fullName: 'Capt. Meera Nair',
  avatarPath: 'profiles/22222222-2222-4222-8222-222222222222/avatar.jpg',
  avatarUrl: signedAvatarUrl,
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
  relationship: { following: false, connection: { kind: 'none', connectionId: null } },
}

describe('profile photo surfaces', () => {
  it('uses the hydrated signed avatar URL on network profile cards', () => {
    render(<NetworkProfileCard profile={profile} />)

    expect(screen.getByRole('img', { name: /Capt\. Meera Nair profile/i })).toHaveAttribute('src', signedAvatarUrl)
  })

  it('uses the hydrated signed avatar URL on connection request cards', () => {
    render(<ConnectionRequestCard profile={profile} direction="incoming" />)

    expect(screen.getByRole('img', { name: /Capt\. Meera Nair profile/i })).toHaveAttribute('src', signedAvatarUrl)
  })

  it('uses avatarUrl rather than the raw storage key in People You May Know', () => {
    render(<PeopleYouMayKnow profiles={[profile]} />)

    expect(screen.getByRole('img', { name: /Capt\. Meera Nair profile/i })).toHaveAttribute('src', signedAvatarUrl)
    expect(screen.getByRole('img', { name: /Capt\. Meera Nair profile/i })).not.toHaveAttribute('src', profile.avatarPath)
  })

  it('uses the hydrated signed avatar URL on profile directory cards', () => {
    render(<ProfileDirectoryCard profile={profile} />)

    expect(screen.getByRole('img', { name: /Capt\. Meera Nair profile/i })).toHaveAttribute('src', signedAvatarUrl)
  })
})
