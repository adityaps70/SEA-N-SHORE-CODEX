import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('@/features/feed/components/feed-layout', () => ({
  FeedLayout: ({ portfolioCompletion, children }: { portfolioCompletion: { experienceCount: number; credentialCount: number }; children: React.ReactNode }) => (
    <section>
      <span>Experience count {portfolioCompletion.experienceCount}</span>
      <span>Credential count {portfolioCompletion.credentialCount}</span>
      {children}
    </section>
  ),
}))
vi.mock('@/features/feed/components/feed-list', () => ({ FeedList: () => <div>Feed list</div> }))
vi.mock('@/features/feed/components/post-composer', () => ({ PostComposer: () => <div>Post composer</div> }))

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
})
