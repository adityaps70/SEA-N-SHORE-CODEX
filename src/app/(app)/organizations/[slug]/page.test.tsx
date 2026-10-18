import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => '/organizations/harbour-minds' }))
vi.mock('@/features/feed/components/organization-posts-tab', () => ({
  OrganizationPostsTab: (props: { canPost: boolean; limit?: number }) => (
    <div data-testid="org-posts" data-can-post={String(props.canPost)} data-limit={String(props.limit ?? '')} />
  ),
}))
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => <span data-testid="logo" data-src={String(props.src)} /> }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ getAccessContext: mocks.getAccessContext }))
vi.mock('@/features/organizations/workspace-repository', () => ({
  organizationWorkspaceRepository: {
    getBySlug: mocks.getBySlug,
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

import OrganizationPage from './page'

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
const tab = (value: string) => Promise.resolve({ tab: value })

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
  mocks.getBySlug.mockResolvedValue(workspace)
  mocks.getFollowState.mockResolvedValue({ following: false, followerCount: 3 })
  mocks.countPeople.mockResolvedValue(12)
  mocks.listSimilarOrganizations.mockResolvedValue([])
  mocks.getContactProfileId.mockResolvedValue('owner-1')
  mocks.listPeople.mockResolvedValue([])
  mocks.listUserAccessRequests.mockResolvedValue([])
  mocks.getUserOrganizationState.mockResolvedValue({ kind: 'none' })
  mocks.getViewer.mockResolvedValue(null)
  mocks.listPublishedJobsForCompany.mockResolvedValue([])
  mocks.getSavedJobIds.mockResolvedValue([])
  mocks.getAppliedJobIds.mockResolvedValue([])
  mocks.listOrganizationEvents.mockResolvedValue([])
  mocks.listPublishedCoursesForCompany.mockResolvedValue([])
  mocks.createMediaReadUrl.mockResolvedValue('https://signed.example/photo.jpg')
  mocks.getAccessContext.mockResolvedValue(access(null))
})

describe('/organizations/[slug] public page', () => {
  it('shows a company-page header with tagline fallback, meta line, people count and actions', async () => {
    render(await OrganizationPage({ params }))

    const header = screen.getByRole('region', { name: /^Harbour Minds/ })
    expect(within(header).getByRole('heading', { level: 1, name: /Harbour Minds/ })).toBeInTheDocument()
    expect(within(header).getByRole('img', { name: 'Verified by Sea N Shore' })).toBeInTheDocument()
    // No saved tagline: the first line of the description is used.
    expect(within(header).getByText('Confidential counselling for seafarers.')).toBeInTheDocument()
    expect(within(header).getByText('Mental-health & wellbeing provider')).toBeInTheDocument()
    expect(within(header).getByText('Manila')).toBeInTheDocument()
    expect(within(header).getByText('3 followers')).toBeInTheDocument()
    expect(within(header).getByText('11–50 employees')).toBeInTheDocument()
    expect(within(header).getByRole('link', { name: '12 people work here' })).toHaveAttribute('href', '/organizations/harbour-minds?tab=people')
    expect(within(header).getByText('24/7 helpline')).toBeInTheDocument()
    expect(within(header).getByRole('link', { name: /Visit website/ })).toHaveAttribute('href', 'https://harbourminds.org/')
    expect(within(header).getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(header).getByRole('button', { name: 'Message' })).toBeInTheDocument()
    expect(within(header).queryByRole('link', { name: /Manage page/ })).not.toBeInTheDocument()

    const tabs = screen.getByRole('navigation', { name: 'Harbour Minds page sections' })
    expect(within(tabs).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(within(tabs).getByRole('link', { name: 'About' })).toHaveAttribute('href', '/organizations/harbour-minds?tab=about')
    expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual(['Home', 'About', 'Posts', 'Jobs', 'Events', 'Courses', 'People'])

    // Visitors can ask to join from the side card; the request tools moved to Manage page.
    const join = screen.getByRole('region', { name: 'Work at Harbour Minds?' })
    expect(within(join).getByRole('button', { name: 'Request access' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Requests/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('org-posts')).toHaveAttribute('data-can-post', 'false')
  })

  it('marks an unclaimed page and offers to claim it instead of requesting to join', async () => {
    mocks.getBySlug.mockResolvedValue({ ...workspace, verified: false, unclaimed: true })
    render(await OrganizationPage({ params }))

    const header = screen.getByRole('region', { name: /^Harbour Minds/ })
    expect(within(header).getByText('Unclaimed')).toBeInTheDocument()
    expect(within(header).queryByText('Not verified yet')).not.toBeInTheDocument()
    expect(within(header).getByRole('link', { name: 'Claim this page' })).toHaveAttribute('href', '/organizations/harbour-minds/claim')

    const claim = screen.getByRole('region', { name: 'Nobody manages this page yet' })
    expect(within(claim).getByRole('link', { name: 'Claim this page' })).toHaveAttribute('href', '/organizations/harbour-minds/claim')
    expect(screen.queryByRole('region', { name: 'Work at Harbour Minds?' })).not.toBeInTheDocument()
    expect(screen.getByTestId('org-posts')).toHaveAttribute('data-can-post', 'false')
  })

  it('offers copy link, share and request to join from the more menu, and Escape closes it', async () => {
    render(await OrganizationPage({ params }))
    // The phone page bar and the header both have a "…" button; they open the same menu.
    const [barTrigger, headerTrigger] = screen.getAllByRole('button', { name: 'More actions for Harbour Minds' })
    fireEvent.click(headerTrigger!)
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Copy link' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Share page' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Request to join' })).toHaveAttribute('href', '#work-here')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(barTrigger!)
    expect(screen.getByRole('menu', { name: 'More actions for Harbour Minds' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows a phone page bar that goes back to Organizations', async () => {
    render(await OrganizationPage({ params }))
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/organizations')
  })

  describe('"…" sheet items per role', () => {
    async function openMenu() {
      render(await OrganizationPage({ params }))
      fireEvent.click(screen.getAllByRole('button', { name: 'More actions for Harbour Minds' })[1]!)
      return within(screen.getByRole('menu'))
    }
    const labels = (menu: ReturnType<typeof within>) => menu.getAllByRole('menuitem').map((item: HTMLElement) => item.textContent?.replace('(opens in a new tab)', '').trim())

    it('visitor: website, copy, share and request to join', async () => {
      const menu = await openMenu()
      expect(labels(menu)).toEqual(['Visit website', 'Copy link', 'Share page', 'Request to join'])
      expect(menu.getByRole('menuitem', { name: /Visit website/ })).toHaveAttribute('href', 'https://harbourminds.org/')
      // Phone-only rows: the header shows these as buttons on desktop.
      expect(menu.getByRole('menuitem', { name: /Visit website/ })).toHaveClass('md:hidden')
    })

    it('visitor with a pending request: See your request', async () => {
      mocks.listUserAccessRequests.mockResolvedValue([{ id: 'r1', status: 'pending', company: { id: 'c1', slug: 'harbour-minds', name: 'Harbour Minds' } }])
      const menu = await openMenu()
      expect(menu.getByRole('menuitem', { name: 'See your request' })).toHaveAttribute('href', '/organizations#your-requests')
      expect(menu.queryByRole('menuitem', { name: 'Request to join' })).not.toBeInTheDocument()
    })

    it('unclaimed page: Claim this page', async () => {
      mocks.getBySlug.mockResolvedValue({ ...workspace, verified: false, unclaimed: true, website: null })
      const menu = await openMenu()
      // Round H (H6): Claim this page and Message are the two secondary buttons; on phones only the first fits, so Message is a phone-only row.
      expect(labels(menu)).toEqual(['Message', 'Copy link', 'Share page', 'Claim this page'])
      expect(menu.getByRole('menuitem', { name: 'Message' })).toHaveClass('md:hidden')
      expect(menu.getByRole('menuitem', { name: 'Claim this page' })).toHaveAttribute('href', '/organizations/harbour-minds/claim')
    })

    it('owner of a free organization: Upgrade to Organization Pro, no join row', async () => {
      mocks.getAccessContext.mockResolvedValue(access('owner'))
      mocks.getViewer.mockResolvedValue({ kind: 'organization', role: 'owner' })
      const menu = await openMenu()
      // Round H (H6): Message, Create a community and Upgrade no longer fit beside Manage page, Follow and Visit website.
      expect(labels(menu)).toEqual(['Visit website', 'Message', 'Create a community', 'Copy link', 'Share page', 'Upgrade to Organization Pro', 'Leave organization'])
      expect(menu.getByRole('menuitem', { name: 'Upgrade to Organization Pro' })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=billing')
      expect(menu.getByRole('menuitem', { name: 'Upgrade to Organization Pro' })).not.toHaveClass('md:hidden')
    })

    it('recruiter: no upgrade and no join row', async () => {
      mocks.getAccessContext.mockResolvedValue(access('recruiter'))
      const menu = await openMenu()
      // Round H (H6): Message to the contact person moved from the header into the menu for people who manage the page.
      expect(labels(menu)).toEqual(['Visit website', 'Message', 'Copy link', 'Share page', 'Leave organization'])
    })

    it('member: "Leave organization" opens the in-page leave dialog (round F)', async () => {
      mocks.getAccessContext.mockResolvedValue(access('member'))
      const menu = await openMenu()
      fireEvent.click(menu.getByRole('menuitem', { name: 'Leave organization' }))
      expect(await screen.findByRole('alertdialog', { name: 'Leave Harbour Minds?' })).toBeInTheDocument()
    })
  })

  it('turns "Work here?" into one phone row that opens the request flow, also from the menu', async () => {
    render(await OrganizationPage({ params }))
    const join = screen.getByRole('region', { name: 'Work at Harbour Minds?' })
    const row = within(join).getByRole('button', { name: 'Work here? Request access' })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    const panel = document.getElementById(row.getAttribute('aria-controls') ?? '')
    expect(panel).toHaveClass('max-md:hidden')
    expect(within(panel!).getByRole('button', { name: 'Request access' })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'More actions for Harbour Minds' })[1]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Request to join' }))
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(panel).not.toHaveClass('max-md:hidden')
  })

  it('hides duplicate side cards on phones', async () => {
    mocks.listSimilarOrganizations.mockResolvedValue([{
      id: 'c2', slug: 'sailors-care', name: 'Sailors Care', logoPath: null, coverPath: null, tagline: null, description: null,
      companyType: null, organizationType: 'mental_health_provider', headquarters: null, verified: true, followerCount: 1, following: false,
    }])
    mocks.getAccessContext.mockResolvedValue(access('owner'))
    mocks.getViewer.mockResolvedValue({ kind: 'organization', role: 'owner' })
    render(await OrganizationPage({ params }))
    expect(screen.getByRole('region', { name: 'You are part of Harbour Minds' })).toHaveClass('max-md:hidden')
    expect(screen.getByRole('region', { name: 'Pages people also viewed' })).toHaveClass('max-md:hidden')
    // Round H (H6): Upgrade to Organization Pro is no longer a header link (hidden on phones); it is in the "…" menu at every size.
    expect(screen.queryByRole('link', { name: 'Upgrade to Organization Pro' })).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions for Harbour Minds' })[1]!)
    expect(screen.getByRole('menuitem', { name: 'Upgrade to Organization Pro' })).not.toHaveClass('md:hidden')
  })

  it('shows the About tab with overview facts, specialities, verification and wellbeing support', async () => {
    render(await OrganizationPage({ params, searchParams: tab('about') }))

    const overview = screen.getByRole('region', { name: 'Overview' })
    expect(within(overview).getByText('Company size').nextSibling).toHaveTextContent('11–50 employees')
    expect(within(overview).getByText('Headquarters').nextSibling).toHaveTextContent('Manila')
    expect(within(overview).getByText('Locations').nextSibling).toHaveTextContent('Manila · Singapore')
    expect(within(overview).getByText('Specialities').nextSibling).toHaveTextContent('Crisis support, Peer counselling')
    expect(within(overview).getByText('Verified by Sea N Shore')).toBeInTheDocument()
    const support = screen.getByRole('region', { name: 'Support offered' })
    expect(within(support).getByText('Counselling & therapy')).toBeInTheDocument()
    expect(within(support).getByText('English, Tagalog')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Operations' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page')
  })

  it('lists the organization\'s open jobs on the Jobs tab and explains an empty list', async () => {
    mocks.listPublishedJobsForCompany.mockResolvedValue([job])
    mocks.getSavedJobIds.mockResolvedValue(['j1'])
    render(await OrganizationPage({ params, searchParams: tab('jobs') }))
    expect(mocks.listPublishedJobsForCompany).toHaveBeenCalledWith('c1', 30)
    expect(mocks.getSavedJobIds).toHaveBeenCalledWith('user-1', ['j1'])
    expect(screen.getByRole('region', { name: 'Open jobs (1)' })).toHaveTextContent('Wellbeing Officer')
    expect(mocks.listOrganizationEvents).not.toHaveBeenCalled()

    cleanup()
    mocks.listPublishedJobsForCompany.mockResolvedValue([])
    render(await OrganizationPage({ params, searchParams: tab('jobs') }))
    expect(screen.getByText(/Harbour Minds has no open jobs right now/)).toBeInTheDocument()
  })

  it('shows a clear message when a section fails to load instead of breaking the page', async () => {
    mocks.listOrganizationEvents.mockRejectedValue(new Error('db down'))
    render(await OrganizationPage({ params, searchParams: tab('events') }))
    expect(screen.getByRole('alert')).toHaveTextContent('Events could not be loaded right now. Reload the page to try again.')
    expect(screen.getByRole('heading', { level: 1, name: /Harbour Minds/ })).toBeInTheDocument()
  })

  it('lists team members and people who work here on the People tab with public details only', async () => {
    mocks.listPeople.mockResolvedValue([
      { id: 'p1', fullName: 'Grace Santos', slug: 'grace', headline: 'Counsellor', avatarPath: 'avatars/p1.jpg', memberRole: 'owner' },
      { id: 'p2', fullName: 'Arjun Rao', slug: 'arjun', headline: null, avatarPath: null, memberRole: null },
    ])
    render(await OrganizationPage({ params, searchParams: tab('people') }))
    const people = screen.getByRole('region', { name: 'People (12)' })
    expect(within(people).getByRole('link', { name: 'Grace Santos' })).toHaveAttribute('href', '/people/grace')
    expect(within(people).getByText('Team · Owner')).toBeInTheDocument()
    expect(within(people).getByText('Maritime professional')).toBeInTheDocument()
    expect(mocks.listPeople).toHaveBeenCalledWith('c1', 'user-1')
    expect(mocks.createMediaReadUrl).toHaveBeenCalledWith('avatars/p1.jpg')
  })

  it('gives members with a management role a Manage page button and hides Message to themselves', async () => {
    mocks.getAccessContext.mockResolvedValue(access('owner'))
    mocks.getViewer.mockResolvedValue({ kind: 'organization', role: 'owner' })
    mocks.getContactProfileId.mockResolvedValue('user-1')
    render(await OrganizationPage({ params }))

    expect(screen.getByRole('link', { name: /Manage page/ })).toHaveAttribute('href', '/organizations/harbour-minds/manage')
    expect(screen.queryByRole('button', { name: 'Message' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'You are part of Harbour Minds' })).toHaveTextContent('Owner · Free plan')
    expect(screen.getByTestId('org-posts')).toHaveAttribute('data-limit', '3')
  })

  it('puts "Leave organization" on the "You are part of" card for any member (round F)', async () => {
    mocks.getAccessContext.mockResolvedValue(access('member'))
    render(await OrganizationPage({ params }))
    const card = screen.getByRole('region', { name: 'You are part of Harbour Minds' })
    fireEvent.click(within(card).getByRole('button', { name: 'Leave organization' }))
    expect(await screen.findByRole('alertdialog', { name: 'Leave Harbour Minds?' })).toBeInTheDocument()
  })

  it('shows no leave control to a visitor (round F)', async () => {
    render(await OrganizationPage({ params }))
    expect(screen.queryByRole('button', { name: 'Leave organization' })).not.toBeInTheDocument()
  })

  it('offers owners and administrators "Create a community" in the "…" menu beside Manage page, pointing at /community/new?as=<organization> (round 9C)', async () => {
    mocks.getAccessContext.mockResolvedValue(access('administrator'))
    mocks.getViewer.mockResolvedValue({ kind: 'organization', role: 'administrator' })
    render(await OrganizationPage({ params }))
    // Round H (H6): the header keeps Manage page, Follow and Visit website; Create a community is in the menu at every size.
    const row = screen.getByTestId('organization-actions')
    expect(within(row).getByRole('link', { name: /Manage page/ })).toBeInTheDocument()
    expect(within(row).queryByRole('link', { name: /Create a community/ })).not.toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'More actions for Harbour Minds' }))
    const create = screen.getByRole('menuitem', { name: /Create a community/ })
    expect(create).toHaveAttribute('href', '/community/new?as=c1')
    expect(create).not.toHaveClass('md:hidden')
    cleanup()

    mocks.getAccessContext.mockResolvedValue(access('recruiter'))
    mocks.getViewer.mockResolvedValue({ kind: 'organization', role: 'recruiter' })
    render(await OrganizationPage({ params }))
    expect(screen.queryByRole('link', { name: /Create a community/ })).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('organization-actions')).getByRole('button', { name: 'More actions for Harbour Minds' }))
    expect(screen.queryByRole('menuitem', { name: /Create a community/ })).not.toBeInTheDocument()
  })

  it('shows the owner of a free organization Upgrade to Organization Pro in the "…" menu beside Manage page', async () => {
    mocks.getAccessContext.mockResolvedValue(access('owner'))
    mocks.getViewer.mockResolvedValue({ kind: 'organization', role: 'owner' })
    render(await OrganizationPage({ params }))

    // Round H (H6): a menu row instead of a header link, so the header row never wraps.
    fireEvent.click(within(screen.getByTestId('organization-actions')).getByRole('button', { name: 'More actions for Harbour Minds' }))
    expect(screen.getByRole('menuitem', { name: 'Upgrade to Organization Pro' })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=billing')
  })

  it('does not show the upgrade link to roles that cannot buy or to Organization Pro workspaces', async () => {
    mocks.getAccessContext.mockResolvedValue(access('recruiter'))
    render(await OrganizationPage({ params }))
    expect(screen.queryByRole('link', { name: 'Upgrade to Organization Pro' })).not.toBeInTheDocument()
    cleanup()

    mocks.getAccessContext.mockResolvedValue({ ...access('owner'), organizationMemberships: [{ companyId: 'c1', plan: 'organization_pro', role: 'owner', verified: true, entitlements: [] }] })
    render(await OrganizationPage({ params }))
    expect(screen.queryByRole('link', { name: 'Upgrade to Organization Pro' })).not.toBeInTheDocument()
  })

  it('lets plain members reach their workspace without showing the Manage page button', async () => {
    mocks.getAccessContext.mockResolvedValue(access('member'))
    render(await OrganizationPage({ params }))
    expect(screen.queryByRole('link', { name: /Manage page/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open workspace tools' })).toHaveAttribute('href', '/organizations/harbour-minds/manage')
  })

  it('does not ask the owner of an unverified organization to request access to it', async () => {
    mocks.getUserOrganizationState.mockResolvedValue({
      kind: 'application',
      applicationId: 'a1',
      status: 'pending',
      submittedAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
      adminReviewNote: null,
      company: { id: 'c1', slug: 'harbour-minds', name: 'Harbour Minds', verified: false },
      membership: { role: 'owner', approvedAt: null },
    })
    render(await OrganizationPage({ params }))
    expect(screen.getByText('Sea N Shore is verifying this organization')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Manage page/ })).toBeInTheDocument()
  })

  it('shows similar organizations with follow buttons in the right rail', async () => {
    mocks.listSimilarOrganizations.mockResolvedValue([{
      id: 'c2', slug: 'sailors-care', name: 'Sailors Care', logoPath: null, coverPath: null, tagline: null, description: null,
      companyType: 'Mental-health & wellbeing provider', organizationType: 'mental_health_provider', headquarters: 'Mumbai',
      verified: true, followerCount: 1, following: true,
    }])
    render(await OrganizationPage({ params }))
    const rail = screen.getByRole('region', { name: 'Pages people also viewed' })
    expect(within(rail).getByRole('link', { name: 'Sailors Care' })).toHaveAttribute('href', '/organizations/sailors-care')
    expect(within(rail).getByText('1 follower')).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Following Sailors Care' })).toHaveAttribute('aria-pressed', 'true')
    expect(mocks.listSimilarOrganizations).toHaveBeenCalledWith(workspace, 'user-1', 4)
  })

  describe('header action row (round H, H6)', () => {
    async function renderRow() {
      render(await OrganizationPage({ params }))
      return screen.getByTestId('organization-actions')
    }
    const slots = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLElement>('[data-header-action]'))
    const byEmphasis = (row: HTMLElement, emphasis: string) => slots(row).filter((slot) => slot.dataset.emphasis === emphasis).map((slot) => slot.dataset.headerAction)
    // Filled navy controls in the row (the shared primary look).
    const darkControls = (row: HTMLElement) => Array.from(row.querySelectorAll('a, button')).filter((element) => element.classList.contains('bg-navy-950'))
    async function menuLabels(row: HTMLElement) {
      fireEvent.click(within(row).getByRole('button', { name: 'More actions for Harbour Minds' }))
      return within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent?.replace('(opens in a new tab)', '').trim())
    }

    function expectOneLine(row: HTMLElement) {
      expect(row).toHaveClass('flex', 'flex-nowrap')
      expect(row).not.toHaveClass('flex-wrap')
      // The "…" button is in the same row as the buttons.
      expect(within(row).getByRole('button', { name: 'More actions for Harbour Minds' })).toBeInTheDocument()
    }

    it('visitor: Follow is the one primary, Message and Visit website are secondary', async () => {
      const row = await renderRow()
      expectOneLine(row)
      expect(byEmphasis(row, 'primary')).toEqual(['follow'])
      expect(byEmphasis(row, 'secondary')).toEqual(['message', 'website'])
      expect(darkControls(row)).toHaveLength(1)
      expect(within(row).getByRole('button', { name: 'Follow' })).toHaveClass('bg-navy-950')
      expect(within(row).getByRole('button', { name: 'Message' })).not.toHaveClass('bg-navy-950')
      expect(within(row).getByRole('link', { name: /Visit website/ })).not.toHaveClass('bg-navy-950')
      // Phones: only the first secondary button fits; the second is a phone-only menu row.
      expect(row.querySelector('[data-header-action="website"]')).toHaveClass('max-md:hidden')
      expect(row.querySelector('[data-header-action="message"]')).not.toHaveClass('max-md:hidden')
      expect(await menuLabels(row)).toEqual(['Visit website', 'Copy link', 'Share page', 'Request to join'])
      expect(screen.getByRole('menuitem', { name: /Visit website/ })).toHaveClass('md:hidden')
    })

    it('visitor who already follows: Message is the primary and Following is secondary', async () => {
      mocks.getFollowState.mockResolvedValue({ following: true, followerCount: 3 })
      const row = await renderRow()
      expectOneLine(row)
      expect(byEmphasis(row, 'primary')).toEqual(['message'])
      expect(byEmphasis(row, 'secondary')).toEqual(['follow', 'website'])
      expect(darkControls(row)).toHaveLength(1)
      expect(within(row).getByRole('button', { name: 'Message' })).toHaveClass('bg-navy-950')
      expect(within(row).getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('administrator: Manage page is the one primary, at most two secondary, the rest in the menu', async () => {
      mocks.getAccessContext.mockResolvedValue(access('administrator'))
      mocks.getViewer.mockResolvedValue({ kind: 'organization', role: 'administrator' })
      const row = await renderRow()
      expectOneLine(row)
      expect(byEmphasis(row, 'primary')).toEqual(['manage'])
      expect(byEmphasis(row, 'secondary')).toEqual(['follow', 'website'])
      expect(darkControls(row)).toHaveLength(1)
      expect(within(row).getByRole('link', { name: /Manage page/ })).toHaveClass('bg-navy-950')
      expect(within(row).getByRole('link', { name: /Manage page/ })).toHaveAttribute('href', '/organizations/harbour-minds/manage')
      expect(within(row).getByRole('button', { name: 'Follow' })).not.toHaveClass('bg-navy-950')
      // Everything else stays reachable from "…".
      expect(await menuLabels(row)).toEqual(['Visit website', 'Message', 'Create a community', 'Copy link', 'Share page', 'Upgrade to Organization Pro', 'Leave organization'])
    })

    it('never shows more than one primary and two secondary buttons for any role', async () => {
      for (const role of [null, 'member', 'recruiter', 'administrator', 'owner']) {
        mocks.getAccessContext.mockResolvedValue(access(role))
        mocks.getViewer.mockResolvedValue(role === 'owner' || role === 'administrator' ? { kind: 'organization', role } : null)
        const row = await renderRow()
        expect(byEmphasis(row, 'primary')).toHaveLength(1)
        expect(byEmphasis(row, 'secondary').length).toBeLessThanOrEqual(2)
        expect(darkControls(row).length).toBeLessThanOrEqual(1)
        expectOneLine(row)
        cleanup()
      }
    })
  })

  it('returns not found for an unknown organization', async () => {
    mocks.getBySlug.mockResolvedValue(null)
    await expect(OrganizationPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
