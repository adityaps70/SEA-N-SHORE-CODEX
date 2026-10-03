import { readFileSync } from 'node:fs'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OwnProfilePage from './page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/features/profiles/profile-inline-actions', () => ({
  updateProfileCurrentOrganization: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
}))

vi.mock('@/features/access/server', () => ({
  getAccessContext: vi.fn(async () => ({
    personalPlan: 'free',
    personalEntitlements: ['job.apply', 'event.attend', 'course.enroll'],
    verifications: [],
    organizationMemberships: [],
    accountActive: true,
  })),
}))

vi.mock('@/features/profiles/queries', () => ({
  getOwnRegisteredOrganization: vi.fn(async () => null),
  getProfileOrganizations: vi.fn(async () => [{
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'example-shipping',
    name: 'Example Shipping',
    logoUrl: null,
    verified: true,
    type: 'Ship manager',
    location: 'Mumbai, India',
    role: 'owner',
    relation: 'manages',
  }]),
  getOwnProfile: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'captain-example',
    profileType: 'seafarer',
    fullName: 'Captain Example',
    avatarPath: null,
    coverPath: null,
    location: 'Mumbai',
    headline: 'Master Mariner',
    summary: 'Experienced maritime professional.',
    rank: 'Master',
    currentCompany: 'Example Shipping',
    currentVessel: 'MV Example',
    sailingExperienceYears: 18,
    vesselTypes: ['Oil Tanker'],
    tradingAreas: ['Worldwide'],
    shoreCareerPreference: false,
    skills: ['Navigation'],
    contactVisibility: 'members',
    onboardingCompletedAt: '2026-09-01T00:00:00.000Z',
  })),
}))

vi.mock('@/features/profiles/profile-portfolio-queries', () => ({
  getOwnProfilePortfolio: vi.fn(async () => ({ experiences: [], credentials: [] })),
}))

vi.mock('@/features/network/queries', () => ({
  getPeopleYouMayKnow: vi.fn(async () => ([{
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'member-two',
    fullName: 'Member Two',
  }])),
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
  ProfileHeader: ({ actions, stats, badges }: { actions?: React.ReactNode; stats?: React.ReactNode; badges?: React.ReactNode }) => (
    <div>
      <div>Profile header</div>
      {badges}
      {stats}
      {actions}
    </div>
  ),
}))

const ownProfileMocks = vi.hoisted(() => ({
  summary: { counts: { connections: 12, followers: 30, following: 7 }, isOwner: true, canViewLists: true } as unknown,
  dgProfile: null as null | { kind: 'dg_profile'; fileName: string; sizeBytes: number; uploadedAt: string },
}))

vi.mock('@/features/profiles/profile-network-stats', () => ({
  getProfileNetworkSummary: vi.fn(async () => ownProfileMocks.summary),
}))
vi.mock('@/features/profiles/profile-document-service', () => ({
  getOwnDgProfileDocument: vi.fn(async () => ownProfileMocks.dgProfile),
}))
vi.mock('@/features/profiles/components/profile-dg-document-card', () => ({
  ProfileDgDocumentCard: ({ document }: { document: { fileName: string } | null }) => (
    <section><h2>DG Shipping profile</h2>{document ? <p>{document.fileName}</p> : <p>No DG profile yet</p>}</section>
  ),
}))
vi.mock('@/features/profiles/components/dg-profile-upload', () => ({
  DgProfileOnFileBadge: () => <span>DG profile on file</span>,
}))
vi.mock('@/features/profiles/components/profile-membership-card', () => ({
  ProfileMembershipCard: () => <section><h2>Access & goals</h2></section>,
}))
vi.mock('@/features/profiles/components/profile-about', () => ({
  ProfileAbout: () => <section><h2>About</h2></section>,
}))
vi.mock('@/features/profiles/components/maritime-profile-card', () => ({
  MaritimeProfileCard: () => <section><h2>Maritime Experience</h2></section>,
}))
vi.mock('@/features/profiles/components/profile-media-controls', () => ({
  ProfileMediaControls: () => <button type="button">Media control</button>,
}))
vi.mock('@/features/profiles/components/profile-career-timeline', () => ({
  ProfileCareerTimeline: () => <section><h2>Experience</h2></section>,
}))
vi.mock('@/features/profiles/components/profile-credential-wallet', () => ({
  ProfileCredentialWallet: () => <section><h2>Licences & Credentials</h2></section>,
}))
vi.mock('@/features/profiles/components/profile-passport-toolbar', () => ({
  ProfilePassportToolbar: ({ slug }: { slug: string }) => <a href={`/people/${slug}`}>View public profile</a>,
}))

describe('My Profile page', () => {
  afterEach(() => cleanup())

  it('keeps the essential editable profile sections and adds a reusable People you may know rail', async () => {
    render(await OwnProfilePage())

    expect(screen.getByText('Profile header')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view public profile/i })).toHaveAttribute('href', '/people/captain-example')
    expect(screen.getByRole('heading', { name: 'Access & goals' })).toBeInTheDocument()
    const organizations = screen.getByRole('region', { name: 'Organizations' })
    expect(organizations).toHaveTextContent('Owns or manages')
    expect(screen.getByRole('link', { name: /Example Shipping/ })).toHaveAttribute('href', '/organizations/example-shipping')
    // Round 11: a pencil chooses the current organization in place instead of a "Manage organizations" link.
    expect(screen.queryByRole('link', { name: 'Manage organizations' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit organizations' })).toBeInTheDocument()
    expect(document.querySelector('a[href^="/profile/edit"]')).toBeNull()
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Maritime Experience' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Experience' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Licences & Credentials' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'People you may know' })).toBeInTheDocument()
    expect(screen.getByText('Member Two')).toBeInTheDocument()

    expect(screen.queryByText('Professional identity')).not.toBeInTheDocument()
    expect(screen.queryByText('My Maritime Passport')).not.toBeInTheDocument()
    expect(screen.queryByText('Sea N Shore professional identity')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Posts & activity' })).not.toBeInTheDocument()
  })

  it('shows the owner network counts linking to their own network lists', async () => {
    ownProfileMocks.dgProfile = null
    render(await OwnProfilePage())

    expect(screen.getByRole('link', { name: /12\s*Connections/ })).toHaveAttribute('href', '/network?tab=connections')
    expect(screen.getByRole('link', { name: /30\s*Followers/ })).toHaveAttribute('href', '/network?tab=following&view=followers')
    expect(screen.getByRole('link', { name: /7\s*Following/ })).toHaveAttribute('href', '/network?tab=following&view=following')
    expect(screen.getByText(/Your connections can see who is in these lists/)).toBeInTheDocument()
  })

  it('offers the private DG profile section to seafarers and shows the on-file badge once uploaded', async () => {
    ownProfileMocks.dgProfile = null
    const { unmount } = render(await OwnProfilePage())
    expect(screen.getByRole('heading', { name: 'DG Shipping profile' })).toBeInTheDocument()
    expect(screen.getByText('No DG profile yet')).toBeInTheDocument()
    expect(screen.queryByText('DG profile on file')).not.toBeInTheDocument()
    unmount()

    ownProfileMocks.dgProfile = { kind: 'dg_profile', fileName: 'dg-profile.pdf', sizeBytes: 2048, uploadedAt: '2026-09-20T00:00:00.000Z' }
    render(await OwnProfilePage())
    expect(screen.getByText('DG profile on file')).toBeInTheDocument()
    expect(screen.getByText('dg-profile.pdf')).toBeInTheDocument()
  })

  it('uses a desktop content-plus-rail layout and does not load feed activity', () => {
    const source = readFileSync('src/app/(app)/profile/page.tsx', 'utf8')
    expect(source).toContain('lg:grid-cols-[minmax(0,1fr)_300px]')
    expect(source).toContain('lg:sticky lg:top-24')
    expect(source).not.toContain('getPostsByAuthor')
    expect(source).not.toContain('ProfilePostsSection')
  })

  it('on phones hides the membership card and People you may know, keeping sections in order', async () => {
    ownProfileMocks.dgProfile = null
    render(await OwnProfilePage())

    expect(screen.getByRole('heading', { name: 'Access & goals' }).closest('section')?.parentElement).toHaveClass('max-md:hidden')
    expect(screen.getByRole('heading', { name: 'People you may know' }).closest('aside')?.parentElement).toHaveClass('max-md:hidden')

    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    const order = ['About', 'Maritime Experience', 'Organizations', 'Experience', 'Licences & Credentials', 'DG Shipping profile']
    expect(order.map((title) => headings.indexOf(title))).toEqual([...order.map((title) => headings.indexOf(title))].sort((a, b) => a - b))
    expect(order.every((title) => headings.includes(title))).toBe(true)
  })
})
