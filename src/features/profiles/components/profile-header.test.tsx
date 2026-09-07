import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PublicProfile } from '../types'
import { ProfileHeader } from './profile-header'

const profile: PublicProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer',
  fullName: 'Member A',
  avatarPath: 'profiles/member-a/avatar.webp',
  avatarUrl: 'https://media.example/avatar.webp',
  coverPath: 'profiles/member-a/cover.webp',
  coverUrl: 'https://media.example/cover.webp',
  location: 'Mumbai, India',
  headline: 'Chief Officer | Tankers',
  summary: 'Experienced maritime professional.',
  rank: 'Chief Officer',
  currentCompany: 'Example Shipping',
  currentVessel: 'MT Example',
  sailingExperienceYears: 12,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: true,
  availability: 'Available now',
  skills: ['SIRE 2.0'],
}

afterEach(() => cleanup())

describe('ProfileHeader', () => {
  it('renders identity, profile photo and cover photo', () => {
    render(<ProfileHeader profile={profile} />)
    expect(screen.getByRole('heading', { name: 'Member A' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Member A profile photo' })).toHaveAttribute('src', profile.avatarUrl)
    expect(screen.getByRole('img', { name: 'Member A cover photo' })).toHaveAttribute('src', profile.coverUrl)
    expect(screen.getByText('Chief Officer | Tankers')).toBeInTheDocument()
    expect(screen.getByText('Available now')).toBeInTheDocument()
  })

  it('renders section edit and optional action slots for the owner', () => {
    render(
      <ProfileHeader
        profile={profile}
        editHref="/profile/edit#identity"
        mediaControls={<button type="button">Change profile photo</button>}
        actions={<button type="button">Connect</button>}
      />,
    )
    expect(screen.getByRole('link', { name: 'Edit basic information' })).toHaveAttribute('href', '/profile/edit#identity')
    expect(screen.getByRole('button', { name: 'Change profile photo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })
})
