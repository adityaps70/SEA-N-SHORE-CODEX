import {
  AwsAuthenticationRequiredError,
  requireAwsUser,
} from '@/features/auth/aws-queries'
import { messagingRepository } from '@/features/messaging/repository'
import { createTypingToken } from '@/features/realtime/typing-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'private, no-store' }

/** Round 14 (2.9): a typing token only for a member of the conversation, bound to its other participant. */
export async function POST(request: Request) {
  try {
    const user = await requireAwsUser()
    const body = await request.json().catch(() => null) as { conversationId?: unknown } | null
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : ''
    if (!UUID_RE.test(conversationId)) {
      return Response.json({ error: 'Invalid conversation.' }, { status: 400, headers: NO_STORE })
    }

    const targetProfileId = await messagingRepository.findOtherParticipantId(conversationId, user.id)
    if (!targetProfileId) {
      return Response.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE })
    }

    const issued = createTypingToken({ actorId: user.id, conversationId, targetProfileId })
    if (!issued) {
      return Response.json({ error: 'Typing is unavailable.' }, { status: 503, headers: NO_STORE })
    }

    return Response.json({ conversationId, targetProfileId, ...issued }, { status: 200, headers: NO_STORE })
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) {
      return Response.json({ error: error.message }, { status: 401, headers: NO_STORE })
    }
    throw error
  }
}
