import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listDiscoverEvents: vi.fn(),
  listPastEvents: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/events/calendar-repository', () => ({
  calendarEventRepository: {
    listDiscoverEvents: mocks.listDiscoverEvents,
    listPastEvents: mocks.listPastEvents,
  },
}))
vi.mock('@/features/events/components/event-card', () => ({
  EventCard: ({ event }: { event: { title: string } }) => <article>{event.title}</article>,
}))

import EventsPage from './page'

type Params = { q?: string; category?: string; eventType?: string; format?: string; location?: string }

async function renderPage(params: Params = {}) {
  render(await EventsPage({ searchParams: Promise.resolve(params) }))
}

afterEach(() => cleanup())

describe('/events discovery search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
    mocks.listDiscoverEvents.mockResolvedValue([])
    mocks.listPastEvents.mockResolvedValue([])
  })

  it('shows one search box plus the category, type and format dropdowns and a Search button', async () => {
    await renderPage()

    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
    expect(screen.getByRole('searchbox', { name: 'Search events' })).toHaveAttribute('placeholder', 'Search title, topic, host or place')
    expect(screen.queryByPlaceholderText('City, country or venue')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Category' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Event type' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Format' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(mocks.listDiscoverEvents).toHaveBeenCalledWith('user-1', expect.objectContaining({ search: '', location: '' }))
  })

  it('passes the typed text as the single search and keeps the dropdown filters', async () => {
    await renderPage({ q: ' Capt. Rao ', category: 'training', format: 'online' })

    expect(screen.getByRole('searchbox', { name: 'Search events' })).toHaveValue('Capt. Rao')
    const expected = { search: 'Capt. Rao', category: 'training', eventType: undefined, format: 'online', location: '' }
    expect(mocks.listDiscoverEvents).toHaveBeenCalledWith('user-1', expected)
    expect(mocks.listPastEvents).toHaveBeenCalledWith('user-1', expected)
  })

  it('treats an old ?location= link as search text', async () => {
    await renderPage({ location: 'Singapore' })

    expect(screen.getByRole('searchbox', { name: 'Search events' })).toHaveValue('Singapore')
    expect(mocks.listDiscoverEvents).toHaveBeenCalledWith('user-1', expect.objectContaining({ search: 'Singapore', location: '' }))
    expect(screen.queryByRole('link', { name: 'Remove place filter' })).not.toBeInTheDocument()
  })

  it('keeps the place from an old link that had both boxes filled and lets the member remove it', async () => {
    await renderPage({ q: 'SIRE', location: 'Mumbai', category: 'training' })

    expect(mocks.listDiscoverEvents).toHaveBeenCalledWith('user-1', expect.objectContaining({ search: 'SIRE', location: 'Mumbai' }))
    expect(screen.getByText(/Also showing only events in or near/)).toHaveTextContent('Mumbai')
    expect(screen.getByRole('link', { name: 'Remove place filter' })).toHaveAttribute('href', '/events?q=SIRE&category=training')
  })
})
