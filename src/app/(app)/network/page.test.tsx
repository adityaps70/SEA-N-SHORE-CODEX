import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NetworkPage from './page'

const profile = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'capt-meera-nair',
  profileType: 'seafarer',
  fullName: 'Capt. Meera Nair',
  avatarPath: null,
  location: 'Mumbai, India',
  headline: 'Master Mariner | Tanker Operations',
  summary: 'Experienced tanker professional.',
  rank: 'Master',
  currentCompany: 'Ocean Example',
  currentVessel: null,
  sailingExperienceYears: 18,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: false,
  availability: null,
  skills: ['Navigation'],
  relationship: { following: true, connection: { kind: 'connected', connectionId: '33333333-3333-4333-8333-333333333333' } },
  relationshipSince: '2026-09-09T10:00:00.000Z',
}

vi.mock('@/features/network/queries', () => ({
  getNetworkHub: vi.fn(async (tab: string, ...args: string[]) => ({
    tab,
    profiles: tab === 'requests' ? [] : [profile],
    receivedRequests: tab === 'requests' ? [profile] : [],
    sentRequests: [],
    incomingRequestCount: tab === 'requests' ? 1 : 0,
    totalCount: 1,
    followView: args[1] ?? 'following',
  })),
}))

vi.mock('@/features/network/components/network-profile-card', () => ({
  NetworkProfileCard: ({ profile: item }: { profile: typeof profile }) => <div>Discover card {item.fullName}</div>,
}))

vi.mock('@/features/network/components/network-person-list-row', () => ({
  NetworkPersonListRow: ({ profile: item, kind }: { profile: typeof profile; kind: string }) => <div>{kind} row {item.fullName}</div>,
}))

vi.mock('@/features/network/components/connection-request-card', () => ({
  ConnectionRequestCard: ({ profile: item, direction }: { profile: typeof profile; direction: string }) => <div>{direction} request {item.fullName}</div>,
}))

afterEach(() => cleanup())

describe('Maritime Network page', () => {
  it('renders Discover as a LinkedIn-style people-you-may-know grid within the existing Sea N Shore shell', async () => {
    render(await NetworkPage({ searchParams: Promise.resolve({ tab: 'discover' }) }))

    expect(screen.getByRole('heading', { name: 'People worth knowing at sea and ashore.' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'My Network' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'People you may know' })).toBeInTheDocument()
    expect(screen.getByText('Discover card Capt. Meera Nair')).toBeInTheDocument()
  })

  it('renders Connections as a searchable recently-added list with a connection count', async () => {
    render(await NetworkPage({ searchParams: Promise.resolve({ tab: 'connections' }) }))

    expect(screen.getByRole('heading', { name: '1 connection' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search connections' })).toBeInTheDocument()
    expect(screen.getByText('Sort by:')).toBeInTheDocument()
    expect(screen.getAllByText('Recently added').length).toBeGreaterThan(0)
    expect(screen.getByText('connection row Capt. Meera Nair')).toBeInTheDocument()
  })

  it('renders Following with LinkedIn-style Following and Followers sub-tabs', async () => {
    render(await NetworkPage({ searchParams: Promise.resolve({ tab: 'following', view: 'following' }) }))

    expect(screen.getByRole('heading', { name: 'Your Network' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Following' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Followers' })).toBeInTheDocument()
    expect(screen.getByText('You are following 1 person in your maritime network.')).toBeInTheDocument()
    expect(screen.getByText('following row Capt. Meera Nair')).toBeInTheDocument()
  })

  it('renders Requests as an invitations surface with Received and Sent views', async () => {
    render(await NetworkPage({ searchParams: Promise.resolve({ tab: 'requests', view: 'received' }) }))

    expect(screen.getByRole('heading', { name: 'Invitations' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Received/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Sent/ })).toBeInTheDocument()
    expect(screen.getByText('incoming request Capt. Meera Nair')).toBeInTheDocument()
  })
})
