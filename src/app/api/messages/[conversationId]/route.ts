import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { getConversationThread } from '@/features/messaging/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
}

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    {
      status,
      headers: NO_STORE_HEADERS,
    },
  )
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId } = await context.params

  try {
    const thread = await getConversationThread({
      conversationId,
      limit: 30,
    })
    return Response.json(thread, {
      status: 200,
      headers: NO_STORE_HEADERS,
    })
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) {
      return jsonError(error.message, 401)
    }
    if (error instanceof Error) {
      if (error.message === 'messaging_invalid_thread_request') {
        return jsonError(error.message, 400)
      }
      if (error.message === 'messaging_not_participant') {
        return jsonError(error.message, 403)
      }
    }
    throw error
  }
}
