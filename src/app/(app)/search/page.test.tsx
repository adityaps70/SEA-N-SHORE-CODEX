import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSearchChip, resultItemClass, searchChipHref } from './search-filters'

const mocks = vi.hoisted(() => ({
  getNetworkHub: vi.fn(),
  searchCompanies: vi.fn(),
  getJobsDiscovery: vi.fn(),
  listPublishedCourses: vi.fn(),
  listDiscoverEvents: vi.fn(),
  searchHashtags: vi.fn(),
  searchGroups: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/features/network/actions', () => ({
  sendConnectionRequest: vi.fn(async () => ({ ok: true })),
  acceptConnectionRequest: vi.fn(async () => ({ ok: true })),
  cancelConnectionRequest: vi.fn(async () => ({ ok: true })),
  declineConnectionRequest: vi.fn(async () => ({ ok: true })),
  removeConnection: vi.fn(async () => ({ ok: true })),
  followProfile: vi.fn(async () => ({ ok: true })),
  unfollowProfile: vi.fn(async () => ({ ok: true })),
  blockProfile: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/features/moderation/components/report-content-button', () => ({ ReportContentButton: () => <div role="dialog" aria-label="Report profile" /> }))
vi.mock('@/features/messaging/actions', () => ({ startDirectConversationAction: vi.fn() }))
vi.mock('@/features/jobs/actions', () => ({ saveJob: vi.fn(), unsaveJob: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: vi.fn(async () => ({ id: 'viewer-1' })) }))
vi.mock('@/features/network/queries', () => ({ getNetworkHub: mocks.getNetworkHub }))
vi.mock('@/features/organizations/repository', () => ({ organizationRepository: { searchCompanies: mocks.searchCompanies } }))
vi.mock('@/features/jobs/queries', () => ({ getJobsDiscovery: mocks.getJobsDiscovery }))
vi.mock('@/features/learning/marketplace-repository', () => ({ marketplaceRepository: { listPublishedCourses: mocks.listPublishedCourses } }))
vi.mock('@/features/events/calendar-repository', () => ({ calendarEventRepository: { listDiscoverEvents: mocks.listDiscoverEvents } }))
vi.mock('@/features/hashtags/repository', () => ({ hashtagRepository: { searchHashtags: mocks.searchHashtags } }))
vi.mock('@/features/community/repository', () => ({ communityRepository: { searchGroups: mocks.searchGroups } }))
vi.mock('@/features/community/actions', () => ({ joinGroup: vi.fn(), leaveGroup: vi.fn() }))
vi.mock('@/features/network/components/network-profile-card', () => ({
  NetworkProfileCard: ({ profile, actions }: { profile: { fullName: string }; actions?: string }) => <article data-actions={actions}>Person {profile.fullName}</article>,
}))
vi.mock('@/features/jobs/components/job-card', () => ({
  JobCard: ({ job }: { job: { title: string } }) => <article>Job {job.title}</article>,
}))
vi.mock('@/features/events/components/event-card', () => ({
  EventCard: ({ event }: { event: { title: string } }) => <article>Event {event.title}</article>,
}))
vi.mock('./search-phone-bar', () => ({
  SearchPhoneBar: ({ query, chip }: { query: string; chip: string }) => (
    <div data-testid="search-phone-bar" data-query={query} data-chip={chip} />
  ),
}))

import GlobalSearchPage from './page'

const people = Array.from({ length: 5 }, (_, index) => ({ id: `person-${index}`, slug: `sailor-${index + 1}`, fullName: `Sailor ${index + 1}`, headline: null, avatarUrl: null, relationship: { following: false, connection: { kind: 'none', connectionId: null } } }))

beforeEach(() => {
  mocks.getNetworkHub.mockResolvedValue({ profiles: people })
  mocks.searchCompanies.mockResolvedValue([{ id: 'org-1', slug: 'sire-marine', name: 'SIRE Marine', verified: false, companyType: null, website: null }])
  mocks.getJobsDiscovery.mockResolvedValue({ items: [] })
  mocks.listPublishedCourses.mockResolvedValue([{ id: 'course-1', slug: 'sire-2', title: 'SIRE 2.0 Readiness', category: 'Vetting', accessType: 'free', priceMinor: 0, subtitle: null, mentorName: 'Aditya' }])
  mocks.listDiscoverEvents.mockResolvedValue([])
  mocks.searchHashtags.mockResolvedValue([{ tag: 'sire2', postCount: 3 }])
  mocks.searchGroups.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Global search on phones', () => {
  it('shows the chips (no Posts chip — posts are not searchable yet) and the result count', async () => {
    render(await GlobalSearchPage({ searchParams: Promise.resolve({ q: 'sire' }) }))

    const chips = screen.getByRole('navigation', { name: 'Search filters' })
    expect(chips).toHaveClass('md:hidden')
    const links = within(chips).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['All', 'People', 'Jobs', 'Organizations', 'Groups', 'Courses', 'Events', 'Hashtags'])
    expect(within(chips).getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page')
    expect(within(chips).getByRole('link', { name: 'People' })).toHaveAttribute('href', '/search?q=sire&type=people')

    expect(screen.getByTestId('search-result-count')).toHaveTextContent('8 results for “sire”')
    expect(screen.getByTestId('search-result-count')).toHaveClass('md:hidden')
    expect(screen.getByTestId('search-phone-bar')).toHaveAttribute('data-query', 'sire')
  })

  it('under All shows three people on phones and a See all row that switches to the People chip', async () => {
    render(await GlobalSearchPage({ searchParams: Promise.resolve({ q: 'sire' }) }))

    expect(screen.getByText('Person Sailor 3').parentElement).not.toHaveClass('max-md:hidden')
    expect(screen.getByText('Person Sailor 4').parentElement).toHaveClass('max-md:hidden')
    expect(screen.getByRole('link', { name: 'See all people results' })).toHaveAttribute('href', '/search?q=sire&type=people')
    // Organizations has one result, so no phone See all row.
    expect(screen.queryByRole('link', { name: 'See all organizations results' })).not.toBeInTheDocument()
    // Desktop keeps every section.
    expect(screen.getByRole('region', { name: /Courses/ })).not.toHaveClass('max-md:hidden')
  })

  it('a chip keeps only that vertical on phones, with its count', async () => {
    render(await GlobalSearchPage({ searchParams: Promise.resolve({ q: 'sire', type: 'people' }) }))

    const chips = screen.getByRole('navigation', { name: 'Search filters' })
    expect(within(chips).getByRole('link', { name: 'People' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('search-result-count')).toHaveTextContent('5 results for “sire”')
    expect(screen.getByRole('region', { name: /People/ })).not.toHaveClass('max-md:hidden')
    expect(screen.getByRole('region', { name: /Organizations/ })).toHaveClass('max-md:hidden')
    expect(screen.getByRole('region', { name: /Courses/ })).toHaveClass('max-md:hidden')
    expect(screen.getByText('Person Sailor 5').parentElement).not.toHaveClass('max-md:hidden')
    expect(screen.queryByRole('link', { name: 'See all people results' })).not.toBeInTheDocument()
  })

  it('lists people, organizations and courses as compact phone rows next to the desktop cards', async () => {
    mocks.getNetworkHub.mockResolvedValue({
      profiles: [
        { id: 'p1', slug: 'vikram-rao', fullName: 'Vikram Rao', headline: 'Master Mariner · SIRE inspector', avatarUrl: null, relationship: { following: false, connection: { kind: 'none', connectionId: null } } },
        { id: 'p2', slug: 'sana-iqbal', fullName: 'Sana Iqbal', headline: null, rank: 'Marine Superintendent', currentCompany: 'Oceanic', location: 'Chennai', avatarUrl: null, relationship: { following: true, connection: { kind: 'connected', connectionId: 'c2' } } },
      ],
    })
    render(await GlobalSearchPage({ searchParams: Promise.resolve({ q: 'sire' }) }))

    const people = screen.getByRole('list', { name: 'People results' })
    expect(people).toHaveClass('md:hidden')
    // The desktop grid of suggestion cards is hidden on phones.
    expect(screen.getByText('Person Vikram Rao').closest('.grid')).toHaveClass('max-md:hidden')
    const [vikram, sana] = within(people).getAllByRole('listitem')
    expect(within(vikram).getByRole('link', { name: 'Vikram Rao' })).toHaveAttribute('href', '/people/vikram-rao')
    expect(within(vikram).getByText('Master Mariner · SIRE inspector')).toBeInTheDocument()
    expect(within(vikram).getByRole('button', { name: 'Connect' })).toHaveClass('rounded-full', 'min-h-9')
    expect(within(vikram).queryByRole('button', { name: /Dismiss/ })).not.toBeInTheDocument()
    // The same actions as the network cards: a "…" with Follow, View profile, Report and Block.
    fireEvent.click(within(vikram).getByRole('button', { name: 'More actions for Vikram Rao' }))
    expect(screen.getByRole('menuitem', { name: 'Follow' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'View profile' })).toHaveAttribute('href', '/people/vikram-rao')
    expect(screen.getByRole('menuitem', { name: 'Report' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Block' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(within(sana).getByText('Marine Superintendent · Oceanic · Chennai')).toBeInTheDocument()
    expect(within(sana).getByRole('button', { name: 'Message' })).toHaveClass('rounded-full')
    // Desktop cards carry the full action set too.
    expect(screen.getByText('Person Vikram Rao').closest('article')).toHaveAttribute('data-actions', 'full')

    const organizations = screen.getByRole('list', { name: 'Organization results' })
    expect(within(organizations).getByRole('link', { name: /SIRE Marine/ })).toHaveAttribute('href', '/organizations/sire-marine')
    const courses = screen.getByRole('list', { name: 'Course results' })
    expect(within(courses).getByRole('link', { name: /SIRE 2.0 Readiness/ })).toHaveAttribute('href', '/learn/courses/sire-2')
    expect(within(courses).getByText('Aditya · Free')).toBeInTheDocument()
  })

  it('searches hashtags without the leading # and lists them as phone rows and desktop cards', async () => {
    mocks.searchHashtags.mockResolvedValue([{ tag: 'sire2', postCount: 3 }, { tag: 'sire_vetting', postCount: 1 }])
    render(await GlobalSearchPage({ searchParams: Promise.resolve({ q: '#sire', type: 'hashtags' }) }))

    expect(mocks.searchHashtags).toHaveBeenCalledWith('sire', 20)
    const chips = screen.getByRole('navigation', { name: 'Search filters' })
    expect(within(chips).getByRole('link', { name: 'Hashtags' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('search-result-count')).toHaveTextContent('2 results for “#sire”')
    expect(screen.getByRole('region', { name: /Hashtags/ })).not.toHaveClass('max-md:hidden')
    expect(screen.getByRole('region', { name: /People/ })).toHaveClass('max-md:hidden')

    const rows = screen.getByRole('list', { name: 'Hashtag results' })
    expect(rows).toHaveClass('md:hidden')
    const [first, second] = within(rows).getAllByRole('listitem')
    expect(within(first!).getByRole('link', { name: /#sire2/ })).toHaveAttribute('href', '/hashtags/sire2')
    expect(within(first!).getByText('3 posts')).toBeInTheDocument()
    expect(within(second!).getByText('1 post')).toBeInTheDocument()
    // Desktop cards link to the same page.
    expect(screen.getAllByRole('link', { name: /#sire_vetting/ }).every((link) => link.getAttribute('href') === '/hashtags/sire_vetting')).toBe(true)
  })

  it('shows a notice in the Hashtags section when that lookup fails, keeping the other results', async () => {
    mocks.searchHashtags.mockRejectedValue(new Error('down'))
    render(await GlobalSearchPage({ searchParams: Promise.resolve({ q: 'sire' }) }))

    expect(within(screen.getByRole('region', { name: /Hashtags/ })).getByRole('alert')).toHaveTextContent('Hashtags results could not be loaded just now.')
    expect(screen.getByRole('list', { name: 'Organization results' })).toBeInTheDocument()
    expect(screen.getByTestId('search-result-count')).toHaveTextContent('7 results for “sire”')
  })

  it('lists community groups (round 9B) with member count and visibility, as phone rows and desktop cards', async () => {
    mocks.searchGroups.mockResolvedValue([
      { id: 'g1', slug: 'tanker-professionals', name: 'Tanker Professionals', description: 'SIRE 2.0 and cargo operations.', icon: 'ShieldCheck', visibility: 'public', memberCount: 12, archived: false, createdBy: null, rules: '', coverUrl: null, viewerMembership: null },
      { id: 'g2', slug: 'sire-inspectors', name: 'SIRE Inspectors', description: '', icon: null, visibility: 'private', memberCount: 1, archived: false, createdBy: null, rules: '', coverUrl: null, viewerMembership: { role: 'member', status: 'active' } },
    ])
    render(await GlobalSearchPage({ searchParams: Promise.resolve({ q: 'sire', type: 'groups' }) }))

    expect(mocks.searchGroups).toHaveBeenCalledWith('viewer-1', 'sire', 20)
    const chips = screen.getByRole('navigation', { name: 'Search filters' })
    expect(within(chips).getByRole('link', { name: 'Groups' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('search-result-count')).toHaveTextContent('2 results for “sire”')
    expect(screen.getByRole('region', { name: /Groups/ })).not.toHaveClass('max-md:hidden')
    expect(screen.getByRole('region', { name: /Organizations/ })).toHaveClass('max-md:hidden')
    expect(screen.getByRole('link', { name: 'See all groups →' })).toHaveAttribute('href', '/community?q=sire')

    const rows = screen.getByRole('list', { name: 'Group results' })
    expect(rows).toHaveClass('md:hidden')
    const [tankers, inspectors] = within(rows).getAllByRole('listitem')
    expect(within(tankers!).getByRole('link', { name: /Tanker Professionals/ })).toHaveAttribute('href', '/community/tanker-professionals')
    expect(within(tankers!).getByText('12 members · SIRE 2.0 and cargo operations.')).toBeInTheDocument()
    expect(within(inspectors!).getByText('1 member')).toBeInTheDocument()
    expect(within(inspectors!).getByLabelText('Private group')).toBeInTheDocument()
    // Desktop cards carry the join button; a member sees "Joined".
    expect(screen.getByRole('button', { name: 'Join Tanker Professionals' })).toBeInTheDocument()
    expect(screen.getByLabelText('Joined SIRE Inspectors')).toBeInTheDocument()
  })

  it('renders the phone search bar before a query is typed', async () => {
    render(await GlobalSearchPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByTestId('search-phone-bar')).toHaveAttribute('data-query', '')
    expect(screen.queryByRole('navigation', { name: 'Search filters' })).not.toBeInTheDocument()
  })
})

describe('search filter helpers', () => {
  it('parses chips and builds chip links', () => {
    expect(parseSearchChip('jobs')).toBe('jobs')
    expect(parseSearchChip('posts')).toBe('all')
    expect(parseSearchChip(undefined)).toBe('all')
    expect(searchChipHref('sire 2.0', 'all')).toBe('/search?q=sire+2.0')
  })

  it('keeps desktop at six results per vertical', () => {
    expect(resultItemClass('people', 6)).toBe('md:hidden')
    expect(resultItemClass('all', 2)).toBeUndefined()
    expect(resultItemClass('all', 3)).toBe('max-md:hidden')
  })
})
