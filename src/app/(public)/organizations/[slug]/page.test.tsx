import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAccessContext: vi.fn(),
  getBySlug: vi.fn(),
  getFollowState: vi.fn(),
  countPeople: vi.fn(),
  listSimilarOrganizations: vi.fn(),
  getContactProfileId: vi.fn(),
  listPeople: vi.fn(),
  getViewer: vi.fn(),
  listUserAccessRequests: vi.fn(),
  getUserOrganizationState: vi.fn(),
  listPublishedJobsForCompany: vi.fn(),
  getSavedJobIds: vi.fn(),
  getAppliedJobIds: vi.fn(),
  listOrganizationEvents: vi.fn(),
  listPublishedCoursesForCompany: vi.fn(),
  createMediaReadUrl: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  getVerifiedUser: vi.fn(),
  getPublicBySlug: vi.fn(),
  countFollowers: vi.fn(),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => '/organizations/harbour-minds' }))
vi.mock('@/features/feed/components/organization-posts-tab', () => ({
  OrganizationPostsTab: (props: { canPost: boolean; limit?: number }) => (
    <div data-testid="org-posts" data-can-post={String(props.canPost)} data-limit={String(props.limit ?? '')} />
  ),
}))
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => <span data-testid="logo" data-src={String(props.src)} /> }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/access/server', () => ({ getAccessContext: mocks.getAccessContext }))
vi.mock('@/features/organizations/workspace-repository', () => ({
  organizationWorkspaceRepository: {
    getBySlug: mocks.getBySlug,
    getPublicBySlug: mocks.getPublicBySlug,
    countFollowers: mocks.countFollowers,
    getFollowState: mocks.getFollowState,
    countPeople: mocks.countPeople,
    listSimilarOrganizations: mocks.listSimilarOrganizations,
    getContactProfileId: mocks.getContactProfileId,
    listPeople: mocks.listPeople,
  },
}))
vi.mock('@/features/organizations/access-request-repository', () => ({
  organizationAccessRequestRepository: { getViewer: mocks.getViewer },
}))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: {
    listUserAccessRequests: mocks.listUserAccessRequests,
    getUserOrganizationState: mocks.getUserOrganizationState,
  },
}))
vi.mock('@/features/jobs/repository', () => ({
  jobsRepository: {
    listPublishedJobsForCompany: mocks.listPublishedJobsForCompany,
    getSavedJobIds: mocks.getSavedJobIds,
    getAppliedJobIds: mocks.getAppliedJobIds,
  },
}))
vi.mock('@/features/events/calendar-repository', () => ({
  calendarEventRepository: { listOrganizationEvents: mocks.listOrganizationEvents },
}))
vi.mock('@/features/learning/marketplace-repository', () => ({
  marketplaceRepository: { listPublishedCoursesForCompany: mocks.listPublishedCoursesForCompany },
}))
vi.mock('@/lib/aws/storage', () => ({ createMediaReadUrl: mocks.createMediaReadUrl }))
vi.mock('@/features/organizations/actions', () => ({ requestOrganizationAccess: vi.fn() }))
vi.mock('@/features/organizations/membership-actions', () => ({
  getLeaveOrganizationState: vi.fn(async () => ({ ok: true, state: { companyId: 'c1', slug: 'harbour-minds', name: 'Harbour Minds', role: 'member', lastOwner: false, administrators: [] } })),
  leaveOrganization: vi.fn(),
  transferOrganizationOwnership: vi.fn(),
}))
vi.mock('@/features/organizations/follow-actions', () => ({ followOrganizationAction: vi.fn(), unfollowOrganizationAction: vi.fn() }))
vi.mock('@/features/jobs/actions', () => ({ applyToJob: vi.fn(), prepareJobApplicationCvUpload: vi.fn(), saveJob: vi.fn(), unsaveJob: vi.fn() }))
vi.mock('@/features/messaging/actions', () => ({ startDirectConversationAction: vi.fn() }))

import OrganizationPage, { generateMetadata } from './page'

const workspace = {
  id: 'c1',
  slug: 'harbour-minds',
  name: 'Harbour Minds',
  logoPath: null,
  coverPath: null,
  tagline: null,
  companySize: '11-50',
  specialties: ['Crisis support', 'Peer counselling'],
  companyType: 'Mental-health & wellbeing provider',
  organizationType: 'mental_health_provider',
  details: { servicesOffered: ['counselling', 'crisis_support'], languages: ['English', 'Tagalog'], helpline24x7: true, accreditation: 'PRC registered' },
  website: 'https://harbourminds.org/',
  description: 'Confidential counselling for seafarers.\nAvailable in port and at sea.',
  fleetSummary: null,
  vesselTypes: [],
  officeLocations: ['Manila', 'Singapore'],
  verified: true,
}

const job = {
  id: 'j1', title: 'Wellbeing Officer', companyName: 'Harbour Minds', companyId: 'c1', companySlug: 'harbour-minds', companyLogoPath: null,
  companyLocation: 'Manila', companyType: null, companyVerified: true, recruiterVerified: true, location: 'Manila', summary: 'Support crews in port.',
  description: '', requirements: null, applyUntil: null, createdAt: '2026-09-20T00:00:00.000Z', publishedAt: '2026-09-20T00:00:00.000Z', domain: 'shore',
  department: null, rank: null, vesselTypes: [], experienceMinYears: null, experienceMaxYears: null, joiningFrom: null, joiningUntil: null, salaryMin: null,
  salaryMax: null, salaryCurrency: null, salaryPeriod: null, regions: [], certificateRequirements: [], visaRequirements: [], urgent: false, easyApply: false,
}

function access(role: string | null) {
  return {
    personalPlan: 'free',
    personalEntitlements: [],
    verifications: [],
    organizationMemberships: role ? [{ companyId: 'c1', plan: 'free', role, verified: true, entitlements: [] }] : [],
    accountActive: true,
  }
}

const params = Promise.resolve({ slug: 'harbour-minds' })

/** Every lookup that knows who is looking. A signed-out render must call none of them. */
const VIEWER_SCOPED = ['requireAwsUser', 'getAccessContext', 'getBySlug', 'getFollowState', 'listSimilarOrganizations', 'getContactProfileId', 'listPeople', 'getViewer', 'listUserAccessRequests', 'getUserOrganizationState', 'getSavedJobIds', 'getAppliedJobIds', 'listOrganizationEvents'] as const

// A name that only a signed-in render can show (the People tab lists members by name).
const CANARY = 'Canary Viewer Zq7x'

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getVerifiedUser.mockResolvedValue(null)
  mocks.getPublicBySlug.mockResolvedValue(workspace)
  mocks.countFollowers.mockResolvedValue(3)
  mocks.countPeople.mockResolvedValue(12)
  mocks.listPublishedJobsForCompany.mockResolvedValue([job])
  mocks.listPublishedCoursesForCompany.mockResolvedValue([])
  // What a signed-in render would see (never used signed out).
  mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-canary' })
  mocks.getBySlug.mockResolvedValue(workspace)
  mocks.getFollowState.mockResolvedValue({ following: true, followerCount: 3 })
  mocks.listSimilarOrganizations.mockResolvedValue([])
  mocks.getContactProfileId.mockResolvedValue('owner-1')
  mocks.listPeople.mockResolvedValue([{ id: 'p1', fullName: CANARY, slug: 'canary-viewer', headline: 'Chief Officer', avatarPath: null, memberRole: 'owner' }])
  mocks.listUserAccessRequests.mockResolvedValue([])
  mocks.getUserOrganizationState.mockResolvedValue({ kind: 'none' })
  mocks.getViewer.mockResolvedValue({ role: 'owner' })
  mocks.getSavedJobIds.mockResolvedValue(['j1'])
  mocks.getAppliedJobIds.mockResolvedValue(['j1'])
  mocks.listOrganizationEvents.mockResolvedValue([])
  mocks.createMediaReadUrl.mockResolvedValue('https://signed.example/photo.jpg')
  mocks.getAccessContext.mockResolvedValue(access('owner'))
})

describe('/organizations/[slug] for visitors (Round ARCH, Phase 2)', () => {
  it('shows the public page and reads nothing about a viewer', async () => {
    const { container } = render(await OrganizationPage({ params }))

    expect(screen.getByRole('heading', { level: 1, name: /Harbour Minds/ })).toBeInTheDocument()
    expect(screen.getByText('3 followers')).toBeInTheDocument()
    expect(screen.getByText('12 people work here')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'About' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Support offered' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Open jobs (1)' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in to follow Harbour Minds' })).toHaveAttribute('href', '/auth/sign-in?next=%2Forganizations%2Fharbour-minds')
    expect(container.querySelector('script[type="application/ld+json"]')?.textContent).toContain('"@type":"Organization"')

    for (const name of VIEWER_SCOPED) expect(mocks[name], name).not.toHaveBeenCalled()
    expect(mocks.getPublicBySlug).toHaveBeenCalledWith('harbour-minds')
  })

  it('has no member actions, contact person, people names, posts or events', async () => {
    const { container } = render(await OrganizationPage({ params }))
    const html = container.innerHTML

    for (const name of ['Follow', 'Following', 'Message', 'Request access', 'Leave organization', 'Manage page']) {
      expect(screen.queryByRole('button', { name }), name).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name }), name).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('region', { name: /Work at Harbour Minds/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /You are part of/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /page sections/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('org-posts')).not.toBeInTheDocument()
    expect(screen.queryByText(/Upcoming events/)).not.toBeInTheDocument()
    expect(html).not.toContain(CANARY)
    expect(html).not.toContain('viewer-canary')
    expect(html).not.toContain('owner-1')
    expect(html).not.toMatch(/tel:|\+91|phone/i)
    expect(html).not.toContain('/manage')
  })

  it('a member sees the full signed-in page (canary visible there), and a visitor never does', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: 'viewer-canary' })
    const signedIn = render(await OrganizationPage({ params, searchParams: Promise.resolve({ tab: 'people' }) }))
    expect(signedIn.container.innerHTML).toContain(CANARY)
    expect(mocks.getPublicBySlug).not.toHaveBeenCalled()
    cleanup()

    vi.clearAllMocks()
    mocks.getVerifiedUser.mockResolvedValue(null)
    mocks.getPublicBySlug.mockResolvedValue(workspace)
    mocks.countFollowers.mockResolvedValue(3)
    mocks.countPeople.mockResolvedValue(12)
    mocks.listPublishedJobsForCompany.mockResolvedValue([])
    mocks.listPublishedCoursesForCompany.mockResolvedValue([])
    const visitor = render(await OrganizationPage({ params, searchParams: Promise.resolve({ tab: 'people' }) }))
    expect(visitor.container.innerHTML).not.toContain(CANARY)
    expect(mocks.listPeople).not.toHaveBeenCalled()
  })

  it.each([
    ['unclaimed (imported, nobody manages it)'],
    ['suspended by Sea N Shore'],
    ['rejected (removed) by Sea N Shore'],
    ['deleted'],
  ])('a %s organization is not found signed out, even though members could open it', async () => {
    // getPublicBySlug applies the rule (organizationPubliclyVisibleSql); the signed-in lookup would still find it.
    mocks.getPublicBySlug.mockResolvedValue(null)
    await expect(OrganizationPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
    expect(mocks.getBySlug).not.toHaveBeenCalled()
    for (const name of VIEWER_SCOPED) expect(mocks[name], name).not.toHaveBeenCalled()
  })

  it('never names a non-public organization in a visitor\'s page title', async () => {
    mocks.getPublicBySlug.mockResolvedValue(null)
    expect(await generateMetadata({ params })).toEqual({ title: 'Organization' })
    expect(mocks.getBySlug).not.toHaveBeenCalled()

    mocks.getPublicBySlug.mockResolvedValue(workspace)
    expect((await generateMetadata({ params })).title).toBe('Harbour Minds')
  })

  it('a member\'s page title still uses the signed-in lookup', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: 'viewer-canary' })
    mocks.getBySlug.mockResolvedValue({ ...workspace, unclaimed: true, verified: false })
    expect((await generateMetadata({ params })).title).toBe('Harbour Minds')
    expect(mocks.getPublicBySlug).not.toHaveBeenCalled()
  })
})
