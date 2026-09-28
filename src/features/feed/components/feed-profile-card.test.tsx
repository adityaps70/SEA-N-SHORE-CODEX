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
  it('hides the completeness bar once profile fields and portfolio evidence are complete', () => {
    render(<FeedProfileCard profile={completeProfile} portfolioCompletion={completePortfolio} />)
    expect(screen.getByRole('link', { name: 'Member A' })).toHaveAttribute('href', '/profile')
    expect(screen.queryByRole('progressbar', { name: /Profile completeness/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Complete profile/i })).not.toBeInTheDocument()
  })

  it('does not claim 100 percent when experience and credentials are missing', () => {
    render(<FeedProfileCard profile={completeProfile} portfolioCompletion={{ experienceCount: 0, credentialCount: 0 }} />)
    expect(screen.getByRole('progressbar', { name: /Profile completeness/i })).toHaveAttribute('aria-valuenow', '80')
    expect(screen.getByRole('link', { name: /Complete profile/i })).toHaveAttribute('href', '/profile/edit')
  })

  it('shows Complete profile when details are missing', () => {
    render(<FeedProfileCard profile={incompleteProfile} portfolioCompletion={completePortfolio} />)
    expect(screen.getByRole('link', { name: /Complete profile/i })).toHaveAttribute('href', '/profile/edit')
    expect(screen.getByRole('progressbar', { name: /Profile completeness/i })).toBeInTheDocument()
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
    expect(profilePhoto.parentElement).toHaveAttribute('href', '/profile')
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

  it('shows a default headline once instead of repeating it as persona and descriptor', () => {
    render(
      <FeedProfileCard
        profile={{
          ...completeProfile,
          profileType: 'maritime_professional',
          persona: 'maritime_enthusiast',
          headline: 'Maritime Enthusiast',
          rank: null,
          currentCompany: null,
          currentVessel: null,
          sailingExperienceYears: null,
        }}
        portfolioCompletion={completePortfolio}
      />,
    )

    expect(screen.getAllByText(/maritime enthusiast/i)).toHaveLength(1)
  })

  it('does not repeat a seafarer rank that is also the headline, case-insensitively', () => {
    render(
      <FeedProfileCard
        profile={{ ...completeProfile, persona: 'seafarer', headline: 'chief officer', rank: 'Chief Officer' }}
        portfolioCompletion={completePortfolio}
      />,
    )

    expect(screen.getAllByText(/chief officer/i)).toHaveLength(1)
    expect(screen.getByText('Seafarer')).toBeInTheDocument()
  })

  it('drops a persona label or rank already visible inside the headline', () => {
    render(
      <FeedProfileCard
        profile={{ ...completeProfile, persona: 'seafarer', headline: 'Chief Officer · Seafarer on LNG carriers', rank: 'Chief Officer' }}
        portfolioCompletion={completePortfolio}
      />,
    )

    expect(screen.getAllByText(/chief officer/i)).toHaveLength(1)
    expect(screen.queryByText('Seafarer')).not.toBeInTheDocument()
  })

  it('shows the linked organization logo and name as a link to its page', () => {
    render(
      <FeedProfileCard
        profile={{
          ...completeProfile,
          currentCompany: 'Oceanic Ship Management',
          currentCompanyId: '22222222-2222-4222-8222-222222222222',
          currentOrganization: {
            id: '22222222-2222-4222-8222-222222222222',
            slug: 'oceanic-ship-management',
            name: 'Oceanic Ship Management',
            logoUrl: '/api/company-logo/22222222-2222-4222-8222-222222222222',
            verified: true,
          },
        }}
        portfolioCompletion={completePortfolio}
      />,
    )

    const organization = screen.getByTestId('profile-card-organization')
    expect(organization.tagName).toBe('A')
    expect(organization).toHaveAttribute('href', '/organizations/oceanic-ship-management')
    expect(organization).toHaveTextContent('Oceanic Ship Management')
    expect(organization.querySelector('img')).toHaveAttribute('src', '/api/company-logo/22222222-2222-4222-8222-222222222222')
    expect(screen.getAllByText('Oceanic Ship Management')).toHaveLength(1)
  })

  it('shows an unlinked organization as plain text with the building tile', () => {
    render(<FeedProfileCard profile={completeProfile} portfolioCompletion={completePortfolio} />)

    const organization = screen.getByTestId('profile-card-organization')
    expect(organization.tagName).toBe('P')
    expect(organization).toHaveTextContent('Example Shipping')
    expect(organization.querySelector('img')).toBeNull()
  })

  it('shows location and the verified badge only for verified members', () => {
    const { rerender } = render(<FeedProfileCard profile={completeProfile} portfolioCompletion={completePortfolio} />)
    expect(screen.getByText('Mumbai, India')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Verified member' })).not.toBeInTheDocument()

    rerender(<FeedProfileCard profile={completeProfile} portfolioCompletion={completePortfolio} verified />)
    expect(screen.getByRole('img', { name: 'Verified member' })).toBeInTheDocument()
  })

  it('keeps seafarer facts compact and no longer shows availability', () => {
    render(<FeedProfileCard profile={{ ...completeProfile, availability: 'onboard' }} portfolioCompletion={completePortfolio} />)

    expect(screen.getByText('Sea service')).toBeInTheDocument()
    expect(screen.queryByText('Availability')).not.toBeInTheDocument()
    expect(screen.queryByText('Onboard')).not.toBeInTheDocument()
    expect(screen.getByText('MT Example')).toBeInTheDocument()
  })

  it('compact phone card de-duplicates the summary and only offers Complete profile while incomplete', () => {
    const { rerender } = render(
      <FeedProfileCard
        profile={{ ...completeProfile, persona: 'maritime_enthusiast', headline: 'Maritime Enthusiast', currentCompany: null }}
        portfolioCompletion={completePortfolio}
        compact
      />,
    )
    expect(screen.getAllByText(/maritime enthusiast/i)).toHaveLength(1)

    rerender(<FeedProfileCard profile={completeProfile} portfolioCompletion={completePortfolio} compact verified />)
    expect(screen.queryByRole('link', { name: /Complete profile/i })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Verified member' })).toBeInTheDocument()
    expect(screen.getByTestId('profile-card-organization')).toHaveTextContent('Example Shipping')

    rerender(<FeedProfileCard profile={incompleteProfile} portfolioCompletion={completePortfolio} compact />)
    expect(screen.getByRole('link', { name: /Complete profile/i })).toHaveAttribute('href', '/profile/edit')
  })
})
