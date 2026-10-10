import { z } from 'zod'
import { isValidTimeZone } from '../sessions/session-time'

/**
 * Learning round D (D1): batches (cohorts). A course with batch_mode 'batches' runs as dated batches; every other
 * course stays self-paced exactly as before. Pure rules shared by the repository, the actions and the pages.
 */

export const BATCH_STATUSES = ['upcoming', 'running', 'completed', 'archived'] as const
export type BatchStatus = (typeof BATCH_STATUSES)[number]

export type BatchMode = 'self_paced' | 'batches'
export type DripAnchor = 'enrolment' | 'batch_start'

export type CourseBatchSettings = {
  batchMode: BatchMode
  dripAnchor: DripAnchor
  /** Null = no attendance rule for the certificate. */
  minAttendancePercent: number | null
}

export type CourseBatch = {
  id: string
  courseId: string
  title: string
  startsAt: string
  endsAt: string | null
  seatLimit: number | null
  timeZone: string
  status: BatchStatus
  enrolmentOpen: boolean
  managerProfileId: string | null
  managerName: string | null
  /** Active or completed enrolments in the batch. */
  enrolledCount: number
  /** Checkouts for this batch still awaiting payment (younger than the hold window). */
  heldCount: number
}

/** A checkout awaiting payment holds its seat this long. */
export const BATCH_SEAT_HOLD_MINUTES = 30

/** Seats still free, or null for a batch without a limit. Never negative (a paid order can go over the limit). */
export function seatsLeft(batch: Pick<CourseBatch, 'seatLimit' | 'enrolledCount' | 'heldCount'>): number | null {
  if (batch.seatLimit === null) return null
  return Math.max(0, batch.seatLimit - batch.enrolledCount - batch.heldCount)
}

export type BatchClosedReason = 'archived' | 'completed' | 'enrolment_closed' | 'full'

/** Why a learner cannot join this batch now, or null when they can. */
export function batchClosedReason(batch: Pick<CourseBatch, 'status' | 'enrolmentOpen' | 'seatLimit' | 'enrolledCount' | 'heldCount'>): BatchClosedReason | null {
  if (batch.status === 'archived') return 'archived'
  if (batch.status === 'completed') return 'completed'
  if (!batch.enrolmentOpen) return 'enrolment_closed'
  const left = seatsLeft(batch)
  if (left !== null && left <= 0) return 'full'
  return null
}

export function batchClosedLabel(reason: BatchClosedReason) {
  switch (reason) {
    case 'full':
      return 'Full'
    case 'completed':
      return 'Finished'
    case 'archived':
      return 'Not available'
    case 'enrolment_closed':
      return 'Enrolment closed'
  }
}

export function batchStatusLabel(status: BatchStatus) {
  switch (status) {
    case 'upcoming':
      return 'Upcoming'
    case 'running':
      return 'Running'
    case 'completed':
      return 'Completed'
    case 'archived':
      return 'Archived'
  }
}

/**
 * The status the sweep moves a batch to, or null to leave it: upcoming → running once it starts; running → completed
 * after its end date, or (without one) a day after its last session. Completed and archived batches are left alone,
 * and a manager's choice is never moved backwards.
 */
export function nextBatchStatus(
  batch: Pick<CourseBatch, 'status' | 'startsAt' | 'endsAt'> & { lastSessionEndsAt?: string | null },
  now: Date,
): BatchStatus | null {
  const time = now.getTime()
  if (batch.status === 'upcoming' && Date.parse(batch.startsAt) <= time) {
    return batchHasEnded(batch, time) ? 'completed' : 'running'
  }
  if (batch.status === 'running' && batchHasEnded(batch, time)) return 'completed'
  return null
}

const DAY_MS = 24 * 60 * 60 * 1000

function batchHasEnded(batch: { endsAt: string | null; lastSessionEndsAt?: string | null }, time: number) {
  if (batch.endsAt) return Date.parse(batch.endsAt) <= time
  if (batch.lastSessionEndsAt) return Date.parse(batch.lastSessionEndsAt) + DAY_MS <= time
  return false
}

/** The date a drip lesson opens: counted from the batch start when the course says so and the learner has a batch. */
export function dripAnchorDate(input: { dripAnchor: DripAnchor; enrolledAt: Date; batchStartsAt: Date | null }) {
  return input.dripAnchor === 'batch_start' && input.batchStartsAt ? input.batchStartsAt : input.enrolledAt
}

export const timeZoneSchema = z.string().trim().min(1).max(64).refine(isValidTimeZone, 'Choose a time zone from the list.')

const isoInstant = z.string().trim().refine((value) => Number.isFinite(Date.parse(value)), 'Enter a valid date and time.')

export const batchSettingsSchema = z.object({
  batchMode: z.enum(['self_paced', 'batches']),
  dripAnchor: z.enum(['enrolment', 'batch_start']),
  minAttendancePercent: z.number().int().min(1, 'Minimum attendance must be between 1 and 100%.').max(100, 'Minimum attendance must be between 1 and 100%.').nullable(),
})

export const batchInputSchema = z.object({
  title: z.string().trim().min(2, 'Give the batch a name of at least 2 characters.').max(120, 'Keep the batch name under 120 characters.'),
  startsAt: isoInstant,
  endsAt: isoInstant.nullable(),
  seatLimit: z.number().int().min(1, 'The seat limit must be at least 1.').max(10000, 'The seat limit can be at most 10,000.').nullable(),
  timeZone: timeZoneSchema,
  enrolmentOpen: z.boolean(),
  status: z.enum(BATCH_STATUSES),
}).refine((value) => !value.endsAt || Date.parse(value.endsAt) > Date.parse(value.startsAt), {
  message: 'The end date must be after the start.',
  path: ['endsAt'],
})

export type BatchInput = z.infer<typeof batchInputSchema>

/** "Starts Mon 13 Oct 2026 · Asia/Kolkata": a batch start shown in the batch's own time zone, with the zone named. */
export function batchStartLabel(batch: Pick<CourseBatch, 'startsAt' | 'timeZone'>) {
  const date = new Date(batch.startsAt)
  try {
    const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: batch.timeZone }).format(date)
    return `Starts ${day.replace(',', '')} · ${batch.timeZone}`
  } catch {
    return `Starts ${date.toISOString().slice(0, 10)} · UTC`
  }
}

/** What a learner is told when a batch cannot take them (enrolment, checkout, trainer enrolment). */
export function batchRefusalMessage(code: string): string | null {
  switch (code) {
    case 'batch_required':
      return 'Choose a batch to join.'
    case 'batch_not_found':
      return 'That batch is no longer available. Choose another batch.'
    case 'full':
      return 'That batch is full. Choose another batch.'
    case 'enrolment_closed':
      return 'Enrolment for that batch is closed. Choose another batch.'
    case 'completed':
    case 'archived':
      return 'That batch has finished. Choose another batch.'
    default:
      return null
  }
}
