import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminCommunityGroup } from '@/features/community/types'

const mocks = vi.hoisted(() => ({
  listAdminGroups: vi.fn(),
}))

vi.mock('@/features/community/repository', () => ({ communityRepository: { listAdminGroups: mocks.listAdminGroups } }))
vi.mock('@/features/community/admin-actions', () => ({
  createGroupAsAdmin: vi.fn(),
  updateGroupAsAdmin: vi.fn(),
  setGroupOwnerAsAdmin: vi.fn(),
  archiveGroupAsAdmin: vi.fn(),
  unarchiveGroupAsAdmin: vi.fn(),
}))

import AdminCommunitiesPage from './page'

function group(overrides: Partial<AdminCommunityGroup> = {}): AdminCommunityGroup {
  return {
    id: '22222222-2222-4222-8222-222222222222', slug: 'tanker-professionals', name: 'Tanker Professionals', description: 'Tankers.', rules: 'Be kind.',
    icon: 'ShieldCheck', iconUrl: null, visibility: 'public', joinPolicy: 'open', memberCount: 12, pendingCount: 0, ownerOrganization: null,
    owner: { id: '33333333-3333-4333-8333-333333333333', fullName: 'Asha Singh', slug: 'asha-singh' },
    archivedAt: null, createdAt: '2026-09-11T10:00:00.000Z', ...overrides,
  }
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listAdminGroups.mockResolvedValue([
    group(),
    group({ id: '44444444-4444-4444-8444-444444444444', slug: 'old-hands', name: 'Old Hands', visibility: 'private', memberCount: 2, pendingCount: 1, owner: null, archivedAt: '2026-09-20T00:00:00.000Z' }),
  ])
})

describe('/admin/communities', () => {
  it('lists every group with visibility, members, owner, state and created date, plus edit and archive actions', async () => {
    render(await AdminCommunitiesPage({ searchParams: Promise.resolve({}) }))

    expect(mocks.listAdminGroups).toHaveBeenCalledWith({ search: '', archived: 'all' })
    expect(screen.getByRole('heading', { name: 'Communities' })).toBeInTheDocument()
    expect(screen.getByText('2 groups')).toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(table.parentElement).toHaveClass('max-md:hidden')
    const [tankers, oldHands] = within(table).getAllByRole('row').slice(1)
    expect(within(tankers!).getByRole('link', { name: 'Tanker Professionals' })).toHaveAttribute('href', '/community/tanker-professionals')
    expect(within(tankers!).getByText('Public')).toBeInTheDocument()
    expect(within(tankers!).getByText('12')).toBeInTheDocument()
    expect(within(tankers!).getByRole('link', { name: 'Asha Singh' })).toHaveAttribute('href', '/admin/users/33333333-3333-4333-8333-333333333333')
    expect(within(tankers!).getByText('Live')).toBeInTheDocument()
    expect(within(tankers!).getByText('11 Sept 2026')).toBeInTheDocument()
    expect(within(tankers!).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/admin/communities?edit=22222222-2222-4222-8222-222222222222#edit-group')
    expect(within(tankers!).getByRole('button', { name: 'Archive Tanker Professionals' })).toBeInTheDocument()
    expect(within(oldHands!).getByText('Private')).toBeInTheDocument()
    expect(within(oldHands!).getByText('No owner')).toBeInTheDocument()
    expect(within(oldHands!).getByText('Archived')).toBeInTheDocument()
    expect(within(oldHands!).getByText('+1')).toBeInTheDocument()
    expect(within(oldHands!).getByRole('button', { name: 'Restore Old Hands' })).toBeInTheDocument()

    // Phones: the same rows as cards.
    const cards = screen.getByRole('list', { name: 'Groups' })
    expect(cards).toHaveClass('md:hidden')
    expect(within(cards).getAllByRole('listitem')).toHaveLength(2)
    expect(within(cards).getByText('2 (+1 waiting)')).toBeInTheDocument()

    // Create form is always available.
    const create = screen.getByRole('form', { name: 'Create group' })
    expect(within(create).getByLabelText(/Owner/)).toBeInTheDocument()
    expect(within(create).getByLabelText('Icon')).toContainHTML('BadgeQuestionMark')
    expect(within(create).getByRole('button', { name: 'Create group' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: /^Edit / })).not.toBeInTheDocument()
  })

  it('filters and searches through the query string', async () => {
    render(await AdminCommunitiesPage({ searchParams: Promise.resolve({ status: 'archived', q: 'old' }) }))
    expect(mocks.listAdminGroups).toHaveBeenCalledWith({ search: 'old', archived: 'archived' })
    const filters = screen.getByRole('navigation', { name: 'Group filters' })
    expect(within(filters).getByRole('link', { name: 'Archived' })).toHaveAttribute('aria-current', 'true')
    expect(within(filters).getByRole('link', { name: 'Live' })).toHaveAttribute('href', '/admin/communities?q=old&status=live')
    expect(screen.getByRole('searchbox', { name: 'Search groups' })).toHaveValue('old')
  })

  it('opens the edit, owner and archive panel for ?edit=<id> and for the moderation ?group=<id> link', async () => {
    render(await AdminCommunitiesPage({ searchParams: Promise.resolve({ group: '22222222-2222-4222-8222-222222222222' }) }))
    const edit = screen.getByRole('form', { name: 'Edit Tanker Professionals' })
    expect(within(edit).getByLabelText('Name')).toHaveValue('Tanker Professionals')
    expect(within(edit).getByLabelText('Rules')).toHaveValue('Be kind.')
    expect(within(edit).queryByLabelText(/Owner/)).not.toBeInTheDocument()
    const owner = screen.getByRole('form', { name: 'Change owner of Tanker Professionals' })
    expect(within(owner).getByText('Current owner: Asha Singh. They stay in the group as a moderator.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Archive Tanker Professionals' })).toHaveLength(2)
  })

  it('shows an empty state and a note when the group to edit is not in the view', async () => {
    mocks.listAdminGroups.mockResolvedValue([])
    render(await AdminCommunitiesPage({ searchParams: Promise.resolve({ edit: 'missing', created: 'new-group' }) }))
    expect(screen.getByText('No groups match this view.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('That group is not in this view.')
    expect(screen.getByRole('link', { name: 'Open its page' })).toHaveAttribute('href', '/community/new-group')
  })
})
