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

/**
 * Inline photos and videos redirect to an hour-stable signed URL, so the browser may keep the
 * redirect itself for half an hour instead of repeating auth + database lookup on every view.
 */
const INLINE_MEDIA_HEADERS = {
  ...PRIVATE_HEADERS,
  'Cache-Control': 'private, max-age=1800',
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
 * signed storage URL. Photos and videos shown inline redirect to a cacheable
 * hour-stable URL and the redirect may be kept privately for 30 minutes; error
 * responses and `?download=1` are never cached and use a five-minute URL.
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
      ...(result.inline ? INLINE_MEDIA_HEADERS : PRIVATE_HEADERS),
      Location: result.url,
    },
  })
}
