import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { searchMessageRecipients } from '@/features/messaging/recipient-queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q') ?? ''

  try {
    const result = await searchMessageRecipients(query)
    return Response.json(result, { status: 200, headers: NO_STORE_HEADERS })
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) {
      return Response.json(
        { error: 'Please sign in again to search your connections.' },
        { status: 401, headers: NO_STORE_HEADERS },
      )
    }
    return Response.json(
      { error: 'We could not load your connections right now. Try again in a moment.' },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}
