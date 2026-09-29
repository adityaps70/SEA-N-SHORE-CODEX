import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityGroup } from '@/features/community/types'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listDirectory: vi.fn(),
  listViewerGroups: vi.fn(),
  suggestGroups: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/community/repository', () => ({
  communityRepository: { listDirectory: mocks.listDirectory, listViewerGroups: mocks.listViewerGroups },
}))
vi.mock('@/features/community/service', () => ({ communityService: { suggestGroups: mocks.suggestGroups } }))
vi.mock('@/features/community/actions', () => ({ joinGroup: vi.fn(), leaveGroup: vi.fn() }))

import CommunityPage from './page'

function group(overrides: Partial<CommunityGroup> = {}): CommunityGroup {
  return {
    id: 'g-engineers', slug: 'marine-engineers', name: 'Marine Engineers', description: 'Technical conversations spanning machinery and maintenance.',
    rules: '', coverUrl: null, iconUrl: null, icon: 'Wrench', visibility: 'public', joinPolicy: 'open', ownerOrganization: null, memberCount: 42, archived: false, createdBy: null, viewerMembership: null, ...overrides,
  }
}

const tankers = group({ id: 'g-tankers', slug: 'tanker-professionals', name: 'Tanker Professionals', icon: 'ShieldCheck', memberCount: 7, description: 'Vetting, SIRE 2.0 and cargo operations.' })
const masters = group({ id: 'g-masters', slug: 'masters-senior-officers', name: 'Masters & Senior Officers', icon: 'UsersRound', visibility: 'private', memberCount: 3 })

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1' })
  mocks.listDirectory.mockResolvedValue([group(), tankers, masters])
  mocks.listViewerGroups.mockResolvedValue([])
  mocks.suggestGroups.mockResolvedValue([])
})

describe('/community directory', () => {
  it('lists public groups before private ones with icon, member count, description and Join / Request to join', async () => {
    render(await CommunityPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { level: 1, name: 'Community groups' })).toBeInTheDocument()
    expect(screen.getByText('Professional Communities')).toHaveClass('max-md:hidden')
    expect(mocks.listDirectory).toHaveBeenCalledWith('viewer-1', { search: '' })

    const publicList = screen.getByRole('list', { name: 'Public groups' })
    expect(publicList).toHaveClass('md:grid-cols-2', 'xl:grid-cols-3')
    expect(within(publicList).getAllByRole('listitem')).toHaveLength(2)
    expect(within(publicList).getByRole('link', { name: 'Marine Engineers' })).toHaveAttribute('href', '/community/marine-engineers')
    expect(within(publicList).getByText('Public · 42 members')).toBeInTheDocument()
    expect(within(publicList).getByText('Technical conversations spanning machinery and maintenance.')).toBeInTheDocument()
    expect(within(publicList).getByRole('button', { name: 'Join Marine Engineers' })).toBeInTheDocument()

    const privateList = screen.getByRole('list', { name: 'Private groups' })
    expect(within(privateList).getByLabelText('Private group')).toBeInTheDocument()
    expect(within(privateList).getByRole('button', { name: 'Request to join Masters & Senior Officers' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your groups' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Suggested for you' })).not.toBeInTheDocument()
  })

  it('shows Your groups with a Pending chip and Suggested for you above the directory', async () => {
    mocks.listViewerGroups.mockResolvedValue([
      group({ viewerMembership: { role: 'admin', status: 'active' } }),
      { ...masters, viewerMembership: { role: 'member', status: 'pending' } },
    ])
    mocks.suggestGroups.mockResolvedValue([tankers])
    render(await CommunityPage({ searchParams: Promise.resolve({}) }))

    const mine = screen.getByRole('list', { name: 'Your groups' })
    expect(within(mine).getAllByRole('listitem')).toHaveLength(2)
    expect(within(mine).getByText('Pending', { selector: 'span.rounded-md' })).toBeInTheDocument()
    expect(within(mine).getByRole('button', { name: 'Pending: withdraw your request to join Masters & Senior Officers' })).toBeInTheDocument()
    expect(within(mine).getByLabelText('Joined Marine Engineers')).toBeInTheDocument()
    expect(mocks.suggestGroups).toHaveBeenCalledWith('viewer-1')
    const suggested = screen.getByRole('list', { name: 'Suggested groups' })
    expect(within(suggested).getByRole('link', { name: 'Tanker Professionals' })).toBeInTheDocument()
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['Your groups', 'Suggested for you', 'All groups'])
  })

  it('searches the directory with ?q and hides the personal sections', async () => {
    mocks.listDirectory.mockResolvedValue([tankers])
    mocks.listViewerGroups.mockResolvedValue([group({ viewerMembership: { role: 'member', status: 'active' } })])
    render(await CommunityPage({ searchParams: Promise.resolve({ q: 'tanker' }) }))

    expect(mocks.listDirectory).toHaveBeenCalledWith('viewer-1', { search: 'tanker' })
    expect(mocks.suggestGroups).not.toHaveBeenCalled()
    expect(screen.getByRole('searchbox', { name: 'Search groups' })).toHaveValue('tanker')
    expect(screen.getByRole('heading', { name: 'Groups matching “tanker”' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Your groups' })).not.toBeInTheDocument()
    expect(screen.getByText('1 group')).toBeInTheDocument()
  })

  it('explains an empty search', async () => {
    mocks.listDirectory.mockResolvedValue([])
    render(await CommunityPage({ searchParams: Promise.resolve({ q: 'zzz' }) }))
    expect(screen.getByText('No groups match “zzz”. Try another word or browse all groups.')).toBeInTheDocument()
  })
})
