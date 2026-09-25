'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { requireCapability } from '@/features/access/server'
import { assessPlatformText, automatedModerationDetails, moderationBlockMessage, type AutomatedModerationAssessment } from '@/features/moderation/automated'
import { moderationRepository } from '@/features/moderation/repository'
import { prepareEventBannerUpload, verifyEventBannerReference } from './event-banner-media'
import { validateEventBannerMetadata } from './event-banner-policy'
import type { CalendarActionResult, CalendarCreateResult, CalendarEventCreateInput, CalendarEventInput, EventBannerUploadResult } from './calendar-types'
import { calendarEventRepository } from './calendar-repository'
import { calendarValidationMessage, parseCalendarEventInput } from './calendar-validation'

const uuidSchema = z.string().uuid()
const eventPublisherSchema = z.discriminatedUnion('publisherType', [
  z.object({ publisherType: z.literal('personal'), companyId: z.null() }),
  z.object({ publisherType: z.literal('organization'), companyId: uuidSchema }),
])

function assessEventContent(input: CalendarEventInput): AutomatedModerationAssessment {
  if (input.status !== 'published') {
    return { decision: 'allow', category: null, reason: null, ruleIds: [] }
  }
  return assessPlatformText([
    input.title,
    input.summary,
    input.description,
    input.locationName,
    input.locationAddress,
    input.city,
    input.country,
    ...input.topics,
    ...input.agenda,
    ...input.speakers,
    ...input.speakerDetails.flatMap((speaker) => [speaker.name, speaker.title, speaker.organization]),
  ])
}

async function flagAutomatedEventModeration(eventId: string, assessment: AutomatedModerationAssessment) {
  if (assessment.decision !== 'review' || !assessment.reason) return
  const details = automatedModerationDetails(assessment)
  if (!details) return
  try {
    await moderationRepository.flagContentAutomatically({
      targetType: 'event',
      targetId: eventId,
      reason: assessment.reason,
      details,
    })
  } catch (error) {
    console.error('calendar_automated_moderation_flag_failed', {
      eventId,
      message: error instanceof Error ? error.message : null,
    })
  }
}

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
  if (code.startsWith('event_banner_')) return 'Please upload the banner image again.'
  if (code === 'capability_required') return 'Creator Pro or Organization Pro with verified event publishing access is required to publish events.'
  return 'Something went wrong. Please try again.'
}

export async function createEventBannerUploadAction(input: { mimeType: string; size: number }): Promise<EventBannerUploadResult> {
  const metadata = validateEventBannerMetadata(input)
  if (!metadata.ok) return { ok: false, error: metadata.error }
  try {
    const user = await requireAwsUser()
    const upload = await prepareEventBannerUpload({ profileId: user.id, mimeType: metadata.mimeType, size: metadata.size })
    return { ok: true, upload: { storagePath: upload.storagePath, uploadUrl: upload.uploadUrl } }
  } catch (error) {
    console.error('calendar_event_banner_presign_failed', error)
    return { ok: false, error: 'We could not prepare the banner upload. Please try again.' }
  }
}

export async function createEventAction(input: CalendarEventCreateInput): Promise<CalendarCreateResult> {
  const publisher = eventPublisherSchema.safeParse({
    publisherType: input.publisherType,
    companyId: input.companyId,
  })
  if (!publisher.success) return { ok: false, error: 'Choose a valid event publishing identity.' }

  const parsed = parseCalendarEventInput(input)
  if (!parsed.success) return { ok: false, error: calendarValidationMessage(parsed.error) }
  const moderation = assessEventContent(parsed.data)
  if (moderation.decision === 'block') return { ok: false, error: moderationBlockMessage() }
  try {
    const user = await requireAwsUser()
    if (parsed.data.status === 'published') {
      if (publisher.data.publisherType === 'personal') {
        await requireCapability(user.id, 'event.publish')
      } else {
        await requireCapability(user.id, 'event.publish', { companyId: publisher.data.companyId })
      }
    }
    await verifyEventBannerReference(user.id, parsed.data.bannerUrl)
    const eventId = await calendarEventRepository.createEvent(user.id, {
      ...parsed.data,
      ...publisher.data,
    })
    await flagAutomatedEventModeration(eventId, moderation)
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
  const moderation = assessEventContent(parsed.data)
  if (moderation.decision === 'block') return { ok: false, error: moderationBlockMessage() }
  try {
    const user = await requireAwsUser()
    if (parsed.data.status === 'published') await requireCapability(user.id, 'event.publish')
    await verifyEventBannerReference(user.id, parsed.data.bannerUrl)
    await calendarEventRepository.updateEvent(user.id, id.data, parsed.data)
    await flagAutomatedEventModeration(id.data, moderation)
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
