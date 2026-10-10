import { icsFileName } from '@/lib/calendar/ics'
import { sessionIcsEvent, sessionsCalendar } from '@/features/learning/sessions/session-calendar'
import { sessionRepository } from '@/features/learning/sessions/session-repository'
import { SESSION_UUID, sessionTextResponse, sessionViewer } from '@/features/learning/sessions/session-viewer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Round D (D2): one live session as an .ics file, for a learner in its batch or the batch's staff. */
export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const viewer = await sessionViewer()
  if (!viewer) return sessionTextResponse('Sign in to add this session to your calendar.', 401)
  const { sessionId } = await params
  if (!SESSION_UUID.test(sessionId)) return sessionTextResponse('Not found', 404)
  const found = await sessionRepository.getForViewer(viewer, sessionId)
  if (!found) return sessionTextResponse('Not found', 404)
  const body = sessionsCalendar(found.courseTitle, [sessionIcsEvent(found.session, found)])
  return new Response(body, {
    status: 200,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFileName(found.session.title)}.ics"`,
    },
  })
}
