import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FeedProfileCard } from './feed-profile-card'
import type { OwnProfile } from '@/features/profiles/types'

const completeProfile: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer',
  fullName: 'Member A',
  avatarPath: null,
  avatarUrl: 'https://cdn.example.com/member-a-avatar.jpg',
  coverPath: null,
  coverUrl: 'https://cdn.example.com/member-a-cover.jpg',
  location: 'Mumbai, India',
  headline: 'Chief Officer | Tankers',
  summary: 'Experienced tanker officer focused on safe operations and professional development.',
  rank: 'Chief Officer',
  currentCompany: 'Example Shipping',
  currentVessel: 'MT Example',
  sailingExperienceYears: 12,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: true,
  availability: 'Available now',
  skills: ['SIRE 2.0'],
  contactVisibility: 'members',
  onboardingCompletedAt: '2026-09-02T10:00:00.000Z',
}

const incompleteProfile: OwnProfile = {
  ...completeProfile,
  summary: null,
  skills: [],
}

afterEach(() => cleanup())

describe('FeedProfileCard', () => {
  it('shows View profile only when profile completion is 100%', () => {
    render(<FeedProfileCard profile={completeProfile} />)
    expect(screen.getByRole('link', { name: /View profile/i })).toHaveAttribute('href', '/profile')
    expect(screen.queryByRole('link', { name: /Complete profile/i })).not.toBeInTheDocument()
  })

  it('replaces View profile with Complete profile when details are missing', () => {
    render(<FeedProfileCard profile={incompleteProfile} />)
    expect(screen.getByRole('link', { name: /Complete profile/i })).toHaveAttribute('href', '/profile/edit')
    expect(screen.queryByRole('link', { name: /View profile/i })).not.toBeInTheDocument()
  })

  it('renders the uploaded profile photo and banner when media URLs exist', () => {
    render(<FeedProfileCard profile={completeProfile} />)

    expect(screen.getByRole('img', { name: 'Member A cover photo' })).toHaveAttribute('src', completeProfile.coverUrl)
    expect(screen.getByRole('img', { name: 'Member A profile photo' })).toHaveAttribute('src', completeProfile.avatarUrl)
    expect(screen.queryByText('MA')).not.toBeInTheDocument()
  })

  it('falls back to initials when no profile photo exists', () => {
    render(<FeedProfileCard profile={{ ...completeProfile, avatarUrl: null, coverUrl: null }} />)

    expect(screen.getByText('MA')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Member A profile photo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Member A cover photo' })).not.toBeInTheDocument()
  })
})
