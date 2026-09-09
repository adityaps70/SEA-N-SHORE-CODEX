import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NetworkPage from './page'

vi.mock('@/features/network/queries', () => ({
  getNetworkHub: vi.fn(async () => ({
    tab: 'discover',
    profiles: [],
    receivedRequests: [],
    sentRequests: [],
    incomingRequestCount: 0,
  })),
}))

describe('Maritime Network page', () => {
  it('keeps the useful network controls without the requested descriptive sentence', async () => {
    render(await NetworkPage({ searchParams: Promise.resolve({ tab: 'discover' }) }))

    expect(screen.getByRole('heading', { name: 'People worth knowing at sea and ashore.' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search maritime professionals' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'My Network' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Discover' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Connections' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Requests' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Following' })).toBeInTheDocument()
    expect(screen.queryByText('Build professional relationships across ships, shore offices, training, recruitment, mentoring, and the wider maritime ecosystem.')).not.toBeInTheDocument()
  })
})
