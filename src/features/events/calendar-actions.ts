'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import type { CalendarActionResult, CalendarCreateResult, CalendarEventInput } from './calendar-types'
import { calendarEventRepository } from './calendar-repository'
import { calendarValidationMessage, parseCalendarEventInput } from './calendar-validation'

const uuidSchema = z.string().uuid()

function refreshEventPaths(eventId?: string) {
  revalidatePath('/events')
  revalidatePath('/events/my')
  revalidatePath('/events/hosting')
  if (eventId) {
    revalidatePath(`/events/${eventId}`)
    revalidatePath(`/events/${eventId}/edit`)
  }
}

function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  if (code === 'event_forbidden') return 'Only the event host can make this change.'
  if (code === 'event_not_found') return 'This event is no longer available.'
  if (code === 'event_host_cannot_attend') return 'Hosts are already part of their own event.'
  if (code === 'event_not_open') return 'Registration is not open for this event.'
  if (code === 'event_full') return 'This event has reached its attendee capacity.'
  return 'Something went wrong. Please try again.'
}

export async function createEventAction(input: CalendarEventInput): Promise<CalendarCreateResult> {
  const parsed = parseCalendarEventInput(input)
  if (!parsed.success) return { ok: false, error: calendarValidationMessage(parsed.error) }
  try {
    const user = await requireAwsUser()
    const eventId = await calendarEventRepository.createEvent(user.id, parsed.data)
    refreshEventPaths(eventId)
    return { ok: true, eventId }
  } catch (error) {
    console.error('calendar_event_create_failed', error)
    return { ok: false, error: safeError(error) }
  }
}

export async function updateEventAction(eventId: string, input: CalendarEventInput): Promise<CalendarActionResult> {
  const id = uuidSchema.safeParse(eventId)
  const parsed = parseCalendarEventInput(input)
  if (!id.success) return { ok: false, error: 'Invalid event.' }
  if (!parsed.success) return { ok: false, error: calendarValidationMessage(parsed.error) }
  try {
    const user = await requireAwsUser()
    await calendarEventRepository.updateEvent(user.id, id.data, parsed.data)
    refreshEventPaths(id.data)
    return { ok: true }
  } catch (error) {
    console.error('calendar_event_update_failed', error)
    return { ok: false, error: safeError(error) }
  }
}

export async function cancelEventAction(eventId: string): Promise<CalendarActionResult> {
  const id = uuidSchema.safeParse(eventId)
  if (!id.success) return { ok: false, error: 'Invalid event.' }
  try {
    const user = await requireAwsUser()
    await calendarEventRepository.cancelEvent(user.id, id.data)
    refreshEventPaths(id.data)
    return { ok: true }
  } catch (error) {
    console.error('calendar_event_cancel_failed', error)
    return { ok: false, error: safeError(error) }
  }
}

export async function attendEventAction(eventId: string): Promise<CalendarActionResult> {
  const id = uuidSchema.safeParse(eventId)
  if (!id.success) return { ok: false, error: 'Invalid event.' }
  try {
    const user = await requireAwsUser()
    await calendarEventRepository.attendEvent(user.id, id.data)
    refreshEventPaths(id.data)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: safeError(error) }
  }
}

export async function withdrawEventAttendanceAction(eventId: string): Promise<CalendarActionResult> {
  const id = uuidSchema.safeParse(eventId)
  if (!id.success) return { ok: false, error: 'Invalid event.' }
  try {
    const user = await requireAwsUser()
    await calendarEventRepository.withdrawAttendance(user.id, id.data)
    refreshEventPaths(id.data)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: safeError(error) }
  }
}
