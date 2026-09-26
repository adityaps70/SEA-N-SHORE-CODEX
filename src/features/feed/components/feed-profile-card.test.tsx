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

const completePortfolio = { experienceCount: 1, credentialCount: 1 }

afterEach(() => cleanup())

describe('FeedProfileCard', () => {
  it('shows View profile only when profile fields and portfolio evidence are complete', () => {
    render(<FeedProfileCard profile={completeProfile} portfolioCompletion={completePortfolio} />)
    expect(screen.getByRole('link', { name: /View profile/i })).toHaveAttribute('href', '/profile')
    expect(screen.getByRole('progressbar', { name: /Profile completeness/i })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.queryByRole('link', { name: /Complete profile/i })).not.toBeInTheDocument()
  })

  it('does not claim 100 percent when experience and credentials are missing', () => {
    render(<FeedProfileCard profile={completeProfile} portfolioCompletion={{ experienceCount: 0, credentialCount: 0 }} />)
    expect(screen.getByRole('progressbar', { name: /Profile completeness/i })).toHaveAttribute('aria-valuenow', '80')
    expect(screen.getByRole('link', { name: /Complete profile/i })).toHaveAttribute('href', '/profile/edit')
  })

  it('replaces View profile with Complete profile when details are missing', () => {
    render(<FeedProfileCard profile={incompleteProfile} portfolioCompletion={completePortfolio} />)
    expect(screen.getByRole('link', { name: /Complete profile/i })).toHaveAttribute('href', '/profile/edit')
    expect(screen.queryByRole('link', { name: /View profile/i })).not.toBeInTheDocument()
  })

  it('renders the uploaded profile photo and banner when media URLs exist', () => {
    render(<FeedProfileCard profile={completeProfile} portfolioCompletion={completePortfolio} />)

    expect(screen.getByRole('img', { name: 'Member A cover photo' })).toHaveAttribute('src', completeProfile.coverUrl)
    expect(screen.getByRole('img', { name: 'Member A profile photo' })).toHaveAttribute('src', completeProfile.avatarUrl)
    expect(screen.queryByText('MA')).not.toBeInTheDocument()
  })

  it('increases the desktop profile photo by about 15 percent and preserves the cover overlap', () => {
    render(<FeedProfileCard profile={completeProfile} portfolioCompletion={completePortfolio} />)

    const profilePhoto = screen.getByRole('img', { name: 'Member A profile photo' })
    expect(profilePhoto.parentElement).toHaveClass('size-[74px]', '-mt-[37px]')
  })

  it('shows persona identity and hides seafarer-only details for a family member', () => {
    render(
      <FeedProfileCard
        profile={{
          ...completeProfile,
          profileType: 'maritime_professional',
          persona: 'seafarer_family',
          headline: null,
          rank: null,
          currentCompany: null,
          currentVessel: 'Should not render',
          sailingExperienceYears: 12,
          shoreCareerPreference: true,
          availability: 'Available now',
          communityRelationship: 'Spouse',
        }}
        portfolioCompletion={completePortfolio}
      />,
    )

    expect(screen.getByText('Seafarer Family')).toBeInTheDocument()
    expect(screen.getByText('Spouse')).toBeInTheDocument()
    expect(screen.queryByText('Sea service')).not.toBeInTheDocument()
    expect(screen.queryByText('Vessel')).not.toBeInTheDocument()
    expect(screen.queryByText('Open to shore')).not.toBeInTheDocument()
  })

  it('falls back to initials when no profile photo exists', () => {
    render(<FeedProfileCard profile={{ ...completeProfile, avatarUrl: null, coverUrl: null }} portfolioCompletion={completePortfolio} />)

    expect(screen.getByText('MA')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Member A profile photo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Member A cover photo' })).not.toBeInTheDocument()
  })
})
