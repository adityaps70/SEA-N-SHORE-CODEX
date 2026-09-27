import { z } from 'zod'
import { formatMoney, maxTicketPriceMinor, minTicketPriceMinor } from '@/features/payments/currency'
import { PAYMENT_CURRENCIES } from '@/features/payments/types'
import { isEventBannerReference } from './event-banner-policy'
import {
  CALENDAR_EVENT_CATEGORIES,
  CALENDAR_EVENT_FORMATS,
  CALENDAR_EVENT_PRICING,
  CALENDAR_EVENT_TYPES,
  CALENDAR_REGISTRATION_MODES,
  type CalendarEventField,
  type CalendarEventInput,
  type CalendarFieldErrors,
} from './calendar-types'

const webUrl = z.string().trim()
  .max(2000, 'Links can be up to 2,000 characters.')
  .url('Enter a full web address, starting with https://')
  .refine((value) => value.startsWith('https://') || value.startsWith('http://'), 'Enter a full web address, starting with https://')
const nullableUrl = webUrl.nullable()
const nullableText = (max: number, label: string) => z.string().trim().max(max, `${label} can be up to ${max.toLocaleString('en')} characters.`).nullable()
const eventBannerReference = z.string().trim().max(2000).refine(isEventBannerReference, 'Upload a valid event banner image.').nullable()
const speakerDetailSchema = z.object({
  name: z.string().trim().min(1).max(160),
  title: z.string().trim().max(160),
  organization: z.string().trim().max(200),
})
const isoDateTime = (message: string) => z.string({ error: message }).datetime({ offset: true, message })

/**
 * Shape and consistency rules that apply to every save, including drafts.
 * Drafts may leave the joining link, venue, summary and ticket price empty.
 */
const calendarEventShape = z.object({
  title: z.string().trim().min(2, 'Add an event title (at least 2 characters).').max(180, 'Keep the title under 180 characters.'),
  summary: z.string().trim().max(600, 'Keep the summary under 600 characters.'),
  description: z.string().trim().max(12000, 'Keep the description under 12,000 characters.'),
  category: z.enum(CALENDAR_EVENT_CATEGORIES, { error: 'Choose a category.' }),
  eventType: z.enum(CALENDAR_EVENT_TYPES, { error: 'Choose what kind of event this is.' }),
  format: z.enum(CALENDAR_EVENT_FORMATS, { error: 'Choose Online, Offline or Hybrid.' }),
  status: z.enum(['draft', 'published']),
  startAt: isoDateTime('Choose the start date and time.'),
  endAt: isoDateTime('Choose the end date and time.'),
  timezone: z.string().trim().min(1, 'Choose a timezone.').max(120),
  locationName: nullableText(240, 'The venue name'),
  locationAddress: nullableText(500, 'The address'),
  city: nullableText(160, 'The city'),
  country: nullableText(160, 'The country'),
  meetingUrl: nullableUrl,
  topics: z.array(z.string().trim().min(1).max(120)).max(30, 'Add up to 30 topics.'),
  agenda: z.array(z.string().trim().min(1).max(500)).max(50, 'Add up to 50 agenda items.'),
  speakers: z.array(z.string().trim().min(1).max(160)).max(30, 'Add up to 30 speakers.'),
  speakerDetails: z.array(speakerDetailSchema).max(30, 'Add up to 30 speakers.'),
  capacity: z.number({ error: 'Capacity must be a whole number.' }).int('Capacity must be a whole number.').min(1, 'Capacity must be at least 1.').max(1000000, 'Capacity can be up to 1,000,000.').nullable(),
  bannerUrl: eventBannerReference,
  registrationMode: z.enum(CALENDAR_REGISTRATION_MODES),
  registrationClosesAt: isoDateTime('Choose a valid date and time for registration to close.').nullable(),
  pricing: z.enum(CALENDAR_EVENT_PRICING, { error: 'Choose Free or Paid.' }).default('free'),
  priceMinor: z.number({ error: 'Enter the ticket price as a number, for example 499 or 499.50.' })
    .int('Enter the ticket price with at most two decimal places.')
    .nullable()
    .default(null),
  currency: z.enum(PAYMENT_CURRENCIES, { error: 'Choose INR or USD.' }).nullable().default(null),
})

type EventShape = z.output<typeof calendarEventShape>

export type PublicationIssue = { field: CalendarEventField; message: string }

/** Everything an event needs before attendees can see it. Drafts skip these checks. */
export function publicationIssues(value: Pick<EventShape, 'summary' | 'format' | 'meetingUrl' | 'locationName' | 'city' | 'country' | 'pricing' | 'priceMinor' | 'currency'>): PublicationIssue[] {
  const issues: PublicationIssue[] = []
  if (!value.summary.trim()) issues.push({ field: 'summary', message: 'Add a short summary.' })
  if ((value.format === 'online' || value.format === 'hybrid') && !value.meetingUrl) {
    issues.push({ field: 'meetingUrl', message: 'Add the online meeting or registration link.' })
  }
  if (value.format === 'in_person' || value.format === 'hybrid') {
    if (!value.locationName) issues.push({ field: 'locationName', message: 'Add the venue name.' })
    if (!value.city) issues.push({ field: 'city', message: 'Add the city.' })
    if (!value.country) issues.push({ field: 'country', message: 'Add the country.' })
  }
  if (value.pricing === 'paid') {
    if (value.priceMinor === null) issues.push({ field: 'priceMinor', message: 'Add the ticket price.' })
    if (!value.currency) issues.push({ field: 'currency', message: 'Choose the ticket currency.' })
  }
  return issues
}

export const calendarEventInputSchema = calendarEventShape.superRefine((value, context) => {
  const start = Date.parse(value.startAt)
  const end = Date.parse(value.endAt)
  if (end <= start) {
    context.addIssue({ code: 'custom', path: ['endAt'], message: 'The event must end after it starts.' })
  }
  if (value.registrationClosesAt && Date.parse(value.registrationClosesAt) > start) {
    context.addIssue({ code: 'custom', path: ['registrationClosesAt'], message: 'Registration must close before the event starts.' })
  }
  if (value.pricing === 'paid' && value.priceMinor !== null && value.currency) {
    const min = minTicketPriceMinor(value.currency)
    const max = maxTicketPriceMinor(value.currency)
    if (value.priceMinor < min || value.priceMinor > max) {
      context.addIssue({
        code: 'custom',
        path: ['priceMinor'],
        message: `The ticket price must be between ${formatMoney(min, value.currency)} and ${formatMoney(max, value.currency)}.`,
      })
    }
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format(new Date(Number.isFinite(start) ? start : Date.now()))
  } catch {
    context.addIssue({ code: 'custom', path: ['timezone'], message: 'Choose a timezone from the list, such as Asia/Kolkata.' })
  }
  if (value.status === 'published') {
    for (const issue of publicationIssues(value)) {
      context.addIssue({ code: 'custom', path: [issue.field], message: issue.message, params: { publication: true } })
    }
  }
}).transform((value): CalendarEventInput => ({
  ...value,
  // Store only the details that apply to the chosen attendance type and pricing.
  meetingUrl: value.format === 'in_person' ? null : value.meetingUrl,
  locationName: value.format === 'online' ? null : value.locationName,
  locationAddress: value.format === 'online' ? null : value.locationAddress,
  city: value.format === 'online' ? null : value.city,
  country: value.format === 'online' ? null : value.country,
  priceMinor: value.pricing === 'paid' ? value.priceMinor : null,
  currency: value.pricing === 'paid' ? value.currency : null,
}))

export function parseCalendarEventInput(input: unknown) {
  return calendarEventInputSchema.safeParse(input)
}

/** First message for each field, for showing next to the matching input. */
export function calendarFieldErrors(error: z.ZodError): CalendarFieldErrors {
  const fieldErrors: CalendarFieldErrors = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== 'string') continue
    const key = field as CalendarEventField
    if (!fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return fieldErrors
}

function isPublicationIssue(issue: z.core.$ZodIssue) {
  return issue.code === 'custom' && Boolean((issue as { params?: { publication?: boolean } }).params?.publication)
}

/** One sentence summarising what to fix. Lists every missing item when publishing is blocked. */
export function calendarValidationMessage(error: z.ZodError) {
  const publication = error.issues.filter(isPublicationIssue)
  const other = error.issues.filter((issue) => !isPublicationIssue(issue))
  if (other.length) {
    return other.length === 1 && !publication.length
      ? other[0]!.message
      : `Please fix ${other.length + publication.length} items: ${[...other, ...publication].map((issue) => issue.message.replace(/\.$/, '')).join('; ')}.`
  }
  if (publication.length) {
    return `This event can't be published yet. ${publication.map((issue) => issue.message).join(' ')} You can save it as a draft in the meantime.`
  }
  return 'Please check the event details and try again.'
}
