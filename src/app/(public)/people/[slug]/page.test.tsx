import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PublicProfilePage from './page'

const mocks = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  getPeopleYouMayKnow: vi.fn(),
  getRelationshipState: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/features/auth/queries', () => ({
  getVerifiedUser: mocks.getVerifiedUser,
}))

vi.mock('@/features/feed/queries', () => ({
  getPostsByAuthor: vi.fn(async () => []),
}))

vi.mock('@/features/feed/components/profile-posts-section', () => ({
  ProfilePostsSection: () => <section><h2>Posts &amp; activity</h2></section>,
}))

vi.mock('@/features/profiles/queries', () => ({
  getPublicProfileBySlug: vi.fn(async () => ({
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'captain-public',
    profileType: 'seafarer',
    fullName: 'Captain Public',
    avatarPath: null,
    coverPath: null,
    location: 'Singapore',
    headline: 'Master Mariner',
    summary: 'Experienced tanker master.',
    rank: 'Master',
    currentCompany: 'Oceanic Shipping',
    currentVessel: 'MT Example',
    sailingExperienceYears: 20,
    vesselTypes: ['Oil Tanker'],
    tradingAreas: ['Worldwide'],
    shoreCareerPreference: false,
    availability: 'ashore',
    skills: ['Navigation'],
  })),
}))

vi.mock('@/features/profiles/profile-portfolio-queries', () => ({
  getProfilePortfolioById: vi.fn(async () => ({
    experiences: [{ id: 'experience-1' }],
    credentials: [{ id: 'credential-1' }],
  })),
}))

vi.mock('@/features/network/queries', () => ({
  getRelationshipState: mocks.getRelationshipState,
  getPeopleYouMayKnow: mocks.getPeopleYouMayKnow,
}))

vi.mock('@/features/network/components/relationship-controls', () => ({
  RelationshipControls: () => <div>Relationship controls</div>,
}))

vi.mock('@/features/network/components/people-you-may-know', () => ({
  PeopleYouMayKnow: ({ profiles }: { profiles: Array<{ fullName: string }> }) => (
    <aside aria-label="Profile recommendations">
      <h2>People you may know</h2>
      {profiles.map((profile) => <p key={profile.fullName}>{profile.fullName}</p>)}
    </aside>
  ),
}))

vi.mock('@/features/profiles/components/profile-header', () => ({
  ProfileHeader: ({ actions }: { actions?: React.ReactNode }) => (
    <header>
      <div>Profile header</div>
      {actions}
    </header>
  ),
}))
vi.mock('@/features/profiles/components/profile-about', () => ({
  ProfileAbout: () => <section><h2>About</h2></section>,
}))
vi.mock('@/features/profiles/components/maritime-profile-card', () => ({
  MaritimeProfileCard: () => <section><h2>Maritime Experience</h2></section>,
}))
vi.mock('@/features/profiles/components/profile-career-timeline', () => ({
  ProfileCareerTimeline: () => <section><h2>Experience</h2></section>,
}))
vi.mock('@/features/profiles/components/profile-credential-wallet', () => ({
  ProfileCredentialWallet: () => <section><h2>Licences & Credentials</h2></section>,
}))
vi.mock('@/features/profiles/components/profile-passport-overview', () => ({
  ProfilePassportOverview: () => <section><h2>My Maritime Passport</h2></section>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getVerifiedUser.mockResolvedValue({
    id: '11111111-1111-4111-8111-111111111111',
    cognitoSub: 'viewer-sub',
    email: 'viewer@example.com',
  })
  mocks.getRelationshipState.mockResolvedValue({
    following: false,
    connection: { kind: 'none', connectionId: null },
  })
  mocks.getPeopleYouMayKnow.mockResolvedValue([{
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'member-three',
    fullName: 'Member Three',
  }])
})

describe('Public Profile page', () => {
  it('shows the essential profile, relationship controls and a personalized recommendation rail without duplicate passport or posts', async () => {
    render(await PublicProfilePage({ params: Promise.resolve({ slug: 'captain-public' }) }))

    expect(screen.getByText('Profile header')).toBeInTheDocument()
    expect(screen.getByText('Relationship controls')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Maritime Experience' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Experience' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Licences & Credentials' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'People you may know' })).toBeInTheDocument()
    expect(screen.getByText('Member Three')).toBeInTheDocument()

    expect(screen.queryByRole('heading', { name: 'My Maritime Passport' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Posts & activity' })).not.toBeInTheDocument()
  })

  it('does not load personalized recommendations for a signed-out viewer', async () => {
    mocks.getVerifiedUser.mockResolvedValueOnce(null)

    render(await PublicProfilePage({ params: Promise.resolve({ slug: 'captain-public' }) }))

    expect(screen.queryByRole('heading', { name: 'People you may know' })).not.toBeInTheDocument()
    expect(mocks.getPeopleYouMayKnow).not.toHaveBeenCalled()
    expect(screen.queryByText('Relationship controls')).not.toBeInTheDocument()
  })

  it('uses the approved desktop content-plus-rail layout and does not load duplicate passport or feed activity', () => {
    const source = readFileSync('src/app/(public)/people/[slug]/page.tsx', 'utf8')
    expect(source).toContain('lg:grid-cols-[minmax(0,1fr)_300px]')
    expect(source).toContain('lg:sticky lg:top-24')
    expect(source).not.toContain('ProfilePassportOverview')
    expect(source).not.toContain('getPostsByAuthor')
    expect(source).not.toContain('ProfilePostsSection')
  })
})
