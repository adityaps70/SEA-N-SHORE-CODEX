import {
  AwsAuthenticationRequiredError,
  requireAwsUser,
} from '@/features/auth/aws-queries'
import { createRealtimeTicketCodec } from '@/features/realtime/ticket'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REALTIME_AUDIENCE = 'sea-n-shore-realtime'
const REALTIME_TTL_SECONDS = 60

function getRealtimeTicketSecret() {
  const secret = process.env.REALTIME_TICKET_SECRET?.trim()
  if (!secret) {
    throw new Error('Realtime ticket secret is not configured.')
  }
  return secret
}

export async function POST() {
  try {
    const user = await requireAwsUser()
    const codec = createRealtimeTicketCodec({
      secret: getRealtimeTicketSecret(),
      audience: REALTIME_AUDIENCE,
      ttlSeconds: REALTIME_TTL_SECONDS,
    })
    const issued = codec.issue({
      profileId: user.id,
      now: new Date(),
    })

    return Response.json(issued, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) {
      return Response.json(
        { error: error.message },
        {
          status: 401,
          headers: {
            'Cache-Control': 'private, no-store',
          },
        },
      )
    }

    throw error
  }
}
