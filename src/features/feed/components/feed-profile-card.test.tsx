import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FeedProfileCard } from './feed-profile-card'
import type { OwnProfile } from '@/features/profiles/types'

const completeProfile: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer',
  fullName: 'Member A',
  avatarPath: null,
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
})
