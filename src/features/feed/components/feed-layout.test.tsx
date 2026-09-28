import { cleanup, render, screen } from '@testing-library/react'
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

  it('shows quick actions under the compact profile card on phones and tablets, without an organizations box', () => {
    render(
      <FeedLayout profile={profile} portfolioCompletion={{ experienceCount: 0, credentialCount: 0 }} suggestions={[]}>
        <div>Feed</div>
      </FeedLayout>,
    )

    expect(screen.getByText('Compact quick actions')).toBeInTheDocument()
    expect(screen.queryByText(/Your organizations/)).not.toBeInTheDocument()
  })
})
