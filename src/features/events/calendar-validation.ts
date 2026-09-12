import { z } from 'zod'
import { CALENDAR_EVENT_FORMATS } from './calendar-types'

const nullableUrl = z.string().trim().url().max(2000).nullable()
const nullableText = (max: number) => z.string().trim().max(max).nullable()

export const calendarEventInputSchema = z.object({
  title: z.string().trim().min(2, 'Add an event title.').max(180),
  summary: z.string().trim().min(1, 'Add a short event summary.').max(600),
  description: z.string().trim().max(12000),
  format: z.enum(CALENDAR_EVENT_FORMATS),
  status: z.enum(['draft', 'published']),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(120),
  locationName: nullableText(240),
  locationAddress: nullableText(500),
  meetingUrl: nullableUrl,
  topics: z.array(z.string().trim().min(1).max(120)).max(30),
  speakers: z.array(z.string().trim().min(1).max(160)).max(30),
  capacity: z.number().int().min(1).max(1000000).nullable(),
  bannerUrl: nullableUrl,
}).superRefine((value, context) => {
  if (Date.parse(value.endAt) <= Date.parse(value.startAt)) {
    context.addIssue({ code: 'custom', path: ['endAt'], message: 'Event end time must be after the start time.' })
  }
  if ((value.format === 'online' || value.format === 'hybrid') && !value.meetingUrl) {
    context.addIssue({ code: 'custom', path: ['meetingUrl'], message: 'Add a meeting URL for online access.' })
  }
  if ((value.format === 'in_person' || value.format === 'hybrid') && !value.locationName) {
    context.addIssue({ code: 'custom', path: ['locationName'], message: 'Add the event venue.' })
  }
})

export function parseCalendarEventInput(input: unknown) {
  return calendarEventInputSchema.safeParse(input)
}

export function calendarValidationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? 'Please check the event details and try again.'
}
