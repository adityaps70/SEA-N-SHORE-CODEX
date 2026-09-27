import { AwsAuthenticationRequiredError, requireAwsUser } from '@/features/auth/aws-queries'
import { createMessageAttachmentAccess } from '@/features/messaging/attachment-access'
import { createMessageAttachmentReadUrl } from '@/features/messaging/media'
import { messagingRepository } from '@/features/messaging/repository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

const resolveMessageAttachment = createMessageAttachmentAccess({
  requireUser: requireAwsUser,
  isAuthenticationError: (error) => error instanceof AwsAuthenticationRequiredError,
  findMessageForParticipant: (profileId, messageId) => (
    messagingRepository.findMessageAccessibleToParticipant(profileId, messageId)
  ),
  createReadUrl: createMessageAttachmentReadUrl,
})

/**
 * Serves a private message attachment. The viewer must be signed in and a
 * participant of the message's conversation; the response is a redirect to a
 * five-minute signed storage URL and is never cached.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ messageId: string }> },
) {
  const { messageId } = await context.params
  const download = new URL(request.url).searchParams.get('download') === '1'

  const result = await resolveMessageAttachment({ messageId, download })
  if (!result.ok) {
    return Response.json(
      {
        error: result.status === 401
          ? 'Please sign in to view this attachment.'
          : 'This attachment is not available.',
      },
      { status: result.status, headers: PRIVATE_HEADERS },
    )
  }

  return new Response(null, {
    status: 302,
    headers: {
      ...PRIVATE_HEADERS,
      Location: result.url,
    },
  })
}
