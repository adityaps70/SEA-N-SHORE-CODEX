import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getEvent: vi.fn(),
  getPaymentCapabilities: vi.fn(),
  withdrawEventAttendanceAction: vi.fn(),
  attendEventAction: vi.fn(),
  refresh: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }), usePathname: () => '/events/e1' }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/events/calendar-repository', () => ({ calendarEventRepository: { getEvent: mocks.getEvent } }))
vi.mock('@/features/payments/provider', () => ({ getPaymentCapabilities: mocks.getPaymentCapabilities }))
vi.mock('@/features/events/calendar-actions', () => ({
  attendEventAction: mocks.attendEventAction,
  withdrawEventAttendanceAction: mocks.withdrawEventAttendanceAction,
}))
vi.mock('@/features/payments/event-payment-actions', () => ({ startEventCheckoutAction: vi.fn(), confirmEventPaymentAction: vi.fn() }))
vi.mock('@/features/moderation/actions', () => ({ reportContent: vi.fn() }))
vi.mock('@/features/billing/components/plan-hidden-banner', () => ({ PlanHiddenBanner: () => <p>Hidden for plan</p> }))

import EventDetailPage from './page'

const baseEvent = {
  id: 'e1',
  title: 'SIRE 2.0 inspection readiness workshop',
  summary: 'A hands-on session on CVIQ.',
  description: 'Human, Process and Hardware factors.',
  category: 'training',
  eventType: 'workshop',
  format: 'hybrid',
  status: 'published',
  startAt: '2026-10-03T11:30:00.000Z',
  endAt: '2026-10-03T13:30:00.000Z',
  timezone: 'Asia/Kolkata',
  locationName: 'Beaufort Hall',
  locationAddress: null,
  city: 'Navi Mumbai',
  country: 'India',
  meetingUrl: null as string | null,
  topics: ['CVIQ'],
  agenda: ['Welcome'],
  speakers: [],
  speakerDetails: [{ name: 'Aditya Pratap Singh', title: 'Master Mariner', organization: 'Verified trainer' }],
  capacity: 50,
  bannerUrl: null,
  bannerStoragePath: null,
  registrationMode: 'open',
  registrationClosesAt: null,
  pricing: 'free',
  priceMinor: null as number | null,
  currency: null as string | null,
  hostUserId: 'host-1',
  hostName: 'Prakhar Pathak',
  hostSlug: 'prakhar',
  publisherType: 'personal',
  companyId: null,
  publisherName: 'Prakhar Pathak',
  publisherSlug: 'prakhar',
  publisherVerified: false,
  attendeeCount: 42,
  viewerIsAttending: false,
  viewerHasPaid: false,
  viewerIsHost: false,
  registrationOpen: true,
  isPast: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

const params = Promise.resolve({ eventId: 'e1' })

async function renderEvent(overrides: Partial<typeof baseEvent> = {}) {
  mocks.getEvent.mockResolvedValue({ ...baseEvent, ...overrides })
  render(await EventDetailPage({ params }))
}

function stickyBar() {
  return within(screen.getByRole('region', { name: 'Event actions' }))
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'More actions for this event' }))
  return within(screen.getByRole('menu', { name: 'Event options' }))
}

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
  mocks.getPaymentCapabilities.mockResolvedValue({ configured: true, provider: 'cashfree', currencies: ['INR'] })
  mocks.withdrawEventAttendanceAction.mockResolvedValue({ ok: true })
})

describe('/events/[eventId] "Hosted by" links', () => {
  it('links a personal host to their public profile at /people/{slug}', async () => {
    await renderEvent()
    const links = screen.getAllByRole('link', { name: 'Prakhar Pathak' })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).toHaveAttribute('href', '/people/prakhar')
    expect(document.querySelector('a[href^="/profile/"]')).toBeNull()
  })

  it('links an organization host to its page on phones', async () => {
    await renderEvent({ publisherType: 'organization', publisherName: 'Beaufort Marine', publisherSlug: 'beaufort-marine', publisherVerified: true })
    expect(screen.getByRole('link', { name: 'Beaufort Marine' })).toHaveAttribute('href', '/organizations/beaufort-marine')
  })
})

describe('/events/[eventId] phone layout', () => {
  it('has a page bar back to Events, a date line and two info chips', async () => {
    await renderEvent()
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/events')
    expect(screen.getByText(/Sat, 3 Oct 2026 · 5:00 – 7:00 pm IST/i)).toBeInTheDocument()
    const chips = within(screen.getByRole('list', { name: 'Event details' }))
    expect(chips.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Navi Mumbai & online', '42 / 50 attending'])
    expect(screen.getByRole('region', { name: 'About' })).toHaveTextContent('A hands-on session on CVIQ.')
  })
})

describe('/events/[eventId] sticky bar', () => {
  it('free event: Register for event, with an Add to calendar button', async () => {
    mocks.attendEventAction.mockResolvedValue({ ok: true })
    await renderEvent()
    const bar = stickyBar()
    expect(bar.getByRole('link', { name: 'Add to calendar (.ics)' })).toHaveAttribute('href', '/events/e1/calendar')
    fireEvent.click(bar.getByRole('button', { name: 'Register for event' }))
    await waitFor(() => expect(mocks.attendEventAction).toHaveBeenCalledWith('e1'))
  })

  it('paid event: Pay ₹x and register', async () => {
    await renderEvent({ pricing: 'paid', priceMinor: 49900, currency: 'INR' })
    expect(stickyBar().getByRole('button', { name: /Pay ₹499 and register/ })).toBeEnabled()
  })

  it('full event: the bar says why registering is not possible', async () => {
    await renderEvent({ capacity: 42 })
    expect(stickyBar().getByRole('button', { name: 'Event full' })).toBeDisabled()
  })

  it('host: Manage event', async () => {
    await renderEvent({ viewerIsHost: true, pricing: 'paid', priceMinor: 49900, currency: 'INR' })
    expect(stickyBar().getByRole('link', { name: 'Manage event' })).toHaveAttribute('href', '/events/e1/edit')
  })

  it('registered and the session link is available: Join online session', async () => {
    await renderEvent({ viewerIsAttending: true, meetingUrl: 'https://meet.example/abc' })
    expect(stickyBar().getByRole('link', { name: /Join online session/ })).toHaveAttribute('href', 'https://meet.example/abc')
  })

  it('ended or cancelled event: says so, also to attendees', async () => {
    await renderEvent({ viewerIsAttending: true, isPast: true })
    expect(stickyBar().getByRole('button', { name: 'Event ended' })).toBeDisabled()
    cleanup()
    await renderEvent({ viewerIsAttending: true, status: 'cancelled' })
    expect(stickyBar().getByRole('button', { name: 'Event cancelled' })).toBeDisabled()
    cleanup()
    await renderEvent({ viewerIsHost: true, status: 'cancelled' })
    expect(stickyBar().queryByRole('link', { name: 'Manage event' })).not.toBeInTheDocument()
    expect(stickyBar().getByRole('button', { name: 'Event cancelled' })).toBeDisabled()
  })

  it('registered without a joining link: shows attending', async () => {
    await renderEvent({ viewerIsAttending: true })
    expect(stickyBar().getByText(/attending/)).toBeInTheDocument()
    expect(stickyBar().queryByRole('button', { name: 'Register for event' })).not.toBeInTheDocument()
  })
})

describe('/events/[eventId] "…" sheet', () => {
  it('attendee of a free event: calendar, share, copy, withdraw and report', async () => {
    await renderEvent({ viewerIsAttending: true })
    const menu = openMenu()
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent?.replace('(opens in a new tab)', '').trim())).toEqual([
      'Add to Google Calendar', 'Download .ics', 'Share event', 'Copy event link', 'Withdraw attendance', 'Report event',
    ])
    expect(menu.getByRole('menuitem', { name: /Add to Google Calendar/ })).toHaveAttribute('href', expect.stringContaining('https://calendar.google.com/calendar/render'))
    expect(menu.getByRole('menuitem', { name: 'Download .ics' })).toHaveAttribute('href', '/events/e1/calendar')

    fireEvent.click(menu.getByRole('menuitem', { name: 'Withdraw attendance' }))
    await waitFor(() => expect(mocks.withdrawEventAttendanceAction).toHaveBeenCalledWith('e1'))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it('does not offer to withdraw a paid seat or an event the viewer is not attending', async () => {
    await renderEvent({ viewerIsAttending: true, viewerHasPaid: true, pricing: 'paid', priceMinor: 49900, currency: 'INR' })
    expect(openMenu().queryByRole('menuitem', { name: 'Withdraw attendance' })).not.toBeInTheDocument()
    cleanup()
    await renderEvent()
    expect(openMenu().queryByRole('menuitem', { name: 'Withdraw attendance' })).not.toBeInTheDocument()
  })

  it('host of a paid event: Paid registrations and no Report event', async () => {
    await renderEvent({ viewerIsHost: true, pricing: 'paid', priceMinor: 49900, currency: 'INR' })
    const menu = openMenu()
    expect(menu.getByRole('menuitem', { name: 'Paid registrations' })).toHaveAttribute('href', '/events/e1/registrations')
    expect(menu.queryByRole('menuitem', { name: 'Report event' })).not.toBeInTheDocument()
  })

  it('opens the existing report dialog for events', async () => {
    await renderEvent()
    fireEvent.click(openMenu().getByRole('menuitem', { name: 'Report event' }))
    expect(screen.getByRole('dialog', { name: 'Report event' })).toBeInTheDocument()
    expect(screen.queryByRole('menu', { name: 'Event options' })).not.toBeInTheDocument()
  })
})
