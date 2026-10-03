import { describe, expect, it } from 'vitest'
import type { CalendarEventFormat, CalendarEventInput, CalendarEventPricing } from './calendar-types'
import { calendarFieldErrors, calendarValidationMessage, parseCalendarEventInput, publicationIssues } from './calendar-validation'

function base(overrides: Partial<CalendarEventInput> = {}): CalendarEventInput {
  return {
    title: 'Ballast water management workshop',
    summary: '',
    description: '',
    category: 'technical',
    eventType: 'workshop',
    format: 'online',
    status: 'draft',
    startAt: '2030-03-10T09:00:00.000Z',
    endAt: '2030-03-10T11:00:00.000Z',
    timezone: 'Asia/Kolkata',
    locationName: null,
    locationAddress: null,
    city: null,
    country: null,
    meetingUrl: null,
    topics: [],
    agenda: [],
    speakers: [],
    speakerDetails: [],
    capacity: null,
    bannerUrl: null,
    registrationMode: 'open',
    registrationClosesAt: null,
    pricing: 'free',
    priceMinor: null,
    currency: null,
    ...overrides,
  }
}

const accessDetails: Record<CalendarEventFormat, Partial<CalendarEventInput>> = {
  online: { meetingUrl: 'https://meet.example.com/bwm' },
  in_person: { locationName: 'Maritime Training Centre', locationAddress: 'Harbour Road', city: 'Mumbai', country: 'India' },
  hybrid: { meetingUrl: 'https://meet.example.com/bwm', locationName: 'Maritime Training Centre', locationAddress: 'Harbour Road', city: 'Mumbai', country: 'India' },
}

const expectedMissing: Record<CalendarEventFormat, string[]> = {
  online: ['meetingUrl'],
  in_person: ['locationName', 'city', 'country'],
  hybrid: ['meetingUrl', 'locationName', 'city', 'country'],
}

const pricingDetails: Record<CalendarEventPricing, Partial<CalendarEventInput>> = {
  free: { pricing: 'free' },
  paid: { pricing: 'paid', priceMinor: 49900, currency: 'INR' },
}

const combinations = (['free', 'paid'] as const).flatMap((pricing) =>
  (['online', 'in_person', 'hybrid'] as const).map((format) => ({ pricing, format })),
)

describe('event validation for every Free / Paid × Online / Offline / Hybrid combination', () => {
  for (const { pricing, format } of combinations) {
    describe(`${pricing} ${format} event`, () => {
      it('saves as a draft with only a title and schedule', () => {
        const parsed = parseCalendarEventInput(base({ format, pricing }))
        expect(parsed.success).toBe(true)
      })

      it('blocks publishing and names every missing item', () => {
        const parsed = parseCalendarEventInput(base({ format, pricing, status: 'published' }))
        expect(parsed.success).toBe(false)
        if (parsed.success) return
        const errors = calendarFieldErrors(parsed.error)
        const missing = [...expectedMissing[format], 'summary', ...(pricing === 'paid' ? ['priceMinor', 'currency'] : [])]
        expect(Object.keys(errors).sort()).toEqual(missing.sort())
        const message = calendarValidationMessage(parsed.error)
        expect(message).toContain("can't be published yet")
        expect(message).toContain('Add a short summary.')
        expect(message).toContain('You can save it as a draft')
        if (format !== 'in_person') expect(message).toContain('Add the online meeting or registration link.')
        if (format !== 'online') expect(message).toContain('Add the venue name.')
        if (pricing === 'paid') expect(message).toContain('Add the ticket price.')
      })

      it('publishes once the required details are present', () => {
        const parsed = parseCalendarEventInput(base({
          format,
          status: 'published',
          summary: 'Hands-on ballast water treatment troubleshooting.',
          ...accessDetails[format],
          ...pricingDetails[pricing],
        }))
        expect(parsed.success).toBe(true)
        if (!parsed.success) return
        expect(parsed.data.pricing).toBe(pricing)
        expect(parsed.data.priceMinor).toBe(pricing === 'paid' ? 49900 : null)
        expect(parsed.data.currency).toBe(pricing === 'paid' ? 'INR' : null)
        expect(Boolean(parsed.data.meetingUrl)).toBe(format !== 'in_person')
        expect(Boolean(parsed.data.locationName)).toBe(format !== 'online')
      })
    })
  }

  it('stores only the fields that apply to the chosen attendance type and pricing', () => {
    const parsed = parseCalendarEventInput(base({
      format: 'online',
      pricing: 'free',
      priceMinor: 1000,
      currency: 'USD',
      ...accessDetails.hybrid,
    }))
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toMatchObject({ locationName: null, locationAddress: null, city: null, country: null, priceMinor: null, currency: null })
    expect(parsed.data.meetingUrl).toBe('https://meet.example.com/bwm')

    const offline = parseCalendarEventInput(base({ format: 'in_person', ...accessDetails.hybrid }))
    expect(offline.success && offline.data.meetingUrl).toBe(null)
  })

  it('keeps the address optional for offline events', () => {
    const parsed = parseCalendarEventInput(base({
      format: 'in_person',
      status: 'published',
      summary: 'Summary',
      ...accessDetails.in_person,
      locationAddress: null,
    }))
    expect(parsed.success).toBe(true)
  })

  it('accepts USD and rejects prices outside the allowed range, even for drafts', () => {
    const usd = parseCalendarEventInput(base({ pricing: 'paid', priceMinor: 2500, currency: 'USD' }))
    expect(usd.success).toBe(true)

    const tooLow = parseCalendarEventInput(base({ pricing: 'paid', priceMinor: 50, currency: 'INR' }))
    expect(tooLow.success).toBe(false)
    if (!tooLow.success) expect(calendarFieldErrors(tooLow.error).priceMinor).toMatch(/between ₹1 and ₹5,00,000/)

    const tooHigh = parseCalendarEventInput(base({ pricing: 'paid', priceMinor: 60_000_000, currency: 'USD' }))
    expect(tooHigh.success).toBe(false)

    const unsupported = parseCalendarEventInput({ ...base({ pricing: 'paid', priceMinor: 1000 }), currency: 'EUR' })
    expect(unsupported.success).toBe(false)
    if (!unsupported.success) expect(calendarFieldErrors(unsupported.error).currency).toBe('Choose INR or USD.')
  })

  it('rejects a price that is not a whole number of minor units', () => {
    const parsed = parseCalendarEventInput(base({ pricing: 'paid', priceMinor: Number.NaN, currency: 'INR' }))
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(calendarFieldErrors(parsed.error).priceMinor).toMatch(/ticket price as a number/)
  })

  it('still requires a title and a valid schedule for drafts', () => {
    const parsed = parseCalendarEventInput(base({ title: '', startAt: '', endAt: '' }))
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(calendarFieldErrors(parsed.error)).toMatchObject({
      title: expect.stringMatching(/title/i),
      startAt: 'Choose the start date and time.',
      endAt: 'Choose the end date and time.',
    })
  })

  it('rejects a malformed meeting link with a plain message', () => {
    const parsed = parseCalendarEventInput(base({ meetingUrl: 'zoom meeting' }))
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(calendarFieldErrors(parsed.error).meetingUrl).toBe('Enter a full web address, starting with https://')
  })

  it('treats older callers without pricing as free events', () => {
    const { pricing: _pricing, priceMinor: _priceMinor, currency: _currency, ...legacy } = base({ meetingUrl: 'https://meet.example.com/x' })
    void _pricing
    void _priceMinor
    void _currency
    const parsed = parseCalendarEventInput(legacy)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toMatchObject({ pricing: 'free', priceMinor: null, currency: null })
  })

  it('lists publication issues for the form without running the full schema', () => {
    expect(publicationIssues({
      summary: 'Ready', format: 'hybrid', meetingUrl: null, locationName: 'Centre', city: null, country: 'India',
      pricing: 'paid', priceMinor: 100, currency: null,
    }).map((issue) => issue.field)).toEqual(['meetingUrl', 'city', 'currency'])
  })
})
