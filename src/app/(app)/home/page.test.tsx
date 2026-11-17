import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomePage from './page'
import { getHomeFeed } from '@/features/feed/queries'
import { getPeopleYouMayKnow } from '@/features/network/queries'
import { getOwnProfile } from '@/features/profiles/queries'
import { getOwnProfilePortfolio } from '@/features/profiles/profile-portfolio-queries'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('@/features/feed/queries', () => ({ getHomeFeed: vi.fn() }))
vi.mock('@/features/roles/components/rank-selection-prompt', () => ({ RankSelectionPrompt: () => null }))
vi.mock('@/features/countries/components/profile-country-sections', () => ({ HomeCountryPrompt: () => null }))
vi.mock('@/features/network/queries', () => ({ getPeopleYouMayKnow: vi.fn() }))
vi.mock('@/features/profiles/queries', () => ({ getOwnProfile: vi.fn() }))
vi.mock('@/features/profiles/profile-portfolio-queries', () => ({ getOwnProfilePortfolio: vi.fn() }))
vi.mock('@/features/profiles/home-rail-queries', () => ({
  getHomeRailData: vi.fn(async () => ({ verified: false, organizations: { memberships: [], application: null } })),
}))

vi.mock('@/features/feed/components/feed-layout', () => ({
  FeedLayout: ({ portfolioCompletion, discoveryRail, children }: { portfolioCompletion: { experienceCount: number; credentialCount: number }; discoveryRail: React.ReactNode; children: React.ReactNode }) => (
    <section>
      <span>Experience count {portfolioCompletion.experienceCount}</span>
      <span>Credential count {portfolioCompletion.credentialCount}</span>
      {discoveryRail}
      {children}
    </section>
  ),
}))
// Round P3: the rail and the feed stream in (home-streamed-sections.tsx); the rail shows what it was given.
vi.mock('@/features/feed/components/feed-discovery-rail', () => ({
  FeedDiscoveryRail: ({ suggestions }: { suggestions: unknown[] }) => <span>Rail suggestions {suggestions.length}</span>,
}))
vi.mock('@/features/feed/components/feed-list', () => ({
  FeedList: ({ category, suggestions }: { category?: string; suggestions: unknown[] }) => (
    <div>Feed list {category ?? 'all'} with {suggestions.length} suggestions</div>
  ),
}))
vi.mock('@/features/feed/components/home-feed', () => ({
  HomeFeed: ({ initialMode, category, debug }: { initialMode: string; category?: string; debug?: boolean }) => (
    <div>Home feed {initialMode} {category ?? 'all'}{debug ? ' debug' : ''}</div>
  ),
  FeedSkeleton: () => <div>Loading feed</div>,
}))
vi.mock('@/features/feed/components/post-composer', () => ({
  PostComposer: ({ composeRequest, hideTriggerOnPhones }: { composeRequest?: string; hideTriggerOnPhones?: boolean }) => (
    <div>Post composer {composeRequest ?? 'closed'}{hideTriggerOnPhones ? ' without phone trigger' : ''}</div>
  ),
}))

/** Renders the page inside act, so the streamed sections (React use()) resolve as they would in the browser. */
async function renderHome(props: Parameters<typeof HomePage>[0]) {
  const page = await HomePage(props)
  await act(async () => { render(page) })
}

const mockedGetOwnProfile = vi.mocked(getOwnProfile)
const mockedGetOwnProfilePortfolio = vi.mocked(getOwnProfilePortfolio)
const mockedGetHomeFeed = vi.mocked(getHomeFeed)
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
    mockedGetHomeFeed.mockResolvedValue({ mode: 'v1', page: { posts: [], nextCursor: null } })
    mockedGetPeopleYouMayKnow.mockResolvedValue([])
  })

  it('loads the signed-in portfolio and passes its evidence counts into the feed layout', async () => {
    await renderHome({ searchParams: Promise.resolve({}) })

    expect(mockedGetOwnProfilePortfolio).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Experience count 1')).toBeInTheDocument()
    expect(screen.getByText('Credential count 1')).toBeInTheDocument()
  })

  it('shows no topic chips on any screen size but still honours a ?category= link', async () => {
    await renderHome({ searchParams: Promise.resolve({ category: 'safety_lessons' }) })

    expect(mockedGetHomeFeed).toHaveBeenCalledWith({ category: 'safety_lessons' })
    expect(screen.queryByRole('navigation', { name: 'Filter maritime feed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Safety Lessons' })).not.toBeInTheDocument()
    expect(await screen.findByText('Feed list safety_lessons with 0 suggestions')).toBeInTheDocument()
  })

  it('ignores an unknown category', async () => {
    await renderHome({ searchParams: Promise.resolve({ category: 'gossip' }) })
    expect(mockedGetHomeFeed).toHaveBeenCalledWith({ category: undefined })
    expect(await screen.findByText('Feed list all with 0 suggestions')).toBeInTheDocument()
  })

  it('sends the shell first and streams the feed and the people rail in (Round P3)', async () => {
    let resolveFeed: (feed: { mode: 'v1'; page: { posts: never[]; nextCursor: null } }) => void = () => undefined
    mockedGetHomeFeed.mockReturnValue(new Promise((resolve) => { resolveFeed = resolve }))
    mockedGetPeopleYouMayKnow.mockRejectedValue(new Error('pymk down'))
    await renderHome({ searchParams: Promise.resolve({}) })

    expect(screen.getByText('Post composer closed without phone trigger')).toBeInTheDocument()
    expect(screen.getByText('Loading feed')).toBeInTheDocument()
    // Suggestions failing leaves the rail and the feed row empty instead of failing the page.
    expect(await screen.findByText('Rail suggestions 0')).toBeInTheDocument()
    await act(async () => { resolveFeed({ mode: 'v1', page: { posts: [], nextCursor: null } }) })
    expect(await screen.findByText('Feed list all with 0 suggestions')).toBeInTheDocument()
    expect(screen.queryByText('Loading feed')).not.toBeInTheDocument()
  })

  it('renders Top for you (round G) when the feed switch puts the member on the ranked feed', async () => {
    mockedGetHomeFeed.mockResolvedValue({ mode: 'top', page: null })
    await renderHome({ searchParams: Promise.resolve({ rankdebug: '1' }) })
    expect(await screen.findByText('Home feed top all debug')).toBeInTheDocument()
    expect(screen.queryByText(/^Feed list/)).not.toBeInTheDocument()
  })

  it('passes ?compose= to the composer and hides its trigger card on phones', async () => {
    await renderHome({ searchParams: Promise.resolve({ compose: 'poll' }) })
    expect(screen.getByText('Post composer poll without phone trigger')).toBeInTheDocument()
  })

  it('ignores an unknown compose value', async () => {
    await renderHome({ searchParams: Promise.resolve({ compose: 'essay' }) })
    expect(screen.getByText('Post composer closed without phone trigger')).toBeInTheDocument()
  })

  it('loads one suggestion list with spares for the phone feed row and the desktop rail', async () => {
    mockedGetPeopleYouMayKnow.mockResolvedValue([1, 2, 3, 4, 5].map((id) => ({ id: `p${id}` })) as never)
    await renderHome({ searchParams: Promise.resolve({}) })
    // Round G hotfix: 20 = up to 10 in the phone row plus spares; the rail shows 3 and keeps the rest
    // as spares that replace a card after Connect (see people-you-may-know.test.tsx).
    expect(mockedGetPeopleYouMayKnow).toHaveBeenCalledWith(20)
    expect(await screen.findByText('Rail suggestions 5')).toBeInTheDocument()
    expect(await screen.findByText('Feed list all with 5 suggestions')).toBeInTheDocument()
  })
})
