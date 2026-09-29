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
  canAccessPlatformAdmin: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('@/features/admin/access', () => ({ canAccessPlatformAdmin: mocks.canAccessPlatformAdmin }))
vi.mock('@/features/community/media-actions', () => ({
  uploadCommunityCoverAction: vi.fn(), uploadCommunityIconAction: vi.fn(), removeCommunityCoverAction: vi.fn(), removeCommunityIconAction: vi.fn(),
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
  joinGroup: vi.fn(), leaveGroup: vi.fn(), approveJoinRequest: vi.fn(), declineJoinRequest: vi.fn(), approveAllPending: vi.fn(), removeMember: vi.fn(), setMemberRole: vi.fn(), transferOwnership: vi.fn(), updateGroup: vi.fn(),
}))
vi.mock('@/features/feed/queries', () => ({ getFeedPage: mocks.getFeedPage }))
vi.mock('@/features/profiles/queries', () => ({ getOwnProfile: mocks.getOwnProfile }))
vi.mock('@/lib/aws/storage', () => ({ createMediaReadUrl: mocks.createMediaReadUrl }))
vi.mock('@/features/feed/components/feed-list', () => ({
  FeedList: ({ scope, initialPage, roleBadges }: { scope?: { groupId?: string }; initialPage: { posts: unknown[] }; roleBadges?: Record<string, string> }) => (
    <div data-testid="feed-list" data-group={scope?.groupId} data-count={initialPage.posts.length} data-role-badges={JSON.stringify(roleBadges ?? null)} />
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
    description: 'Operational discussion around tanker practice.', rules: 'Keep it professional.', coverUrl: null, iconUrl: null, icon: 'ShieldCheck', joinPolicy: 'open', ownerOrganization: null,
    visibility: 'public', memberCount: 12, archived: false, createdBy: 'owner-1', viewerMembership: null, ...overrides,
  }
}

function member(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    profileId: 'owner-1', slug: 'asha-singh', fullName: 'Asha Singh', headline: 'Master Mariner', avatarPath: null,
    role: 'owner', status: 'active', requestedAt: '2026-09-01T00:00:00.000Z', joinedAt: '2026-09-01T00:00:00.000Z', isPlatformAdmin: false, ...overrides,
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
  mocks.canAccessPlatformAdmin.mockResolvedValue(false)
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

    // Round 9C: the pending list carries "Approve all pending".
    expect(screen.getByRole('button', { name: 'Approve all pending' })).toBeInTheDocument()

    const members = screen.getByRole('list', { name: 'Members' })
    const rows = within(members).getAllByRole('listitem')
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual(['Asha Singh', 'Viewer', 'Ravi Kumar'])
    // Stored role 'admin' is shown as Moderator (round 9C).
    expect(within(rows[1]!).getByText('Moderator')).toBeInTheDocument()
    // No actions on the owner or on yourself; other members get Make moderator / Remove (no Transfer ownership for a moderator).
    expect(within(rows[0]!).queryByRole('button')).not.toBeInTheDocument()
    expect(within(rows[1]!).queryByRole('button')).not.toBeInTheDocument()
    fireEvent.click(within(rows[2]!).getByRole('button', { name: 'Actions for Ravi Kumar' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual(['Make moderator', 'Remove from group'])

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

  it('shows the banner and photo with change/remove controls to moderators and platform admins only (round 9C)', async () => {
    // A plain member (or visitor) sees the images but no controls.
    mocks.getBySlug.mockResolvedValue(group({ coverUrl: '/api/community-media/g/cover?v=c.jpg', iconUrl: '/api/community-media/g/icon?v=i.webp', viewerMembership: { role: 'member', status: 'active' } }))
    const { container } = render(await CommunityGroupPage({ params, searchParams: search({}) }))
    expect(mocks.canAccessPlatformAdmin).toHaveBeenCalledWith('viewer-1')
    expect(container.querySelector('img[alt="Tanker Professionals cover image"]')).toHaveAttribute('src', '/api/community-media/g/cover?v=c.jpg')
    expect(screen.getByTestId('group-icon-tile').querySelector('img')).toHaveAttribute('src', '/api/community-media/g/icon?v=i.webp')
    expect(screen.queryByRole('button', { name: /community banner/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /community photo/ })).not.toBeInTheDocument()
    cleanup()

    // A moderator (stored role admin) gets Change + Remove for both images.
    mocks.getBySlug.mockResolvedValue(group({ coverUrl: '/api/community-media/g/cover?v=c.jpg', iconUrl: null, viewerMembership: { role: 'admin', status: 'active' } }))
    render(await CommunityGroupPage({ params, searchParams: search({}) }))
    expect(screen.getByRole('button', { name: 'Change community banner' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove community banner' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add community photo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove community photo' })).not.toBeInTheDocument()
    cleanup()

    // A platform administrator who is not a member gets them too.
    mocks.canAccessPlatformAdmin.mockResolvedValue(true)
    mocks.getBySlug.mockResolvedValue(group())
    render(await CommunityGroupPage({ params, searchParams: search({}) }))
    expect(screen.getByRole('button', { name: 'Add community banner' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add community photo' })).toBeInTheDocument()
  })

  it('labels the join button by the join setting and shows it on the About tab, with "By <organization>" for organization-owned communities (round 9C)', async () => {
    mocks.getBySlug.mockResolvedValue(group({ joinPolicy: 'approval', ownerOrganization: { id: 'c1', slug: 'harbour-minds', name: 'Harbour Minds' } }))
    render(await CommunityGroupPage({ params, searchParams: search({}) }))
    expect(screen.getByRole('button', { name: 'Request to join Tanker Professionals' })).toBeInTheDocument()
    expect(screen.getByText('Approval required — a moderator approves join requests.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Harbour Minds' })).toHaveAttribute('href', '/organizations/harbour-minds')
    expect(screen.getByRole('heading', { name: 'Moderators' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Admins' })).not.toBeInTheDocument()
    cleanup()

    // A private group that is open to join says Join, and "Join to see" no longer mentions approval.
    mocks.getBySlug.mockResolvedValue(group({ visibility: 'private', joinPolicy: 'open' }))
    render(await CommunityGroupPage({ params, searchParams: search({ tab: 'posts' }) }))
    // Header button plus the one inside "Join to see posts".
    expect(screen.getAllByRole('button', { name: 'Join Tanker Professionals' })).toHaveLength(2)
    expect(screen.getByText(/visible to members once you join/)).toBeInTheDocument()
  })

  it('keeps waiting requests visible to moderators of an open group until they are approved, and hides the panel when there are none', async () => {
    mocks.getBySlug.mockResolvedValue(group({ joinPolicy: 'open', viewerMembership: { role: 'owner', status: 'active' } }))
    mocks.listPendingRequests.mockResolvedValue([member({ profileId: 'req-1', slug: 'neha', fullName: 'Neha Rao', role: 'member', status: 'pending' })])
    render(await CommunityGroupPage({ params, searchParams: search({ tab: 'members' }) }))
    expect(mocks.listPendingRequests).toHaveBeenCalledWith(group().id)
    expect(screen.getByRole('heading', { name: 'Join requests (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve all pending' })).toBeInTheDocument()
    cleanup()

    mocks.listPendingRequests.mockResolvedValue([])
    render(await CommunityGroupPage({ params, searchParams: search({ tab: 'members' }) }))
    expect(screen.queryByRole('heading', { name: /Join requests/ })).not.toBeInTheDocument()
    cleanup()

    // Approval-required groups always show the panel to moderators, even when empty.
    mocks.getBySlug.mockResolvedValue(group({ joinPolicy: 'approval', viewerMembership: { role: 'admin', status: 'active' } }))
    render(await CommunityGroupPage({ params, searchParams: search({ tab: 'members' }) }))
    expect(screen.getByRole('heading', { name: 'Join requests' })).toBeInTheDocument()
    expect(screen.getByText('No join requests waiting.')).toBeInTheDocument()
  })

  it('passes the owner and moderators to the feed as role badges on the Posts tab', async () => {
    mocks.getBySlug.mockResolvedValue(group({ viewerMembership: { role: 'member', status: 'active' } }))
    mocks.getFeedPage.mockResolvedValue({ posts: [{ id: 'p1', updatedAt: 'x' }], nextCursor: null })
    mocks.listMembers.mockResolvedValue([member(), member({ profileId: 'mod-1', slug: 'ravi', fullName: 'Ravi Kumar', role: 'admin' })])
    render(await CommunityGroupPage({ params, searchParams: search({ tab: 'posts' }) }))
    expect(mocks.listMembers).toHaveBeenCalledWith(group().id, { adminsOnly: true, limit: 200 })
    expect(screen.getByTestId('feed-list')).toHaveAttribute('data-role-badges', JSON.stringify({ 'owner-1': 'Owner', 'mod-1': 'Moderator' }))
  })

  it('gives the owner "Transfer ownership" on other members and shows the Sea N Shore admin chip', async () => {
    mocks.getBySlug.mockResolvedValue(group({ viewerMembership: { role: 'owner', status: 'active' } }))
    mocks.requireAwsUser.mockResolvedValue({ id: 'owner-1' })
    mocks.listMembers.mockResolvedValue([
      member(),
      member({ profileId: 'sn-1', slug: 'sn-admin', fullName: 'Sea Admin', role: 'member', isPlatformAdmin: true }),
    ])
    render(await CommunityGroupPage({ params, searchParams: search({ tab: 'members' }) }))
    const rows = within(screen.getByRole('list', { name: 'Members' })).getAllByRole('listitem')
    expect(within(rows[1]!).getByText('Sea N Shore admin')).toBeInTheDocument()
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Actions for Sea Admin' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual(['Make moderator', 'Transfer ownership', 'Remove from group'])
  })

  it('gives Sea N Shore administrators the moderator controls without a membership: requests, member actions, Edit group and private content', async () => {
    mocks.canAccessPlatformAdmin.mockResolvedValue(true)
    mocks.getBySlug.mockResolvedValue(group({ visibility: 'private', joinPolicy: 'approval' }))
    mocks.listMembers.mockResolvedValue([member(), member({ profileId: 'm-3', slug: 'ravi', fullName: 'Ravi Kumar', role: 'member' })])
    render(await CommunityGroupPage({ params, searchParams: search({ tab: 'members' }) }))
    expect(mocks.listMembers).toHaveBeenCalledWith(group().id, { search: '' })
    expect(screen.getByRole('heading', { name: 'Join requests' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actions for Ravi Kumar' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Tanker Professionals' }))
    expect(screen.getByRole('menuitem', { name: 'Edit group' })).toBeInTheDocument()
    // Still not a member: the header offers Request to join, not Leave.
    expect(screen.getByRole('button', { name: 'Request to join Tanker Professionals' })).toBeInTheDocument()
  })

  it('returns not found for unknown or archived groups', async () => {
    mocks.getBySlug.mockResolvedValue(null)
    await expect(CommunityGroupPage({ params, searchParams: search({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    mocks.getBySlug.mockResolvedValue(group({ archived: true }))
    await expect(CommunityGroupPage({ params, searchParams: search({}) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
