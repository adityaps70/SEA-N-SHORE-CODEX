import { getVerifiedUser } from '@/features/auth/queries'
import { createDgProfileDownloadForViewer } from '@/features/profiles/profile-document-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const PRIVATE_HEADERS = {
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

function message(status: number, text: string) {
  return new Response(text, {
    status,
    headers: { ...PRIVATE_HEADERS, 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * Opens a member's private DG Shipping profile PDF. Only the owner, platform
 * administrators and hiring reviewers for a job the member applied to get a
 * link; it is a signed S3 URL that expires after a minute. Everyone else gets
 * the same "not available" answer whether or not a document exists.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ profileId: string }> },
): Promise<Response> {
  const viewer = await getVerifiedUser()
  if (!viewer) return message(401, 'Sign in to Sea N Shore to open this document.')

  const { profileId } = await context.params
  if (!UUID_PATTERN.test(profileId)) return message(404, 'This document is not available.')

  try {
    const download = await createDgProfileDownloadForViewer(viewer.id, profileId)
    if (download.status !== 'ok') return message(404, 'This document is not available.')
    return new Response(null, {
      status: 302,
      headers: { ...PRIVATE_HEADERS, location: download.url },
    })
  } catch {
    return message(503, 'We could not open this document right now. Please try again in a moment.')
  }
}
