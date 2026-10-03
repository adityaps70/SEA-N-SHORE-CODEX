import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomePage from './page'
import { getFeedPage } from '@/features/feed/queries'
import { getPeopleYouMayKnow } from '@/features/network/queries'
import { getOwnProfile } from '@/features/profiles/queries'
import { getOwnProfilePortfolio } from '@/features/profiles/profile-portfolio-queries'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('@/features/feed/queries', () => ({ getFeedPage: vi.fn() }))
vi.mock('@/features/network/queries', () => ({ getPeopleYouMayKnow: vi.fn() }))
vi.mock('@/features/profiles/queries', () => ({ getOwnProfile: vi.fn() }))
vi.mock('@/features/profiles/profile-portfolio-queries', () => ({ getOwnProfilePortfolio: vi.fn() }))
vi.mock('@/features/profiles/home-rail-queries', () => ({
  getHomeRailData: vi.fn(async () => ({ verified: false, organizations: { memberships: [], application: null } })),
}))

vi.mock('@/features/feed/components/feed-layout', () => ({
  FeedLayout: ({ portfolioCompletion, suggestions, children }: { portfolioCompletion: { experienceCount: number; credentialCount: number }; suggestions: unknown[]; children: React.ReactNode }) => (
    <section>
      <span>Experience count {portfolioCompletion.experienceCount}</span>
      <span>Credential count {portfolioCompletion.credentialCount}</span>
      <span>Rail suggestions {suggestions.length}</span>
      {children}
    </section>
  ),
}))
vi.mock('@/features/feed/components/feed-list', () => ({
  FeedList: ({ category, suggestions }: { category?: string; suggestions: unknown[] }) => (
    <div>Feed list {category ?? 'all'} with {suggestions.length} suggestions</div>
  ),
}))
vi.mock('@/features/feed/components/post-composer', () => ({
  PostComposer: ({ composeRequest, hideTriggerOnPhones }: { composeRequest?: string; hideTriggerOnPhones?: boolean }) => (
    <div>Post composer {composeRequest ?? 'closed'}{hideTriggerOnPhones ? ' without phone trigger' : ''}</div>
  ),
}))

const mockedGetOwnProfile = vi.mocked(getOwnProfile)
const mockedGetOwnProfilePortfolio = vi.mocked(getOwnProfilePortfolio)
const mockedGetFeedPage = vi.mocked(getFeedPage)
const mockedGetPeopleYouMayKnow = vi.mocked(getPeopleYouMayKnow)

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer' as const,
  fullName: 'Member A',
  avatarPath: null,
  location: 'Mumbai',
  headline: 'Chief Officer',
  summary: 'Experienced maritime professional.',
  rank: 'Chief Officer',
  currentCompany: 'Example Shipping',
  currentVessel: null,
  sailingExperienceYears: 12,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: false,
  availability: null,
  skills: ['SIRE 2.0'],
  contactVisibility: 'members' as const,
  onboardingCompletedAt: '2026-09-02T10:00:00.000Z',
}

describe('HomePage profile completeness evidence', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOwnProfile.mockResolvedValue(profile)
    mockedGetOwnProfilePortfolio.mockResolvedValue({
      experiences: [{ id: 'exp-1' }] as never,
      credentials: [{ id: 'cred-1' }] as never,
    })
    mockedGetFeedPage.mockResolvedValue({ posts: [], nextCursor: null })
    mockedGetPeopleYouMayKnow.mockResolvedValue([])
  })

  it('loads the signed-in portfolio and passes its evidence counts into the feed layout', async () => {
    render(await HomePage({ searchParams: Promise.resolve({}) }))

    expect(mockedGetOwnProfilePortfolio).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Experience count 1')).toBeInTheDocument()
    expect(screen.getByText('Credential count 1')).toBeInTheDocument()
  })

  it('shows no topic chips on any screen size but still honours a ?category= link', async () => {
    render(await HomePage({ searchParams: Promise.resolve({ category: 'safety_lessons' }) }))

    expect(mockedGetFeedPage).toHaveBeenCalledWith({ category: 'safety_lessons' })
    expect(screen.queryByRole('navigation', { name: 'Filter maritime feed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Safety Lessons' })).not.toBeInTheDocument()
    expect(screen.getByText('Feed list safety_lessons with 0 suggestions')).toBeInTheDocument()
  })

  it('ignores an unknown category', async () => {
    render(await HomePage({ searchParams: Promise.resolve({ category: 'gossip' }) }))
    expect(mockedGetFeedPage).toHaveBeenCalledWith({ category: undefined })
    expect(screen.getByText('Feed list all with 0 suggestions')).toBeInTheDocument()
  })

  it('passes ?compose= to the composer and hides its trigger card on phones', async () => {
    render(await HomePage({ searchParams: Promise.resolve({ compose: 'poll' }) }))
    expect(screen.getByText('Post composer poll without phone trigger')).toBeInTheDocument()
  })

  it('ignores an unknown compose value', async () => {
    render(await HomePage({ searchParams: Promise.resolve({ compose: 'essay' }) }))
    expect(screen.getByText('Post composer closed without phone trigger')).toBeInTheDocument()
  })

  it('gives the phone feed up to five suggestions and keeps three for the desktop rail', async () => {
    mockedGetPeopleYouMayKnow.mockResolvedValue([1, 2, 3, 4, 5].map((id) => ({ id: `p${id}` })) as never)
    render(await HomePage({ searchParams: Promise.resolve({}) }))
    expect(mockedGetPeopleYouMayKnow).toHaveBeenCalledWith(5)
    expect(screen.getByText('Rail suggestions 3')).toBeInTheDocument()
    expect(screen.getByText('Feed list all with 5 suggestions')).toBeInTheDocument()
  })
})
