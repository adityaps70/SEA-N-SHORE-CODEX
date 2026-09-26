import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getPublicProfileBySlug: vi.fn(),
  getPublicProfilesByIds: vi.fn(),
  getProfileNetworkSummary: vi.fn(),
  getProfileNetworkListIds: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))
vi.mock('@/features/auth/queries', () => ({ requireUser: mocks.requireUser }))
vi.mock('@/features/profiles/queries', () => ({
  getPublicProfileBySlug: mocks.getPublicProfileBySlug,
  getPublicProfilesByIds: mocks.getPublicProfilesByIds,
}))
vi.mock('@/features/profiles/profile-network-stats', () => ({
  getProfileNetworkSummary: mocks.getProfileNetworkSummary,
  getProfileNetworkListIds: mocks.getProfileNetworkListIds,
}))
vi.mock('@/features/profiles/components/profile-directory-card', () => ({
  ProfileDirectoryCard: ({ profile }: { profile: { fullName: string } }) => <article>{profile.fullName}</article>,
}))

import PersonNetworkPage from './page'

const viewerId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'

function open(view?: string) {
  return PersonNetworkPage({
    params: Promise.resolve({ slug: 'captain-public' }),
    searchParams: Promise.resolve(view ? { view } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUser.mockResolvedValue({ id: viewerId })
  mocks.getPublicProfileBySlug.mockResolvedValue({ id: ownerId, slug: 'captain-public', fullName: 'Captain Public' })
  mocks.getProfileNetworkSummary.mockResolvedValue({
    counts: { connections: 2, followers: 9, following: 4 },
    isOwner: false,
    canViewLists: true,
  })
  mocks.getProfileNetworkListIds.mockResolvedValue(['a', 'b'])
  mocks.getPublicProfilesByIds.mockResolvedValue([
    { id: 'a', slug: 'member-a', fullName: 'Member A' },
    { id: 'b', slug: 'member-b', fullName: 'Member B' },
  ])
})

afterEach(() => cleanup())

describe('member network list page', () => {
  it('lists the connections of a member the viewer is connected with', async () => {
    render(await open('connections'))

    expect(screen.getByRole('heading', { name: "Captain Public's network" })).toBeInTheDocument()
    expect(screen.getByText('Member A')).toBeInTheDocument()
    expect(screen.getByText('Member B')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Connections\s*2/ })).toHaveAttribute('aria-current', 'page')
    expect(mocks.getProfileNetworkListIds).toHaveBeenCalledWith(viewerId, ownerId, 'connections')
  })

  it('explains the rule instead of listing people for a viewer who is not connected', async () => {
    mocks.getProfileNetworkListIds.mockResolvedValueOnce(null)

    render(await open('followers'))

    expect(screen.getByText("Only Captain's connections can see this list.")).toBeInTheDocument()
    expect(screen.queryByText('Member A')).not.toBeInTheDocument()
    expect(mocks.getPublicProfilesByIds).not.toHaveBeenCalled()
  })

  it('sends the owner to their own network hub', async () => {
    mocks.requireUser.mockResolvedValueOnce({ id: ownerId })
    await expect(open('followers')).rejects.toThrow('NEXT_REDIRECT:/network?tab=following&view=followers')
  })

  it('shows a clear empty state', async () => {
    mocks.getProfileNetworkListIds.mockResolvedValueOnce([])
    render(await open('following'))
    expect(screen.getByText('Captain is not following anyone yet.')).toBeInTheDocument()
  })

  it('returns not found for an unknown member', async () => {
    mocks.getPublicProfileBySlug.mockResolvedValueOnce(null)
    await expect(open()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
