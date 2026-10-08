import { AwsAuthenticationRequiredError, requireAwsUser } from '@/features/auth/aws-queries'
import { createAssignmentAttachmentDownloadUrl } from '@/features/learning/assignment-attachments'
import { learnerAssignmentRepository } from '@/features/learning/learner-assignment-repository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Downloads a file a learner attached to an assignment. Only the learner, the course's trainers
 * (and its organization's owners, administrators and LMS managers) and platform administrators
 * get a redirect to a five-minute signed URL; everyone else gets 404, so the file's existence is
 * not revealed. Nothing here is cached.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  const { attachmentId } = await context.params
  if (!UUID_PATTERN.test(attachmentId)) {
    return Response.json({ error: 'This file is not available.' }, { status: 404, headers: PRIVATE_HEADERS })
  }

  let viewerId: string
  try {
    viewerId = (await requireAwsUser()).id
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) {
      return Response.json({ error: 'Please sign in to download this file.' }, { status: 401, headers: PRIVATE_HEADERS })
    }
    throw error
  }

  const attachment = await learnerAssignmentRepository.getAttachmentForViewer(viewerId, attachmentId)
  if (!attachment) {
    return Response.json({ error: 'This file is not available.' }, { status: 404, headers: PRIVATE_HEADERS })
  }

  const url = await createAssignmentAttachmentDownloadUrl(attachment)
  return new Response(null, { status: 302, headers: { ...PRIVATE_HEADERS, Location: url } })
}
