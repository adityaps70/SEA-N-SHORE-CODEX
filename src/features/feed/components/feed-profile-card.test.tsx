import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FeedProfileCard } from './feed-profile-card'
import type { OwnProfile } from '@/features/profiles/types'

const profile: OwnProfile = {
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

describe('FeedProfileCard', () => {
  it('renders only real profile information', () => {
    render(<FeedProfileCard profile={profile} />)
    expect(screen.getByText('Member A')).toBeInTheDocument()
    expect(screen.getByText('Chief Officer | Tankers')).toBeInTheDocument()
    expect(screen.getByText(/Chief Officer/)).toBeInTheDocument()
    expect(screen.getByText(/Example Shipping/)).toBeInTheDocument()
    expect(screen.getByText('12 years')).toBeInTheDocument()
    expect(screen.getByText('Available now')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View profile/i })).toBeInTheDocument()
    expect(screen.queryByText(/Verified/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Reputation/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/connections/i)).not.toBeInTheDocument()
  })
})
