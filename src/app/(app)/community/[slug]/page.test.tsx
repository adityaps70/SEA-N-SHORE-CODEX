import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityGroup, GroupMember } from '@/features/community/types'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getBySlug: vi.fn(),
  listMembers: vi.fn(),
  listPendingRequests: vi.fn(),
  getFeedPage: vi.fn(),
  getOwnProfile: vi.fn(),
  createMediaReadUrl: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/community/tanker-professionals',
}))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/community/repository', () => ({
  communityRepository: { getBySlug: mocks.getBySlug, listMembers: mocks.listMembers, listPendingRequests: mocks.listPendingRequests },
}))
vi.mock('@/features/community/actions', () => ({
  joinGroup: vi.fn(), leaveGroup: vi.fn(), approveJoinRequest: vi.fn(), declineJoinRequest: vi.fn(), removeMember: vi.fn(), setMemberRole: vi.fn(), updateGroup: vi.fn(),
}))
vi.mock('@/features/feed/queries', () => ({ getFeedPage: mocks.getFeedPage }))
vi.mock('@/features/profiles/queries', () => ({ getOwnProfile: mocks.getOwnProfile }))
vi.mock('@/lib/aws/storage', () => ({ createMediaReadUrl: mocks.createMediaReadUrl }))
vi.mock('@/features/feed/components/feed-list', () => ({
  FeedList: ({ scope, initialPage }: { scope?: { groupId?: string }; initialPage: { posts: unknown[] } }) => (
    <div data-testid="feed-list" data-group={scope?.groupId} data-count={initialPage.posts.length} />
  ),
}))
vi.mock('@/features/feed/components/post-composer', () => ({
  PostComposer: ({ group }: { group?: { id: string; name: string } }) => <div data-testid="post-composer" data-group={group?.id} data-group-name={group?.name} />,
}))
vi.mock('@/features/moderation/components/report-content-button', () => ({
  ReportContentButton: ({ targetType, targetId }: { targetType: string; targetId: string }) => <div role="dialog" aria-label={`Report ${targetType} ${targetId}`} />,
}))

import CommunityGroupPage from './page'

function group(overrides: Partial<CommunityGroup> = {}): CommunityGroup {
  return {
    id: '22222222-2222-4222-8222-222222222222', slug: 'tanker-professionals', name: 'Tanker Professionals',
    description: 'Operational discussion around tanker practice.', rules: 'Keep it professional.', coverUrl: null, icon: 'ShieldCheck',
    visibility: 'public', memberCount: 12, archived: false, createdBy: 'owner-1', viewerMembership: null, ...overrides,
  }
}

function member(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    profileId: 'owner-1', slug: 'asha-singh', fullName: 'Asha Singh', headline: 'Master Mariner', avatarPath: null,
    role: 'owner', status: 'active', requestedAt: '2026-09-01T00:00:00.000Z', joinedAt: '2026-09-01T00:00:00.000Z', ...overrides,
  }
}

const params = Promise.resolve({ slug: 'tanker-professionals' })
const search = (value: Record<string, string>) => Promise.resolve(value)

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1' })
  mocks.getBySlug.mockResolvedValue(group())
  mocks.listMembers.mockResolvedValue([member()])
  mocks.listPendingRequests.mockResolvedValue([])
  mocks.getFeedPage.mockResolvedValue({ posts: [], nextCursor: null })
  mocks.getOwnProfile.mockResolvedValue({ id: 'viewer-1', fullName: 'Viewer', avatarUrl: null, rank: null, headline: null })
  mocks.createMediaReadUrl.mockResolvedValue('https://cdn.example/avatar.jpg')
})

describe('/community/[slug]', () => {
  it('renders the cover, icon, name, visibility, member count, join button, menu and tabs; About is the default for non-members', async () => {
    render(await CommunityGroupPage({ params, searchParams: search({}) }))

    expect(mocks.getBySlug).toHaveBeenCalledWith('viewer-1', 'tanker-professionals')
    expect(screen.getByRole('heading', { level: 1, name: 'Tanker Professionals' })).toBeInTheDocument()
    expect(screen.getByText('Public group')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '12 members' })).toHaveAttribute('href', '/community/tanker-professionals?tab=members')
    expect(screen.getByRole('button', { name: 'Join Tanker Professionals' })).toBeInTheDocument()

    const tabs = screen.getByRole('navigation', { name: 'Tanker Professionals sections' })
    expect(within(tabs).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['About', '/community/tanker-professionals?tab=about'],
      ['Posts', '/community/tanker-professionals?tab=posts'],
      ['Members', '/community/tanker-professionals?tab=members'],
    ])
    expect(within(tabs).getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Operational discussion around tanker practice.')).toBeInTheDocument()
    expect(screen.getByText('Keep it professional.')).toBeInTheDocument()
    expect(mocks.listMembers).toHaveBeenCalledWith(group().id, { adminsOnly: true, limit: 20 })
    const admins = screen.getByRole('list', { name: 'Members' })
    expect(within(admins).getByRole('link', { name: 'Asha Singh' })).toHaveAttribute('href', '/people/asha-singh')
    expect(within(admins).getByText('Owner')).toBeInTheDocument()

    // The "…" menu: Copy link and Report group; no Edit group for non-admins.
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Tanker Professionals' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual(['Copy link', 'Report group'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Report group' }))
    expect(screen.getByRole('dialog', { name: `Report group ${group().id}` })).toBeInTheDocument()
  })

  it('gives phones a page bar back to /community and flush sections', async () => {
    render(await CommunityGroupPage({ params, searchParams: search({}) }))
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/community')
    expect(screen.getByRole('link', { name: 'Back' }).parentElement).toHaveClass('md:hidden')
    expect(screen.getByRole('heading', { level: 1 }).closest('section')).toHaveClass('max-md:-mx-4', 'max-md:rounded-none')
  })

  it('opens Posts by default for members, with the composer scoped to the group and the group feed', async () => {
    mocks.getBySlug.mockResolvedValue(group({ viewerMembership: { role: 'member', status: 'active' } }))
    mocks.getFeedPage.mockResolvedValue({ posts: [{ id: 'p1', updatedAt: 'x' }], nextCursor: null })
    render(await CommunityGroupPage({ params, searchParams: search({}) }))

    expect(mocks.getFeedPage).toHaveBeenCalledWith({ groupId: group().id })
    expect(screen.getByTestId('post-composer')).toHaveAttribute('data-group', group().id)
    expect(screen.getByTestId('post-composer')).toHaveAttribute('data-group-name', 'Tanker Professionals')
    expect(screen.getByTestId('feed-list')).toHaveAttribute('data-group', group().id)
    expect(screen.getByRole('button', { name: 'Leave group' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Tanker Professionals sections' })).getByRole('link', { name: 'Posts' })).toHaveAttribute('aria-current', 'page')
  })

  it('lets non-members read a public group’s posts without a composer', async () => {
    render(await CommunityGroupPage({ params, searchParams: search({ tab: 'posts' }) }))
    expect(screen.queryByTestId('post-composer')).not.toBeInTheDocument()
    expect(screen.getByText(/Join Tanker Professionals to post here/)).toBeInTheDocument()
    expect(screen.getByText('No posts in Tanker Professionals yet')).toBeInTheDocument()
  })

  it('hides posts and members of a private group behind "Join to see" until the viewer is an active member', async () => {
    mocks.getBySlug.mockResolvedValue(group({ visibility: 'private', viewerMembership: { role: 'member', status: 'pending' } }))
    render(await CommunityGroupPage({ params, searchParams: search({ tab: 'posts' }) }))
    expect(mocks.getFeedPage).not.toHaveBeenCalled()
    expect(screen.getByText('Join to see posts')).toBeInTheDocument()
    expect(screen.getByText('Private group')).toBeInTheDocument()
    expect(screen.getByText('Request pending')).toBeInTheDocument()
    cleanup()

    render(await CommunityGroupPage({ params, searchParams: search({ tab: 'members' }) }))
    expect(mocks.listMembers).not.toHaveBeenCalled()
    expect(screen.getByText('Join to see members')).toBeInTheDocument()
  })

  it('shows members with search, admin actions and the join requests panel for admins of a private group', async () => {
    mocks.getBySlug.mockResolvedValue(group({ visibility: 'private', viewerMembership: { role: 'admin', status: 'active' } }))
    mocks.listMembers.mockResolvedValue([
      member(),
      member({ profileId: 'viewer-1', slug: 'viewer', fullName: 'Viewer', role: 'admin' }),
      member({ profileId: 'm-3', slug: 'ravi', fullName: 'Ravi Kumar', headline: 'Chief Officer', role: 'member', avatarPath: 'profiles/ravi.jpg' }),
    ])
    mocks.listPendingRequests.mockResolvedValue([member({ profileId: 'req-1', slug: 'neha', fullName: 'Neha Rao', role: 'member', status: 'pending' })])
    render(await CommunityGroupPage({ params, searchParams: search({ tab: 'members', q: 'ra', requests: '1' }) }))

    expect(mocks.listMembers).toHaveBeenCalledWith(group().id, { search: 'ra' })
    expect(mocks.createMediaReadUrl).toHaveBeenCalledWith('profiles/ravi.jpg')
    expect(screen.getByRole('searchbox', { name: 'Search members' })).toHaveValue('ra')
    expect(screen.getByRole('heading', { name: 'Join requests (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve Neha Rao' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline Neha Rao' })).toBeInTheDocument()

    const members = screen.getByRole('list', { name: 'Members' })
    const rows = within(members).getAllByRole('listitem')
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual(['Asha Singh', 'Viewer', 'Ravi Kumar'])
    // No actions on the owner or on yourself; other members get Make admin / Remove.
    expect(within(rows[0]!).queryByRole('button')).not.toBeInTheDocument()
    expect(within(rows[1]!).queryByRole('button')).not.toBeInTheDocument()
    fireEvent.click(within(rows[2]!).getByRole('button', { name: 'Actions for Ravi Kumar' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual(['Make admin', 'Remove from group'])

    // Admins get Edit group in the "…" menu, linking to the About tab in edit mode.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Tanker Professionals' }))
    expect(screen.getByRole('menuitem', { name: 'Edit group' })).toHaveAttribute('href', '/community/tanker-professionals?tab=about&edit=1')
  })

  it('shows the edit form on the About tab for admins with ?edit=1', async () => {
    mocks.getBySlug.mockResolvedValue(group({ viewerMembership: { role: 'owner', status: 'active' } }))
    render(await CommunityGroupPage({ params, searchParams: search({ tab: 'about', edit: '1' }) }))
    const form = screen.getByRole('form', { name: 'Edit Tanker Professionals' })
    expect(within(form).getByLabelText('Rules')).toHaveValue('Keep it professional.')
    expect(within(form).getByLabelText('Visibility')).toHaveValue('public')
    // The header shows the viewer's own role instead of Leave; the admins list shows the Owner chip.
    expect(screen.getAllByText('Owner')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Leave group' })).not.toBeInTheDocument()
  })

  it('returns not found for unknown or archived groups', async () => {
    mocks.getBySlug.mockResolvedValue(null)
    await expect(CommunityGroupPage({ params, searchParams: search({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    mocks.getBySlug.mockResolvedValue(group({ archived: true }))
    await expect(CommunityGroupPage({ params, searchParams: search({}) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
