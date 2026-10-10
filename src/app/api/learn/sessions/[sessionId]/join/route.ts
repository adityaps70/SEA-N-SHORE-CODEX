import { joinState } from '@/features/learning/sessions/session-rules'
import { sessionRepository } from '@/features/learning/sessions/session-repository'
import { SESSION_UUID, sessionTextResponse, sessionViewer } from '@/features/learning/sessions/session-viewer'
import { siteUrlFor } from '@/lib/site-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } })
}

/**
 * Round D (D2): Join. For a learner in the batch, while Join is open (15 minutes before the start until the end), the
 * join time is recorded and the browser goes to the meeting link. Staff go straight to the link. Otherwise the learner
 * returns to their Sessions tab, which says why Join is not open.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const viewer = await sessionViewer()
  if (!viewer) return redirect(siteUrlFor('/auth/sign-in').toString())
  const { sessionId } = await params
  if (!SESSION_UUID.test(sessionId)) return sessionTextResponse('Not found', 404)
  const found = await sessionRepository.getForViewer(viewer, sessionId)
  if (!found) return sessionTextResponse('Not found', 404)
  const state = joinState(found.session, new Date())
  const back = siteUrlFor(`/learn/courses/${found.courseSlug}/learn?tab=sessions&join=${state}`).toString()
  if (state !== 'open' || !found.session.meetingUrl) return redirect(back)
  if (found.enrollmentId) await sessionRepository.recordJoin(viewer.actorId, found.enrollmentId, sessionId)
  return redirect(found.session.meetingUrl)
}
