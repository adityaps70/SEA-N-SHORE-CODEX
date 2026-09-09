import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OwnProfile } from '@/features/profiles/types'
import { FeedLayout } from './feed-layout'

vi.mock('./feed-left-rail', () => ({ FeedLeftRail: () => <div>Left rail</div> }))
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
  it('keeps the desktop left rail sticky below the fixed header without its own scrolling region', () => {
    const { container } = render(
      <FeedLayout profile={profile} suggestions={[]}>
        <div>Feed</div>
      </FeedLayout>,
    )

    const leftRailScroller = container.querySelector('aside > div')
    expect(leftRailScroller).toHaveClass('sticky', 'top-24')
    expect(leftRailScroller).not.toHaveClass('overflow-y-auto')
    expect(leftRailScroller?.className).not.toContain('max-h-')
  })
})
