export const CALENDAR_EVENT_FORMATS = ['online', 'in_person', 'hybrid'] as const
export const CALENDAR_EVENT_STATUSES = ['draft', 'published', 'cancelled'] as const

export type CalendarEventFormat = typeof CALENDAR_EVENT_FORMATS[number]
export type CalendarEventStatus = typeof CALENDAR_EVENT_STATUSES[number]
export type EditableCalendarEventStatus = Exclude<CalendarEventStatus, 'cancelled'>

export type CalendarEventInput = {
  title: string
  summary: string
  description: string
  format: CalendarEventFormat
  status: EditableCalendarEventStatus
  startAt: string
  endAt: string
  timezone: string
  locationName: string | null
  locationAddress: string | null
  meetingUrl: string | null
  topics: string[]
  speakers: string[]
  capacity: number | null
  bannerUrl: string | null
}

export type CalendarEvent = {
  id: string
  hostUserId: string
  hostName: string
  hostSlug: string | null
  title: string
  summary: string
  description: string
  format: CalendarEventFormat
  status: CalendarEventStatus
  startAt: string
  endAt: string
  timezone: string
  locationName: string | null
  locationAddress: string | null
  meetingUrl: string | null
  topics: string[]
  speakers: string[]
  capacity: number | null
  bannerUrl: string | null
  attendeeCount: number
  viewerIsAttending: boolean
  viewerIsHost: boolean
  createdAt: string
  updatedAt: string
}

export type CalendarActionResult =
  | { ok: true }
  | { ok: false; error: string }

export type CalendarCreateResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string }
