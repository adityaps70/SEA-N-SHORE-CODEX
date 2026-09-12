export const CALENDAR_EVENT_FORMATS = ['online', 'in_person', 'hybrid'] as const
export const CALENDAR_EVENT_STATUSES = ['draft', 'published', 'cancelled'] as const
export const CALENDAR_EVENT_CATEGORIES = ['training', 'safety', 'technical', 'regulatory', 'careers', 'leadership', 'networking', 'community'] as const
export const CALENDAR_EVENT_TYPES = ['webinar', 'masterclass', 'conference', 'workshop', 'meetup', 'networking', 'community'] as const
export const CALENDAR_REGISTRATION_MODES = ['open', 'closed'] as const

export type CalendarEventFormat = typeof CALENDAR_EVENT_FORMATS[number]
export type CalendarEventStatus = typeof CALENDAR_EVENT_STATUSES[number]
export type CalendarEventCategory = typeof CALENDAR_EVENT_CATEGORIES[number]
export type CalendarEventType = typeof CALENDAR_EVENT_TYPES[number]
export type CalendarRegistrationMode = typeof CALENDAR_REGISTRATION_MODES[number]
export type EditableCalendarEventStatus = Exclude<CalendarEventStatus, 'cancelled'>

export type CalendarSpeakerDetail = {
  name: string
  title: string
  organization: string
}

export type CalendarEventFilters = {
  search?: string
  category?: CalendarEventCategory
  eventType?: CalendarEventType
  format?: CalendarEventFormat
  location?: string
}

export type CalendarEventInput = {
  title: string
  summary: string
  description: string
  category: CalendarEventCategory
  eventType: CalendarEventType
  format: CalendarEventFormat
  status: EditableCalendarEventStatus
  startAt: string
  endAt: string
  timezone: string
  locationName: string | null
  locationAddress: string | null
  city: string | null
  country: string | null
  meetingUrl: string | null
  topics: string[]
  agenda: string[]
  speakers: string[]
  speakerDetails: CalendarSpeakerDetail[]
  capacity: number | null
  bannerUrl: string | null
  registrationMode: CalendarRegistrationMode
  registrationClosesAt: string | null
}

export type CalendarEvent = Omit<CalendarEventInput, 'status'> & {
  id: string
  hostUserId: string
  hostName: string
  hostSlug: string | null
  status: CalendarEventStatus
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
