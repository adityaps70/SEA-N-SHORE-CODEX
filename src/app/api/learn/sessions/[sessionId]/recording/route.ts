import { createMediaReadUrl } from '@/lib/aws/storage'
import { sessionRepository } from '@/features/learning/sessions/session-repository'
import { SESSION_UUID, sessionTextResponse, sessionViewer } from '@/features/learning/sessions/session-viewer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Round D (D2): a session's recording, for a learner in its batch or its staff: a short-lived signed URL, or the link. */
export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const viewer = await sessionViewer()
  if (!viewer) return sessionTextResponse('Sign in to watch this recording.', 401)
  const { sessionId } = await params
  if (!SESSION_UUID.test(sessionId)) return sessionTextResponse('Not found', 404)
  const found = await sessionRepository.getForViewer(viewer, sessionId)
  const recording = found?.session.recording
  if (!found || !recording) return sessionTextResponse('Not found', 404)
  const location = recording.kind === 'link' ? recording.url : found.recordingPath ? await createMediaReadUrl(found.recordingPath) : null
  if (!location) return sessionTextResponse('Not found', 404)
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } })
}
