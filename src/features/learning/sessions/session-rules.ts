import { z } from 'zod'
import { addDays, isoWeekday, isValidTimeZone, zonedLocalToUtc } from './session-time'

/**
 * Learning round D (D2): live sessions of a batch. Pure rules shared by the repository, the actions, the sweep and the
 * pages. Times are UTC instants; a session is entered as a local date and time in a chosen zone.
 */

export const SESSION_LIMITS = { minMinutes: 5, maxMinutes: 600, maxWeeks: 52, maxSeriesSessions: 100 } as const

/** Learners can open Join this long before the start; it stays open until the session ends. */
export const JOIN_OPENS_MINUTES_BEFORE = 15

export type SessionStatus = 'scheduled' | 'cancelled'
export type AttendanceMark = 'present' | 'absent' | 'excused'

export type BatchSession = {
  id: string
  batchId: string
  seriesId: string | null
  title: string
  description: string | null
  startsAt: string
  durationMinutes: number
  meetingUrl: string | null
  status: SessionStatus
  recording: { kind: 'link'; url: string } | { kind: 'upload'; contentType: string } | null
}

const meetingUrlSchema = z
  .string()
  .trim()
  .max(2048, 'Keep the meeting link under 2,048 characters.')
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && Boolean(url.hostname)
    } catch {
      return false
    }
  }, 'Paste the full meeting link, starting with https:// (Zoom, Google Meet, Teams or any other).')

const titleSchema = z.string().trim().min(2, 'Give the session a title of at least 2 characters.').max(160, 'Keep the title under 160 characters.')
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.')
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Choose a time.')
const zoneSchema = z.string().refine(isValidTimeZone, 'Choose a time zone from the list.')
const durationSchema = z
  .number()
  .int('Enter the length in whole minutes.')
  .min(SESSION_LIMITS.minMinutes, `A session lasts at least ${SESSION_LIMITS.minMinutes} minutes.`)
  .max(SESSION_LIMITS.maxMinutes, `A session lasts at most ${SESSION_LIMITS.maxMinutes / 60} hours.`)

export const sessionInputSchema = z.object({
  title: titleSchema,
  description: z.string().trim().max(2000, 'Keep the description under 2,000 characters.').nullable(),
  date: dateSchema,
  time: timeSchema,
  timeZone: zoneSchema,
  durationMinutes: durationSchema,
  meetingUrl: meetingUrlSchema.nullable(),
})
export type SessionInput = z.infer<typeof sessionInputSchema>

export const seriesInputSchema = z.object({
  title: titleSchema,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, 'Choose at least one day of the week.').max(7),
  time: timeSchema,
  timeZone: zoneSchema,
  firstDate: dateSchema,
  weekCount: z.number().int().min(1, 'Repeat for at least 1 week.').max(SESSION_LIMITS.maxWeeks, `Repeat for at most ${SESSION_LIMITS.maxWeeks} weeks.`),
  durationMinutes: durationSchema,
  meetingUrl: meetingUrlSchema.nullable(),
})
export type SeriesInput = z.infer<typeof seriesInputSchema>

export const recordingLinkSchema = z.object({ url: meetingUrlSchema })

/** The UTC start of a one-off session, or null when the date and time do not exist. */
export function sessionStartUtc(input: Pick<SessionInput, 'date' | 'time' | 'timeZone'>) {
  return zonedLocalToUtc(input.date, input.time, input.timeZone)
}

/**
 * Every session of a weekly series: on the chosen weekdays, from the first date for the number of weeks, at the same
 * wall-clock time in the zone (so a session stays at 19:00 local across daylight-saving changes). Numbered titles
 * ("Title · 3"). Null when the series is too long.
 */
export function seriesOccurrences(input: SeriesInput): { title: string; startsAt: Date }[] | null {
  const firstWeekday = isoWeekday(input.firstDate)
  if (firstWeekday === null) return []
  const days = [...new Set(input.weekdays)].sort((a, b) => a - b)
  const dates: string[] = []
  for (let offset = 0; offset < input.weekCount * 7; offset += 1) {
    const date = addDays(input.firstDate, offset)
    if (!date) continue
    const weekday = isoWeekday(date)
    if (weekday !== null && days.includes(weekday)) dates.push(date)
  }
  if (dates.length > SESSION_LIMITS.maxSeriesSessions) return null
  const occurrences: { title: string; startsAt: Date }[] = []
  for (const date of dates) {
    const startsAt = zonedLocalToUtc(date, input.time, input.timeZone)
    if (startsAt) occurrences.push({ title: input.title, startsAt })
  }
  return occurrences.map((occurrence, index) => ({ ...occurrence, title: `${occurrence.title} · ${index + 1}` }))
}

export function sessionEndsAt(session: Pick<BatchSession, 'startsAt' | 'durationMinutes'>) {
  return new Date(Date.parse(session.startsAt) + session.durationMinutes * 60_000)
}

/** Whether Join is open now: from 15 minutes before the start until the end of a scheduled session with a link. */
export function joinState(session: Pick<BatchSession, 'startsAt' | 'durationMinutes' | 'status' | 'meetingUrl'>, now: Date): 'cancelled' | 'no_link' | 'not_yet' | 'open' | 'ended' {
  if (session.status === 'cancelled') return 'cancelled'
  const start = Date.parse(session.startsAt)
  if (now.getTime() > sessionEndsAt(session).getTime()) return 'ended'
  if (now.getTime() < start - JOIN_OPENS_MINUTES_BEFORE * 60_000) return 'not_yet'
  return session.meetingUrl ? 'open' : 'no_link'
}

export type AttendanceRecord = {
  /** Session start and state; only scheduled sessions count. */
  startsAt: string
  status: SessionStatus
  mark: AttendanceMark | null
  joined: boolean
}

/**
 * Attendance for the certificate rule. Every scheduled session of the batch counts, including future ones, so the
 * certificate waits until enough sessions are attended. Excused sessions are left out. A learner who joined counts as
 * present until the trainer marks them otherwise.
 */
export function attendanceSummary(records: readonly AttendanceRecord[]) {
  const counted = records.filter((record) => record.status === 'scheduled' && record.mark !== 'excused')
  const attended = counted.filter((record) => record.mark === 'present' || (record.mark === null && record.joined)).length
  const total = counted.length
  return { attended, total, percent: total === 0 ? 100 : Math.floor((attended * 100) / total) }
}

export function attendanceRuleMet(required: number | null, summary: { attended: number; total: number }) {
  if (required === null || summary.total === 0) return true
  return summary.attended * 100 >= required * summary.total
}

/** The learner's status for one session, as shown in their Sessions tab. */
export function learnerSessionStatus(session: Pick<BatchSession, 'startsAt' | 'durationMinutes' | 'status'>, mark: AttendanceMark | null, joined: boolean, now: Date) {
  if (session.status === 'cancelled') return 'Cancelled'
  if (mark === 'present') return 'Attended'
  if (mark === 'excused') return 'Excused'
  if (mark === 'absent') return 'Absent'
  if (now.getTime() < Date.parse(session.startsAt)) return 'Upcoming'
  if (now.getTime() <= sessionEndsAt(session).getTime()) return joined ? 'Joined' : 'Live now'
  return joined ? 'Attended' : 'Absent'
}

export type ReminderStage = '24h' | '1h'

/**
 * Which reminder is due for a session now: the 1-hour reminder within the last hour before the start, the 24-hour
 * reminder from 24 hours until 1 hour before. Null once it has started (or more than a day away).
 */
export function reminderStageDue(startsAt: string, now: Date): ReminderStage | null {
  const lead = Date.parse(startsAt) - now.getTime()
  if (lead <= 0) return null
  if (lead <= 60 * 60_000) return '1h'
  if (lead <= 24 * 60 * 60_000) return '24h'
  return null
}
