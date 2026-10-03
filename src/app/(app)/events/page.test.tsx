import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/events' }))

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

    // Desktop form (hidden on phones).
    const desktop = within(screen.getByRole('search', { name: 'Find events' }))
    expect(desktop.getAllByRole('searchbox')).toHaveLength(1)
    expect(desktop.getByRole('searchbox', { name: 'Search events' })).toHaveAttribute('placeholder', 'Search title, topic, host or place')
    expect(screen.queryByPlaceholderText('City, country or venue')).not.toBeInTheDocument()
    expect(desktop.getByRole('combobox', { name: 'Category' })).toBeInTheDocument()
    expect(desktop.getByRole('combobox', { name: 'Event type' })).toBeInTheDocument()
    expect(desktop.getByRole('combobox', { name: 'Format' })).toBeInTheDocument()
    expect(desktop.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(mocks.listDiscoverEvents).toHaveBeenCalledWith('user-1', expect.objectContaining({ search: '', location: '' }))
  })

  it('passes the typed text as the single search and keeps the dropdown filters', async () => {
    await renderPage({ q: ' Capt. Rao ', category: 'training', format: 'online' })

    expect(within(screen.getByRole('search', { name: 'Find events' })).getByRole('searchbox', { name: 'Search events' })).toHaveValue('Capt. Rao')
    expect(within(screen.getByRole('search', { name: 'Search events' })).getByRole('searchbox')).toHaveValue('Capt. Rao')
    const expected = { search: 'Capt. Rao', category: 'training', eventType: undefined, format: 'online', location: '' }
    expect(mocks.listDiscoverEvents).toHaveBeenCalledWith('user-1', expected)
    expect(mocks.listPastEvents).toHaveBeenCalledWith('user-1', expected)
  })

  it('treats an old ?location= link as search text', async () => {
    await renderPage({ location: 'Singapore' })

    expect(within(screen.getByRole('search', { name: 'Find events' })).getByRole('searchbox', { name: 'Search events' })).toHaveValue('Singapore')
    expect(mocks.listDiscoverEvents).toHaveBeenCalledWith('user-1', expect.objectContaining({ search: 'Singapore', location: '' }))
    expect(screen.queryByRole('link', { name: 'Remove place filter' })).not.toBeInTheDocument()
  })

  it('keeps the place from an old link that had both boxes filled and lets the member remove it', async () => {
    await renderPage({ q: 'SIRE', location: 'Mumbai', category: 'training' })

    expect(mocks.listDiscoverEvents).toHaveBeenCalledWith('user-1', expect.objectContaining({ search: 'SIRE', location: 'Mumbai' }))
    expect(screen.getByText(/Also showing only events in or near/)).toHaveTextContent('Mumbai')
    // Desktop form and the phone line both offer it.
    for (const link of screen.getAllByRole('link', { name: 'Remove place filter' })) {
      expect(link).toHaveAttribute('href', '/events?q=SIRE&category=training')
    }
  })
})

describe('/events on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
    mocks.listDiscoverEvents.mockResolvedValue([{ id: 'e1', title: 'SIRE 2.0 workshop' }])
    mocks.listPastEvents.mockResolvedValue([{ id: 'e0', title: 'Last year conference' }])
  })

  it('offers Discover, My Events and Hosting chips with a Create button', async () => {
    await renderPage()
    const chips = within(screen.getByRole('navigation', { name: 'Events' }))
    expect(chips.getByRole('link', { name: 'Discover' })).toHaveAttribute('aria-current', 'page')
    expect(chips.getByRole('link', { name: 'My Events' })).toHaveAttribute('href', '/events/my')
    expect(chips.getByRole('link', { name: 'Hosting' })).toHaveAttribute('href', '/events/hosting')
    expect(chips.getByRole('link', { name: 'Create event' })).toHaveAttribute('href', '/events/create')
  })

  it('keeps the filters in a sheet and submits them with the search', async () => {
    await renderPage({ q: 'SIRE', format: 'online' })
    const phone = screen.getByRole('search', { name: 'Search events' })
    expect(phone).toHaveAttribute('action', '/events')
    // One filter already applied travels as a hidden input.
    expect(phone.querySelector('input[type="hidden"][name="format"]')).toHaveValue('online')
    const trigger = within(phone).getByRole('button', { name: /Filters/ })
    expect(trigger).toHaveTextContent('1')

    fireEvent.click(trigger)
    const sheet = screen.getByRole('dialog', { name: 'Filters' })
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Category' }), { target: { value: 'safety' } })
    expect(phone.querySelector('input[type="hidden"][name="category"]')).toHaveValue('safety')
    expect(within(sheet).getByRole('button', { name: 'Show results' })).toHaveAttribute('type', 'submit')
    expect(phone.contains(sheet)).toBe(true)

    fireEvent.click(within(sheet).getByRole('button', { name: 'Clear' }))
    expect(phone.querySelector('input[type="hidden"]')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument()
  })

  it('keeps past events behind a Show past events toggle', async () => {
    await renderPage()
    const toggle = screen.getByRole('button', { name: 'Show past events' })
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(panel).toHaveClass('max-md:hidden')
    expect(panel).toHaveTextContent('Last year conference')
    fireEvent.click(toggle)
    expect(screen.queryByRole('button', { name: 'Show past events' })).not.toBeInTheDocument()
    expect(screen.getByText('Last year conference').closest('.max-md\\:hidden')).toBeNull()
  })
})
