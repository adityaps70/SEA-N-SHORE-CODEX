import { icsFileName } from '@/lib/calendar/ics'
import { sessionIcsEvent, sessionsCalendar } from '@/features/learning/sessions/session-calendar'
import { sessionRepository } from '@/features/learning/sessions/session-repository'
import { SESSION_UUID, sessionTextResponse, sessionViewer } from '@/features/learning/sessions/session-viewer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Round D (D2): every scheduled session of a batch as one .ics file, for its learners and staff. */
export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const viewer = await sessionViewer()
  if (!viewer) return sessionTextResponse('Sign in to add these sessions to your calendar.', 401)
  const { batchId } = await params
  if (!SESSION_UUID.test(batchId)) return sessionTextResponse('Not found', 404)
  const calendar = await sessionRepository.batchCalendar(viewer, batchId)
  if (!calendar) return sessionTextResponse('Not found', 404)
  const body = sessionsCalendar(`${calendar.courseTitle} · ${calendar.batchTitle}`, calendar.sessions.map((session) => sessionIcsEvent(session, calendar)))
  return new Response(body, {
    status: 200,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFileName(`${calendar.courseTitle} ${calendar.batchTitle}`)}.ics"`,
    },
  })
}
