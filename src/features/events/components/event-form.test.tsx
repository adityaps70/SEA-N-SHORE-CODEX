import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarEvent } from '../calendar-types'
import type { EventPublisherOption } from '../publishers'

const mocks = vi.hoisted(() => ({
  createEventAction: vi.fn(),
  updateEventAction: vi.fn(),
  cancelEventAction: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('../calendar-actions', () => ({
  createEventAction: mocks.createEventAction,
  updateEventAction: mocks.updateEventAction,
  cancelEventAction: mocks.cancelEventAction,
  createEventBannerUploadAction: vi.fn(),
}))
vi.mock('./upload-event-banner', () => ({ uploadEventBannerFile: vi.fn() }))

import { EventForm } from './event-form'

const publisher: EventPublisherOption = {
  key: 'personal:1', kind: 'personal', id: '1', name: 'Capt. Host', slug: null, verified: true, role: null, canPublish: true, blocker: null,
}

function existing(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e1', hostUserId: 'h', hostName: 'Capt. Host', hostSlug: null, publisherType: 'personal', companyId: null,
    publisherName: 'Capt. Host', publisherSlug: null, publisherVerified: true,
    title: 'Mooring safety clinic', summary: '', description: '', category: 'safety', eventType: 'workshop',
    format: 'online', status: 'draft', startAt: '2030-06-01T04:30:00.000Z', endAt: '2030-06-01T06:30:00.000Z', timezone: 'Asia/Kolkata',
    locationName: null, locationAddress: null, city: null, country: null, meetingUrl: null,
    topics: [], agenda: [], speakers: [], speakerDetails: [], capacity: null, bannerUrl: null, bannerStoragePath: null,
    registrationMode: 'open', registrationClosesAt: null, pricing: 'free', priceMinor: null, currency: null,
    attendeeCount: 0, viewerIsAttending: false, viewerHasPaid: false, viewerIsHost: true, registrationOpen: false, isPast: false,
    createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createEventAction.mockResolvedValue({ ok: true, eventId: 'e1' })
  mocks.updateEventAction.mockResolvedValue({ ok: true })
  mocks.cancelEventAction.mockResolvedValue({ ok: true })
})

afterEach(() => cleanup())

describe('event form: attendance type shows only the relevant fields', () => {
  it('starts as Online with only the meeting or registration link', () => {
    render(<EventForm mode="create" publisherOptions={[publisher]} paymentsConfigured />)
    expect(screen.getByRole('radio', { name: /Online/ })).toBeChecked()
    expect(screen.getByLabelText(/Meeting or registration link/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Venue/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^City/)).not.toBeInTheDocument()
  })

  it('shows venue, address, city and country for Offline, and hides the link', () => {
    render(<EventForm mode="create" publisherOptions={[publisher]} paymentsConfigured />)
    fireEvent.click(screen.getByRole('radio', { name: /Offline/ }))
    for (const field of [/^Venue/, /^Address/, /^City/, /^Country/]) expect(screen.getByLabelText(field)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Meeting or registration link/)).not.toBeInTheDocument()
  })

  it('shows both sets of fields for Hybrid and keeps typed values when switching', () => {
    render(<EventForm mode="create" publisherOptions={[publisher]} paymentsConfigured />)
    fireEvent.change(screen.getByLabelText(/Meeting or registration link/), { target: { value: 'https://meet.example.com/a' } })
    fireEvent.click(screen.getByRole('radio', { name: /Hybrid/ }))
    expect(screen.getByLabelText(/^Venue/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Meeting or registration link/)).toHaveValue('https://meet.example.com/a')
  })
})

describe('event form: Free or Paid', () => {
  it('is Free by default with no price fields', () => {
    render(<EventForm mode="create" publisherOptions={[publisher]} paymentsConfigured />)
    expect(screen.getByRole('radio', { name: /Free/ })).toBeChecked()
    expect(screen.queryByLabelText(/Ticket price/)).not.toBeInTheDocument()
  })

  it('shows price and currency (INR by default, USD available) for Paid', () => {
    render(<EventForm mode="create" publisherOptions={[publisher]} paymentsConfigured />)
    fireEvent.click(screen.getByRole('radio', { name: /Paid/ }))
    expect(screen.getByLabelText(/Ticket price/)).toBeInTheDocument()
    const currency = screen.getByLabelText(/Currency/) as HTMLSelectElement
    expect(currency.value).toBe('INR')
    expect(within(currency).getByRole('option', { name: /USD/ })).toBeInTheDocument()
    expect(screen.getByText(/Payouts to organisers and any refunds are handled by the Sea N Shore team/)).toBeInTheDocument()
    expect(screen.queryByText(/Payments aren.t switched on/)).not.toBeInTheDocument()
  })

  it('tells organisers when payments are not set up yet', () => {
    render(<EventForm mode="create" publisherOptions={[publisher]} paymentsConfigured={false} />)
    fireEvent.click(screen.getByRole('radio', { name: /Paid/ }))
    expect(screen.getByText(/Payments aren.t switched on for Sea N Shore yet/)).toBeInTheDocument()
  })
})

describe('event form: publishing and drafts', () => {
  it('blocks publishing a paid offline event and lists what is missing', async () => {
    render(<EventForm mode="create" publisherOptions={[publisher]} paymentsConfigured />)
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Cargo securing workshop' } })
    fireEvent.click(screen.getByRole('radio', { name: /Offline/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Paid/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish event' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("This event can't be published yet")
    for (const text of ['Add a short summary.', 'Add the venue name.', 'Add the city.', 'Add the country.', 'Add the ticket price.', 'Choose the start date and time.']) {
      expect(alert).toHaveTextContent(text)
    }
    expect(screen.getByLabelText(/^Venue/)).toHaveAttribute('aria-invalid', 'true')
    expect(mocks.createEventAction).not.toHaveBeenCalled()
  })

  it('saves an incomplete event as a draft', async () => {
    render(<EventForm mode="edit" eventId="e1" initial={existing()} paymentsConfigured />)
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(mocks.updateEventAction).toHaveBeenCalled())
    expect(mocks.updateEventAction).toHaveBeenCalledWith('e1', expect.objectContaining({ status: 'draft', meetingUrl: null, pricing: 'free' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Draft saved.')
  })

  it('publishes a complete paid online event with the price in minor units', async () => {
    render(<EventForm mode="edit" eventId="e1" initial={existing({ summary: 'Hands-on mooring safety.' })} paymentsConfigured />)
    fireEvent.change(screen.getByLabelText(/Meeting or registration link/), { target: { value: 'https://meet.example.com/mooring' } })
    fireEvent.click(screen.getByRole('radio', { name: /Paid/ }))
    fireEvent.change(screen.getByLabelText(/Ticket price/), { target: { value: '499.50' } })
    fireEvent.change(screen.getByLabelText(/Currency/), { target: { value: 'USD' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish event' }))
    await waitFor(() => expect(mocks.updateEventAction).toHaveBeenCalled())
    expect(mocks.updateEventAction).toHaveBeenCalledWith('e1', expect.objectContaining({
      status: 'published', pricing: 'paid', priceMinor: 49950, currency: 'USD', meetingUrl: 'https://meet.example.com/mooring',
      locationName: null,
    }))
  })

  it('shows server field errors next to the fields', async () => {
    mocks.updateEventAction.mockResolvedValue({ ok: false, error: 'x', fieldErrors: { meetingUrl: 'Add the online meeting or registration link.' } })
    render(<EventForm mode="edit" eventId="e1" initial={existing({ summary: 'S', meetingUrl: 'https://meet.example.com/x' })} paymentsConfigured />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish event' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Add the online meeting or registration link.')
    expect(screen.getByLabelText(/Meeting or registration link/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('rejects a price that is not a number before calling the server', async () => {
    render(<EventForm mode="edit" eventId="e1" initial={existing({ summary: 'S', meetingUrl: 'https://meet.example.com/x' })} paymentsConfigured />)
    fireEvent.click(screen.getByRole('radio', { name: /Paid/ }))
    fireEvent.change(screen.getByLabelText(/Ticket price/), { target: { value: 'five hundred' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish event' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/ticket price as a number/)
    expect(mocks.updateEventAction).not.toHaveBeenCalled()
  })
})

describe('event form: cancelling', () => {
  it('asks for confirmation inside the page instead of a browser dialog', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<EventForm mode="edit" eventId="e1" initial={existing({ pricing: 'paid', priceMinor: 100, currency: 'INR' })} paymentsConfigured />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel event' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Cancel this event?' })
    expect(dialog).toHaveTextContent('People who paid will be refunded by the Sea N Shore team.')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel event' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel event' }))
    await waitFor(() => expect(mocks.cancelEventAction).toHaveBeenCalledWith('e1'))
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
