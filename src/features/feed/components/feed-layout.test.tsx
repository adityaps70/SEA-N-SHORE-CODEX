import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OwnProfile } from '@/features/profiles/types'
import { FeedLayout } from './feed-layout'

vi.mock('./feed-left-rail', () => ({
  FeedLeftRail: () => <div>Left rail</div>,
  FeedQuickActions: ({ compact }: { compact?: boolean }) => <div>{compact ? 'Compact quick actions' : 'Quick actions'}</div>,
}))
vi.mock('./feed-discovery-rail', () => ({ FeedDiscoveryRail: () => <div>Discovery rail</div> }))
vi.mock('./feed-profile-card', () => ({ FeedProfileCard: () => <div>Profile card</div> }))

const profile: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer',
  fullName: 'Member A',
  avatarPath: null,
  location: null,
  headline: null,
  summary: null,
  rank: null,
  currentCompany: null,
  currentVessel: null,
  sailingExperienceYears: null,
  vesselTypes: [],
  tradingAreas: [],
  shoreCareerPreference: false,
  availability: null,
  skills: [],
  contactVisibility: 'members',
  onboardingCompletedAt: '2026-09-02T10:00:00.000Z',
}

describe('FeedLayout', () => {
  afterEach(() => cleanup())

  it('keeps the desktop left rail sticky and lets it scroll when it is taller than the window, so Quick actions stays reachable', () => {
    const { container } = render(
      <FeedLayout profile={profile} portfolioCompletion={{ experienceCount: 0, credentialCount: 0 }} suggestions={[]}>
        <div>Feed</div>
      </FeedLayout>,
    )

    const leftRailScroller = container.querySelector('aside > div')
    expect(leftRailScroller).toHaveClass('sticky', 'top-24', 'max-h-[calc(100vh-7rem)]', 'overflow-y-auto')
  })

  it('keeps the compact profile card and quick actions on tablets only, without an organizations box', () => {
    render(
      <FeedLayout profile={profile} portfolioCompletion={{ experienceCount: 0, credentialCount: 0 }} suggestions={[]}>
        <div>Feed</div>
      </FeedLayout>,
    )

    expect(screen.getByText('Compact quick actions')).toBeInTheDocument()
    // Phones get the drawer and bottom tabs instead; md–lg keeps the compact card.
    expect(screen.getByTestId('feed-compact-rail')).toHaveClass('max-md:hidden', 'lg:hidden')
    expect(screen.queryByText(/Your organizations/)).not.toBeInTheDocument()
  })

  it('shows one slim "Complete your profile" banner on phones while the profile is incomplete', () => {
    render(
      <FeedLayout profile={profile} portfolioCompletion={{ experienceCount: 0, credentialCount: 0 }} suggestions={[]}>
        <div>Feed</div>
      </FeedLayout>,
    )

    const banner = screen.getByTestId('profile-completion-banner')
    expect(banner).toHaveClass('md:hidden')
    expect(within(banner).getByRole('link', { name: /complete your profile 10%/i })).toHaveAttribute('href', '/profile/edit')
    expect(banner).toHaveTextContent('Add a headline so people know what you do')
  })

  it('shows no banner once the profile is complete', () => {
    const complete: OwnProfile = {
      ...profile,
      headline: 'Chief Officer',
      summary: 'Tanker officer.',
      location: 'Mumbai',
      skills: ['SIRE 2.0'],
      rank: 'Chief Officer',
      currentCompany: 'Example Shipping',
      sailingExperienceYears: 12,
    }
    render(
      <FeedLayout profile={complete} portfolioCompletion={{ experienceCount: 1, credentialCount: 1 }} suggestions={[]}>
        <div>Feed</div>
      </FeedLayout>,
    )

    expect(screen.queryByTestId('profile-completion-banner')).not.toBeInTheDocument()
  })
})
