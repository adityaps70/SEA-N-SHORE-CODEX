import { getVerifiedUser } from '@/features/auth/queries'
import { POST_DOCUMENT_MAX_BYTES } from '@/features/feed/media-policy'
import { feedRepository } from '@/features/feed/repository'
import { createMediaDownloadUrl, getMediaObject } from '@/lib/aws/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
}

const NOT_FOUND_HEADERS = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }

type FeedMediaKey = { key: string; profileId: string; postId: string; contentType: string }

function canonicalFeedMediaKey(parts: string[]): FeedMediaKey | null {
  if (parts.length !== 3) return null
  const [profileId, postId, filename] = parts
  if (!profileId || !postId || !filename) return null
  if (!UUID_PATTERN.test(profileId) || !UUID_PATTERN.test(postId)) return null

  const match = filename.match(/^([0-9a-f-]+)\.([a-z0-9]+)$/i)
  if (!match) return null

  const [, objectId, extensionRaw] = match
  if (!objectId || !UUID_PATTERN.test(objectId)) return null
  const extension = extensionRaw?.toLowerCase() ?? ''
  const contentType = CONTENT_TYPE_BY_EXTENSION[extension]
  if (!contentType) return null

  return { key: `${profileId}/${postId}/${objectId}.${extension}`, profileId, postId, contentType }
}

/**
 * Post photos, videos and documents. Round 14 (2.2): the viewer must be able to see the post (the
 * feed's own visibility rules: blocks, private groups, deleted posts). Photos and videos redirect
 * to an hour-stable signed S3 URL instead of passing through the web task (which held up to
 * 200 MB in memory per request); S3 answers Range requests, so videos seek on iOS, and the
 * redirect may be kept privately for 30 minutes. PDFs (at most 25 MB) are still served from this
 * origin: the document carousel reads them with pdf.js, and a cross-origin read would need
 * bucket CORS for GET.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const user = await getVerifiedUser()

  const { path } = await context.params
  const media = canonicalFeedMediaKey(path)
  if (!media) return new Response(null, { status: user ? 404 : 401, headers: NOT_FOUND_HEADERS })

  try {
    // Round F: signed out, only the media of a post its author shows to anyone (shared links, public profiles).
    const visible = user
      ? await feedRepository.isPostVisibleTo(user.id, media.postId, media.profileId)
      : await feedRepository.isPostPublic(media.postId, media.profileId)
    if (!visible) {
      return new Response(null, { status: user ? 404 : 401, headers: NOT_FOUND_HEADERS })
    }
    if (media.contentType === 'application/pdf') {
      const object = await getMediaObject({ key: media.key, maxBytes: POST_DOCUMENT_MAX_BYTES })
      return new Response(Uint8Array.from(object.body).buffer, {
        status: 200,
        headers: {
          'cache-control': 'private, max-age=3600',
          'content-length': String(object.contentLength),
          'content-type': 'application/pdf',
          'content-disposition': 'inline',
          'x-content-type-options': 'nosniff',
        },
      })
    }
    const location = await createMediaDownloadUrl({
      key: media.key,
      contentType: media.contentType,
      contentDisposition: 'inline',
      cacheWindow: true,
    })
    return new Response(null, {
      status: 302,
      headers: {
        location,
        'cache-control': 'private, max-age=1800',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
  }
}
