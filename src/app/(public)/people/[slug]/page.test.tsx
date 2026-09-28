import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import PublicProfilePage from './page'

const mocks = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  getPeopleYouMayKnow: vi.fn(),
  getRelationshipState: vi.fn(),
  getPublicPostsByAuthor: vi.fn(),
  getProfileNetworkSummary: vi.fn(),
  getViewableDgProfileDocument: vi.fn(),
  getProfileOrganizations: vi.fn(),
}))

vi.mock('@/features/profiles/profile-network-stats', () => ({
  getProfileNetworkSummary: mocks.getProfileNetworkSummary,
}))
vi.mock('@/features/profiles/profile-document-service', () => ({
  getViewableDgProfileDocument: mocks.getViewableDgProfileDocument,
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/features/realtime/provider', () => ({
  MessagingRealtimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/features/auth/queries', () => ({
  getVerifiedUser: mocks.getVerifiedUser,
}))

vi.mock('@/features/feed/queries', () => ({
  getPublicPostsByAuthor: mocks.getPublicPostsByAuthor,
}))

vi.mock('@/features/feed/components/post-card', () => ({
  PostCard: ({ post }: { post: { body: string } }) => <article>{post.body}</article>,
}))

vi.mock('@/features/profiles/queries', () => ({
  getProfileOrganizations: mocks.getProfileOrganizations,
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
  RelationshipControls: ({ initialRelationship }: { initialRelationship: { connection: { kind: string } } }) => (
    <div>
      <span>Relationship controls</span>
      {initialRelationship.connection.kind === 'connected' ? <button type="button">Message</button> : null}
    </div>
  ),
}))

vi.mock('@/features/moderation/components/report-content-button', () => ({
  ReportContentButton: ({ targetType, targetId, label }: { targetType: string; targetId: string; label: string }) => (
    <button type="button" data-target-type={targetType} data-target-id={targetId}>{label}</button>
  ),
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
  ProfileHeader: ({ actions, stats }: { actions?: React.ReactNode; stats?: React.ReactNode }) => (
    <header>
      <div>Profile header</div>
      {stats}
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
  mocks.getProfileOrganizations.mockResolvedValue([])
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
  mocks.getPublicPostsByAuthor.mockResolvedValue([{
    id: 'post-1',
    body: 'Public maritime update',
  }])
  mocks.getProfileNetworkSummary.mockResolvedValue({
    counts: { connections: 42, followers: 1, following: 5 },
    isOwner: false,
    canViewLists: false,
  })
  mocks.getViewableDgProfileDocument.mockResolvedValue(null)
})

afterEach(() => cleanup())

describe('Public Profile page', () => {
  it('shows profile posts together with relationship controls and personalized recommendations without messaging non-connections', async () => {
    render(await PublicProfilePage({ params: Promise.resolve({ slug: 'captain-public' }) }))

    expect(screen.getByText('Profile header')).toBeInTheDocument()
    expect(screen.getByText('Relationship controls')).toBeInTheDocument()
    const reportProfile = screen.getByRole('button', { name: 'Report profile' })
    expect(reportProfile).toHaveAttribute('data-target-type', 'profile')
    expect(reportProfile).toHaveAttribute('data-target-id', '22222222-2222-4222-8222-222222222222')
    expect(screen.queryByRole('button', { name: 'Message' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Posts' })).toBeInTheDocument()
    expect(screen.getByText('Public maritime update')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Maritime Experience' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Experience' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Licences & Credentials' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'People you may know' })).toBeInTheDocument()
    expect(screen.getByText('Member Three')).toBeInTheDocument()
    expect(mocks.getPublicPostsByAuthor).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222')
    expect(screen.queryByRole('heading', { name: 'My Maritime Passport' })).not.toBeInTheDocument()
  })

  it('lists the organizations the member manages and works for, linking to each page', async () => {
    mocks.getProfileOrganizations.mockResolvedValueOnce([
      {
        id: 'org-1', slug: 'oceanic-shipping', name: 'Oceanic Shipping', logoUrl: '/api/company-logo/org-1',
        verified: true, type: 'Ship manager', location: 'Singapore', role: 'administrator', relation: 'manages',
      },
      {
        id: 'org-2', slug: 'harbour-crew', name: 'Harbour Crew', logoUrl: null,
        verified: false, unclaimed: true, type: 'Manning agency', location: null, role: 'member', relation: 'works_at',
      },
    ])

    render(await PublicProfilePage({ params: Promise.resolve({ slug: 'captain-public' }) }))

    expect(mocks.getProfileOrganizations).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222')
    const section = screen.getByRole('region', { name: 'Organizations' })
    const manages = screen.getByRole('list', { name: 'Owns or manages' })
    expect(manages).toHaveTextContent('Oceanic Shipping')
    expect(manages).toHaveTextContent('Administrator')
    expect(screen.getByRole('link', { name: /Oceanic Shipping/ })).toHaveAttribute('href', '/organizations/oceanic-shipping')
    expect(screen.getByRole('img', { name: 'Verified organization' })).toBeInTheDocument()
    const worksAt = screen.getByRole('list', { name: 'Works at' })
    expect(worksAt).toHaveTextContent('Harbour Crew')
    expect(worksAt).toHaveTextContent('Member / employee')
    expect(worksAt).toHaveTextContent('Unclaimed')
    expect(section).not.toHaveTextContent('Manage organizations')
  })

  it('omits the Organizations section when the member has none', async () => {
    render(await PublicProfilePage({ params: Promise.resolve({ slug: 'captain-public' }) }))
    expect(screen.queryByRole('region', { name: 'Organizations' })).not.toBeInTheDocument()
  })

  it('shows the Message CTA for a signed-in accepted connection', async () => {
    mocks.getRelationshipState.mockResolvedValueOnce({
      following: false,
      connection: {
        kind: 'connected',
        connectionId: '44444444-4444-4444-8444-444444444444',
      },
    })

    render(await PublicProfilePage({ params: Promise.resolve({ slug: 'captain-public' }) }))

    expect(screen.getAllByRole('button', { name: 'Message' })).toHaveLength(1)
  })

  it('keeps posts public while omitting personalized recommendations and messaging for a signed-out viewer', async () => {
    mocks.getVerifiedUser.mockResolvedValueOnce(null)

    render(await PublicProfilePage({ params: Promise.resolve({ slug: 'captain-public' }) }))

    expect(screen.getByRole('heading', { name: 'Posts' })).toBeInTheDocument()
    expect(screen.getByText('Public maritime update')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'People you may know' })).not.toBeInTheDocument()
    expect(mocks.getPeopleYouMayKnow).not.toHaveBeenCalled()
    expect(screen.queryByText('Relationship controls')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Report profile' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Message' })).not.toBeInTheDocument()
  })

  it('keeps About full-width in the main profile column instead of pairing it with Maritime Experience', () => {
    const source = readFileSync('src/app/(public)/people/[slug]/page.tsx', 'utf8')
    const aboutIndex = source.indexOf('<ProfileAbout profile={profile} />')
    const maritimeIndex = source.indexOf('<MaritimeProfileCard profile={profile} />')

    expect(aboutIndex).toBeGreaterThan(-1)
    expect(maritimeIndex).toBeGreaterThan(aboutIndex)
    expect(source).not.toContain('lg:grid-cols-[1.15fr_.85fr]')
  })

  it('keeps Posts as the final content section after credentials', () => {
    const source = readFileSync('src/app/(public)/people/[slug]/page.tsx', 'utf8')
    const credentialsIndex = source.indexOf('<ProfileCredentialWallet')
    const postsIndex = source.indexOf('<section aria-labelledby="profile-posts-heading"')
    const disclaimerIndex = source.indexOf('Sea N Shore professional profiles are member-provided.')

    expect(credentialsIndex).toBeGreaterThan(-1)
    expect(postsIndex).toBeGreaterThan(credentialsIndex)
    expect(disclaimerIndex).toBeGreaterThan(postsIndex)
  })

  it('uses the approved desktop content-plus-rail layout with public post activity and no duplicate passport component', () => {
    const source = readFileSync('src/app/(public)/people/[slug]/page.tsx', 'utf8')
    expect(source).toContain('lg:grid-cols-[minmax(0,1fr)_300px]')
    expect(source).toContain('lg:sticky lg:top-24')
    expect(source).toContain('getPublicPostsByAuthor')
    expect(source).toContain('<PostCard')
    expect(source).not.toContain('ProfilePassportOverview')
    expect(source).not.toContain('ProfilePostsSection')
  })

  it('shows network counts to a signed-in member but keeps the lists for connections only', async () => {
    render(await PublicProfilePage({ params: Promise.resolve({ slug: 'captain-public' }) }))

    const stats = screen.getByTestId('profile-network-stats')
    expect(stats).toHaveTextContent('42Connections')
    expect(stats).toHaveTextContent('1Follower')
    expect(stats).toHaveTextContent('5Following')
    expect(screen.queryByRole('link', { name: /Connections/ })).not.toBeInTheDocument()
    expect(screen.getByText("Only Captain's connections can see who is in these lists.")).toBeInTheDocument()
    expect(mocks.getProfileNetworkSummary).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
  })

  it('links the counts to the member lists for an accepted connection', async () => {
    mocks.getProfileNetworkSummary.mockResolvedValueOnce({
      counts: { connections: 42, followers: 10, following: 5 },
      isOwner: false,
      canViewLists: true,
    })

    render(await PublicProfilePage({ params: Promise.resolve({ slug: 'captain-public' }) }))

    expect(screen.getByRole('link', { name: /42\s*Connections/ })).toHaveAttribute('href', '/people/captain-public/network?view=connections')
    expect(screen.getByRole('link', { name: /10\s*Followers/ })).toHaveAttribute('href', '/people/captain-public/network?view=followers')
    expect(screen.getByRole('link', { name: /5\s*Following/ })).toHaveAttribute('href', '/people/captain-public/network?view=following')
    expect(screen.getByText('You can see these lists because you are connected.')).toBeInTheDocument()
  })

  it('shows no network numbers to signed-out visitors', async () => {
    mocks.getVerifiedUser.mockResolvedValueOnce(null)

    render(await PublicProfilePage({ params: Promise.resolve({ slug: 'captain-public' }) }))

    expect(screen.queryByTestId('profile-network-stats')).not.toBeInTheDocument()
    expect(mocks.getProfileNetworkSummary).not.toHaveBeenCalled()
    expect(mocks.getViewableDgProfileDocument).not.toHaveBeenCalled()
  })

  it('shows the private DG profile only to viewers the service authorises, with the reason', async () => {
    mocks.getViewableDgProfileDocument.mockResolvedValueOnce({
      kind: 'dg_profile',
      fileName: 'DG profile.pdf',
      sizeBytes: 2048,
      uploadedAt: '2026-09-20T00:00:00.000Z',
      reason: 'employer',
    })

    render(await PublicProfilePage({ params: Promise.resolve({ slug: 'captain-public' }) }))

    expect(screen.getByRole('heading', { name: 'DG Shipping profile' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open DG profile/ })).toHaveAttribute('href', '/api/profile/documents/dg-profile/22222222-2222-4222-8222-222222222222')
    expect(screen.getByText(/because Captain applied to a job you manage/)).toBeInTheDocument()
  })

  it('shows no DG profile section to other members', async () => {
    render(await PublicProfilePage({ params: Promise.resolve({ slug: 'captain-public' }) }))
    expect(screen.queryByRole('heading', { name: 'DG Shipping profile' })).not.toBeInTheDocument()
  })
})
