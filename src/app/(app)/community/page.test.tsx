import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityCategoryChip, CommunityCategoryRef, CommunityGroup } from '@/features/community/types'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  browseDirectory: vi.fn(),
  listDirectoryChips: vi.fn(),
  findBySlug: vi.fn(),
  listViewerGroups: vi.fn(),
  suggestGroups: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/community/repository', () => ({
  communityRepository: { browseDirectory: mocks.browseDirectory, listViewerGroups: mocks.listViewerGroups },
}))
vi.mock('@/features/community/category-repository', () => ({
  communityCategoryRepository: { listDirectoryChips: mocks.listDirectoryChips, findBySlug: mocks.findBySlug },
}))
vi.mock('@/features/community/service', () => ({ communityService: { suggestGroups: mocks.suggestGroups } }))
vi.mock('@/features/community/actions', () => ({ joinGroup: vi.fn(), leaveGroup: vi.fn() }))

import CommunityPage from './page'

// Round I (I2): admin-managed categories (the backfilled ones keep the old values as legacy keys).
const CATEGORIES: Array<CommunityCategoryRef & { legacyKey: string | null }> = [
  { id: 'c-news', slug: 'maritime-news', name: 'Maritime News', icon: 'Newspaper', hidden: false, legacyKey: 'maritime_news' },
  { id: 'c-vetting', slug: 'vetting-sire-2-0', name: 'Vetting & SIRE 2.0', icon: 'ShieldCheck', hidden: false, legacyKey: 'vetting_sire_2_0' },
  { id: 'c-safety', slug: 'safety-lessons', name: 'Safety Lessons', icon: 'LifeBuoy', hidden: false, legacyKey: 'safety_lessons' },
  { id: 'c-learning', slug: 'learning', name: 'Learning', icon: 'GraduationCap', hidden: false, legacyKey: 'learning' },
  { id: 'c-other', slug: 'other', name: 'Other', icon: 'UsersRound', hidden: false, legacyKey: 'other' },
]
const ref = (slug: string): CommunityCategoryRef => {
  const { id, name, icon, hidden } = CATEGORIES.find((entry) => entry.slug === slug)!
  return { id, slug, name, icon, hidden }
}
const chip = (slug: string, count: number): CommunityCategoryChip => ({ ...ref(slug), count })

function group(overrides: Partial<CommunityGroup> = {}): CommunityGroup {
  return {
    id: 'g-engineers', slug: 'marine-engineers', name: 'Marine Engineers', description: 'Technical conversations spanning machinery and maintenance.',
    rules: '', coverUrl: null, iconUrl: null, icon: 'Wrench', visibility: 'public', joinPolicy: 'open', ownerOrganization: null, memberCount: 42, archived: false, createdBy: null, viewerMembership: null, ...overrides,
  }
}

const tankers = group({ id: 'g-tankers', slug: 'tanker-professionals', name: 'Tanker Professionals', icon: 'ShieldCheck', memberCount: 7, description: 'Vetting, SIRE 2.0 and cargo operations.' })
// Round 9C: the join setting (not the visibility) decides the button label; this private group needs approval.
const masters = group({ id: 'g-masters', slug: 'masters-senior-officers', name: 'Masters & Senior Officers', icon: 'UsersRound', visibility: 'private', joinPolicy: 'approval', memberCount: 3 })

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1' })
  mocks.browseDirectory.mockResolvedValue({ groups: [group(), tankers, masters], total: 3 })
  mocks.listDirectoryChips.mockResolvedValue([chip('vetting-sire-2-0', 2), chip('safety-lessons', 1)])
  mocks.findBySlug.mockImplementation(async (value: string) => {
    const found = CATEGORIES.find((entry) => entry.slug === value || entry.legacyKey === value)
    return found ? ref(found.slug) : null
  })
  mocks.listViewerGroups.mockResolvedValue([])
  mocks.suggestGroups.mockResolvedValue([])
})

describe('/community landing (round 10, LinkedIn Groups style)', () => {
  it('does not list every community: shows Your communities, Suggested, categories and Popular this week', async () => {
    mocks.listViewerGroups.mockResolvedValue([
      group({ viewerMembership: { role: 'admin', status: 'active' }, recentPostCount: 3 }),
      { ...masters, viewerMembership: { role: 'member', status: 'pending' } },
    ])
    mocks.suggestGroups.mockResolvedValue([tankers])
    mocks.browseDirectory.mockResolvedValue({ groups: [tankers, group({ id: 'g-safety', slug: 'safety-lessons', name: 'Safety Lessons', category: ref('safety-lessons'), recentPostCount: 4 })], total: 2 })
    render(await CommunityPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { level: 1, name: 'Communities' })).toBeInTheDocument()
    expect(screen.getByText('Professional Communities')).toHaveClass('max-md:hidden')
    expect(mocks.browseDirectory).toHaveBeenCalledWith('viewer-1', { notJoined: true, sort: 'active', limit: 12 })
    expect(screen.queryByRole('list', { name: 'Communities' })).not.toBeInTheDocument()

    const mine = screen.getByRole('list', { name: 'Your communities' })
    expect(within(mine).getAllByRole('listitem')).toHaveLength(2)
    expect(within(mine).getByText('Moderator')).toBeInTheDocument()
    expect(within(mine).getByText('Pending')).toBeInTheDocument()
    expect(within(mine).getByText('42 members · 3 posts this week')).toBeInTheDocument()

    expect(mocks.suggestGroups).toHaveBeenCalledWith('viewer-1')
    const suggested = screen.getByRole('list', { name: 'Suggested communities' })
    expect(within(suggested).getByRole('link', { name: 'Tanker Professionals' })).toHaveAttribute('href', '/community/tanker-professionals')
    expect(within(suggested).getByRole('button', { name: 'Join Tanker Professionals' })).toBeInTheDocument()

    const categories = screen.getByRole('list', { name: 'Community categories' })
    // Round H (H7): only categories with communities get a tile. Round I (I2): in admin order, linked by slug.
    expect(within(categories).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Vetting & SIRE 2.02 communities', 'Safety Lessons1 community'])
    expect(within(categories).getByRole('link', { name: /Vetting & SIRE 2.0\s*2 communities/ })).toHaveAttribute('href', '/community?view=all&category=vetting-sire-2-0')
    expect(within(categories).queryByRole('link', { name: /Career Advice/ })).not.toBeInTheDocument()

    const popular = screen.getByRole('list', { name: 'Popular communities' })
    expect(within(popular).getByText('42 members · 4 posts this week')).toBeInTheDocument()
    expect(within(popular).getByRole('button', { name: 'Join Safety Lessons' })).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Browse all communities' })).toHaveAttribute('href', '/community?view=all')
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['Your communities', 'Suggested for you', 'Browse by category', 'Popular this week'])
  })

  it('never suggests a community the member already joined or asked to join', async () => {
    mocks.listViewerGroups.mockResolvedValue([{ ...tankers, viewerMembership: { role: 'member', status: 'active' } }])
    mocks.suggestGroups.mockResolvedValue([{ ...tankers, viewerMembership: { role: 'member', status: 'active' } }, masters])
    mocks.browseDirectory.mockResolvedValue({ groups: [], total: 0 })
    render(await CommunityPage({ searchParams: Promise.resolve({}) }))
    const suggested = screen.getByRole('list', { name: 'Suggested communities' })
    expect(within(suggested).queryByRole('link', { name: 'Tanker Professionals' })).not.toBeInTheDocument()
    expect(within(suggested).getByRole('button', { name: 'Request to join Masters & Senior Officers' })).toBeInTheDocument()
  })

  it('links to every one of the member\'s communities when there are more than six', async () => {
    mocks.listViewerGroups.mockResolvedValue(Array.from({ length: 8 }, (_, index) => group({ id: `g-${index}`, slug: `g-${index}`, name: `Group ${index}`, viewerMembership: { role: 'member', status: 'active' } })))
    render(await CommunityPage({ searchParams: Promise.resolve({}) }))
    expect(within(screen.getByRole('list', { name: 'Your communities' })).getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByRole('link', { name: 'See all 8' })).toHaveAttribute('href', '/community?view=mine')
  })

  it('always offers "Create a community" (round 9C): top right on desktop, full width on phones, pointing at /community/new', async () => {
    render(await CommunityPage({ searchParams: Promise.resolve({}) }))
    const create = screen.getByRole('link', { name: 'Create a community' })
    expect(create).toHaveAttribute('href', '/community/new')
    expect(create).toHaveClass('max-md:w-full', 'max-md:rounded-full')
    expect(create.closest('header')).toContainElement(screen.getByRole('searchbox', { name: 'Search communities' }))
    expect(screen.getByRole('heading', { level: 1 }).closest('header')).toHaveClass('md:justify-between')
  })

  it('shows the Other tile like any category, leaves out empty ones and hides the section when nothing is counted (round H, H7; round I, I2)', async () => {
    mocks.listDirectoryChips.mockResolvedValue([chip('maritime-news', 0), chip('learning', 1), chip('other', 2)])
    render(await CommunityPage({ searchParams: Promise.resolve({}) }))
    const categories = screen.getByRole('list', { name: 'Community categories' })
    expect(within(categories).getAllByRole('listitem')).toHaveLength(2)
    expect(within(categories).getByRole('link', { name: /Other\s*2 communities/ })).toHaveAttribute('href', '/community?view=all&category=other')
    expect(within(categories).queryByRole('link', { name: /Maritime News/ })).not.toBeInTheDocument()
    cleanup()

    mocks.listDirectoryChips.mockResolvedValue([])
    render(await CommunityPage({ searchParams: Promise.resolve({}) }))
    expect(screen.queryByRole('heading', { name: 'Browse by category' })).not.toBeInTheDocument()
  })

  it('counts joined communities and pending requests separately under Your communities (round H, H7)', async () => {
    mocks.listViewerGroups.mockResolvedValue([
      group({ viewerMembership: { role: 'member', status: 'active' } }),
      { ...tankers, viewerMembership: { role: 'member', status: 'active' } },
      { ...masters, viewerMembership: { role: 'member', status: 'pending' } },
    ])
    render(await CommunityPage({ searchParams: Promise.resolve({ view: 'mine' }) }))
    expect(screen.getByText('You belong to 2 communities · 1 request waiting for a moderator.')).toBeInTheDocument()
  })

  it('tells an empty platform that members create communities with Creator Pro or Organization Pro', async () => {
    mocks.browseDirectory.mockResolvedValue({ groups: [], total: 0 })
    render(await CommunityPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('No groups yet. Create the first community with Creator Pro or Organization Pro.')).toBeInTheDocument()
  })
})

describe('/community directory (Browse all / search)', () => {
  it('pages the full directory with category, join-setting and sort filters', async () => {
    mocks.browseDirectory.mockResolvedValue({ groups: [group(), tankers, masters], total: 50 })
    render(await CommunityPage({ searchParams: Promise.resolve({ view: 'all', category: 'vetting_sire_2_0', join: 'approval', sort: 'members', page: '2' }) }))

    // An old link with the fixed value still finds the category; the page then uses its slug.
    expect(mocks.findBySlug).toHaveBeenCalledWith('vetting_sire_2_0')
    expect(mocks.browseDirectory).toHaveBeenCalledWith('viewer-1', { search: '', category: 'vetting-sire-2-0', joinPolicy: 'approval', sort: 'members', limit: 24, offset: 24 })
    expect(screen.getByRole('heading', { level: 1, name: 'Browse communities' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Vetting & SIRE 2.0' })).toBeInTheDocument()
    expect(screen.getByText('50 communities · Page 2 of 3')).toBeInTheDocument()

    const list = screen.getByRole('list', { name: 'Communities' })
    expect(list).toHaveClass('md:grid-cols-2', 'xl:grid-cols-3')
    expect(within(list).getByText('Public · 42 members')).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Request to join Masters & Senior Officers' })).toBeInTheDocument()
    expect(within(list).getByLabelText('Private group')).toBeInTheDocument()

    const categories = screen.getByRole('navigation', { name: 'Filter by category' })
    expect(within(categories).getByRole('link', { name: 'Vetting & SIRE 2.0' })).toHaveAttribute('aria-current', 'true')
    expect(within(categories).getByRole('link', { name: 'All' })).toHaveAttribute('href', '/community?view=all&join=approval&sort=members')
    const join = screen.getByRole('navigation', { name: 'Filter by join setting' })
    expect(within(categories).getAllByRole('link').map((link) => link.textContent)).toEqual(['All', 'Vetting & SIRE 2.0', 'Safety Lessons'])
    expect(within(join).getByRole('link', { name: 'Open to join' })).toHaveAttribute('href', '/community?view=all&category=vetting-sire-2-0&join=open&sort=members')
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('members')

    const pages = screen.getByRole('navigation', { name: 'Community pages' })
    expect(within(pages).getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/community?view=all&category=vetting-sire-2-0&join=approval&sort=members')
    expect(within(pages).getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/community?view=all&category=vetting-sire-2-0&join=approval&sort=members&page=3')
    expect(mocks.suggestGroups).not.toHaveBeenCalled()
  })

  it('searches with ?q, keeps the category filter in the search form and hides the personal sections', async () => {
    mocks.browseDirectory.mockResolvedValue({ groups: [tankers], total: 1 })
    render(await CommunityPage({ searchParams: Promise.resolve({ q: 'tanker' }) }))

    expect(mocks.browseDirectory).toHaveBeenCalledWith('viewer-1', { search: 'tanker', category: null, joinPolicy: null, sort: 'active', limit: 24, offset: 0 })
    expect(mocks.suggestGroups).not.toHaveBeenCalled()
    expect(mocks.listViewerGroups).not.toHaveBeenCalled()
    expect(screen.getByRole('searchbox', { name: 'Search communities' })).toHaveValue('tanker')
    expect(screen.getByRole('heading', { name: 'Communities matching “tanker”' })).toBeInTheDocument()
    expect(screen.getByText('1 community')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Communities' })).toHaveAttribute('href', '/community')
  })

  it('filters the directory to the Other category (round H, H7; the backfill moved uncategorised communities there in round I)', async () => {
    mocks.listDirectoryChips.mockResolvedValue([chip('vetting-sire-2-0', 2), chip('other', 1)])
    mocks.browseDirectory.mockResolvedValue({ groups: [group({ category: ref('other') })], total: 1 })
    render(await CommunityPage({ searchParams: Promise.resolve({ view: 'all', category: 'other' }) }))
    expect(mocks.browseDirectory).toHaveBeenCalledWith('viewer-1', expect.objectContaining({ category: 'other' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Other' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Filter by category' })).getByRole('link', { name: 'Other' })).toHaveAttribute('aria-current', 'true')
  })

  it('shows the directory chips in the admin order the repository returns (round I, I2)', async () => {
    mocks.listDirectoryChips.mockResolvedValue([chip('safety-lessons', 1), chip('learning', 4), chip('vetting-sire-2-0', 2)])
    render(await CommunityPage({ searchParams: Promise.resolve({ view: 'all' }) }))
    const categories = screen.getByRole('navigation', { name: 'Filter by category' })
    expect(within(categories).getAllByRole('link').map((link) => link.textContent)).toEqual(['All', 'Safety Lessons', 'Learning', 'Vetting & SIRE 2.0'])
  })

  it('ignores an unknown category or sort', async () => {
    render(await CommunityPage({ searchParams: Promise.resolve({ view: 'all', category: 'gossip', sort: 'random' }) }))
    expect(mocks.browseDirectory).toHaveBeenCalledWith('viewer-1', expect.objectContaining({ category: null, sort: 'active' }))
  })

  it('labels the join button by the join setting, not the visibility, and names an owning organization', async () => {
    mocks.browseDirectory.mockResolvedValue({ groups: [
      group({ id: 'g-open-private', slug: 'open-private', name: 'Open Private', visibility: 'private', joinPolicy: 'open' }),
      group({ id: 'g-approval-public', slug: 'approval-public', name: 'Approval Public', joinPolicy: 'approval', ownerOrganization: { id: 'c1', slug: 'harbour-minds', name: 'Harbour Minds' } }),
    ], total: 2 })
    render(await CommunityPage({ searchParams: Promise.resolve({ view: 'all' }) }))
    expect(screen.getByRole('button', { name: 'Join Open Private' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request to join Approval Public' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Harbour Minds' })).toHaveAttribute('href', '/organizations/harbour-minds')
    expect(screen.getByText(/Public · 42 members · By/)).toBeInTheDocument()
  })

  it('explains an empty search', async () => {
    mocks.browseDirectory.mockResolvedValue({ groups: [], total: 0 })
    render(await CommunityPage({ searchParams: Promise.resolve({ q: 'zzz' }) }))
    expect(screen.getByText('No groups match “zzz”. Try another word or browse all groups.')).toBeInTheDocument()
  })
})

describe('/community?view=mine', () => {
  it('shows every community the member belongs to, with Pending requests', async () => {
    mocks.listViewerGroups.mockResolvedValue([
      group({ viewerMembership: { role: 'admin', status: 'active' } }),
      { ...masters, viewerMembership: { role: 'member', status: 'pending' } },
    ])
    render(await CommunityPage({ searchParams: Promise.resolve({ view: 'mine' }) }))
    const mine = screen.getByRole('list', { name: 'Your communities' })
    expect(within(mine).getAllByRole('listitem')).toHaveLength(2)
    expect(within(mine).getByText('Pending', { selector: 'span.rounded-md' })).toBeInTheDocument()
    expect(within(mine).getByRole('button', { name: 'Pending: withdraw your request to join Masters & Senior Officers' })).toBeInTheDocument()
    expect(within(mine).getByLabelText('Joined Marine Engineers')).toBeInTheDocument()
    expect(mocks.browseDirectory).not.toHaveBeenCalled()
  })
})
