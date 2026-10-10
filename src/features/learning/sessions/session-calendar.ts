import { buildIcsCalendar, type IcsEvent } from '@/lib/calendar/ics'
import { siteUrlFor } from '@/lib/site-url'
import { sessionEndsAt, type BatchSession } from './session-rules'

/** Learning round D (D2): "Add to calendar" files for a session or a whole batch. Times in UTC; apps show local time. */
export function sessionIcsEvent(session: BatchSession, context: { courseTitle: string; courseSlug: string; batchTitle: string }): IcsEvent {
  const sessionsUrl = siteUrlFor(`/learn/courses/${context.courseSlug}/learn?tab=sessions`).toString()
  const description = [
    `${context.courseTitle} · ${context.batchTitle}`,
    session.description,
    session.meetingUrl ? `Join: ${siteUrlFor(`/api/learn/sessions/${session.id}/join`).toString()}` : 'The meeting link will be in your Sessions tab.',
    `Your sessions: ${sessionsUrl}`,
  ].filter(Boolean).join('\n\n')
  return {
    uid: `learning-session-${session.id}@seanshore.in`,
    title: session.title,
    startsAt: session.startsAt,
    endsAt: sessionEndsAt(session),
    description,
    location: session.meetingUrl ? 'Online' : null,
    url: sessionsUrl,
    cancelled: session.status === 'cancelled',
  }
}

export function sessionsCalendar(name: string, events: IcsEvent[]) {
  return buildIcsCalendar({ name, events })
}
