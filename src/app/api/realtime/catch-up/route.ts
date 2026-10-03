import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { getConversationMessagesAfter } from '@/features/messaging/queries'

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

export async function POST(request: Request) {
  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    // The query schema below owns request validation and maps malformed JSON to 400.
  }

  try {
    const result = await getConversationMessagesAfter(body)
    return Response.json(result, {
      status: 200,
      headers: NO_STORE_HEADERS,
    })
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) {
      return jsonError(error.message, 401)
    }

    if (error instanceof Error) {
      if (error.message === 'messaging_invalid_catchup_request') {
        return jsonError(error.message, 400)
      }
      if (error.message === 'messaging_not_participant') {
        return jsonError(error.message, 403)
      }
    }

    throw error
  }
}
