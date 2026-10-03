import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { getConversationInbox, getUnreadMessageCount } from '@/features/messaging/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
}

export async function GET() {
  try {
    const [inbox, unreadCount] = await Promise.all([
      getConversationInbox({ limit: 100 }),
      getUnreadMessageCount(),
    ])

    return Response.json(
      { inbox, unreadCount },
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      },
    )
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) {
      return Response.json(
        { error: error.message },
        {
          status: 401,
          headers: NO_STORE_HEADERS,
        },
      )
    }

    throw error
  }
}
