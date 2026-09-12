import { z } from 'zod'
import {
  CALENDAR_EVENT_CATEGORIES,
  CALENDAR_EVENT_FORMATS,
  CALENDAR_EVENT_TYPES,
  CALENDAR_REGISTRATION_MODES,
} from './calendar-types'

const webUrl = z.string().trim().url().max(2000).refine((value) => value.startsWith('https://') || value.startsWith('http://'), 'Use an http or https URL.')
const nullableUrl = webUrl.nullable()
const nullableText = (max: number) => z.string().trim().max(max).nullable()
const speakerDetailSchema = z.object({
  name: z.string().trim().min(1).max(160),
  title: z.string().trim().max(160),
  organization: z.string().trim().max(200),
})

export const calendarEventInputSchema = z.object({
  title: z.string().trim().min(2, 'Add an event title.').max(180),
  summary: z.string().trim().min(1, 'Add a short event summary.').max(600),
  description: z.string().trim().max(12000),
  category: z.enum(CALENDAR_EVENT_CATEGORIES),
  eventType: z.enum(CALENDAR_EVENT_TYPES),
  format: z.enum(CALENDAR_EVENT_FORMATS),
  status: z.enum(['draft', 'published']),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(120),
  locationName: nullableText(240),
  locationAddress: nullableText(500),
  city: nullableText(160),
  country: nullableText(160),
  meetingUrl: nullableUrl,
  topics: z.array(z.string().trim().min(1).max(120)).max(30),
  agenda: z.array(z.string().trim().min(1).max(500)).max(50),
  speakers: z.array(z.string().trim().min(1).max(160)).max(30),
  speakerDetails: z.array(speakerDetailSchema).max(30),
  capacity: z.number().int().min(1).max(1000000).nullable(),
  bannerUrl: nullableUrl,
  registrationMode: z.enum(CALENDAR_REGISTRATION_MODES),
  registrationClosesAt: z.string().datetime({ offset: true }).nullable(),
}).superRefine((value, context) => {
  const start = Date.parse(value.startAt)
  const end = Date.parse(value.endAt)
  if (end <= start) {
    context.addIssue({ code: 'custom', path: ['endAt'], message: 'Event end time must be after the start time.' })
  }
  if (value.registrationClosesAt && Date.parse(value.registrationClosesAt) > start) {
    context.addIssue({ code: 'custom', path: ['registrationClosesAt'], message: 'Registration must close before the event starts.' })
  }
  if ((value.format === 'online' || value.format === 'hybrid') && !value.meetingUrl) {
    context.addIssue({ code: 'custom', path: ['meetingUrl'], message: 'Add a meeting URL for online access.' })
  }
  if ((value.format === 'in_person' || value.format === 'hybrid') && !value.locationName) {
    context.addIssue({ code: 'custom', path: ['locationName'], message: 'Add the event venue.' })
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format(new Date(start))
  } catch {
    context.addIssue({ code: 'custom', path: ['timezone'], message: 'Use a valid IANA timezone, such as Asia/Kolkata.' })
  }
})

export function parseCalendarEventInput(input: unknown) {
  return calendarEventInputSchema.safeParse(input)
}

export function calendarValidationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? 'Please check the event details and try again.'
}
