import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { getVerifiedUser } from '@/features/auth/queries'
import { POST_DOCUMENT_MAX_BYTES } from '@/features/feed/media-policy'
import { feedRepository } from '@/features/feed/repository'
import { createMediaDownloadUrl, getMediaObject, headMediaObject, streamMediaObject } from '@/lib/aws/storage'
import { cdnMediaUrl } from '@/lib/media-cdn/media-cdn'

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

type FeedMediaKey = { key: string; profileId: string; postId: string; contentType: string; poster: boolean }

function canonicalFeedMediaKey(parts: string[]): FeedMediaKey | null {
  if (parts.length !== 3) return null
  const [profileId, postId, filename] = parts
  if (!profileId || !postId || !filename) return null
  if (!UUID_PATTERN.test(profileId) || !UUID_PATTERN.test(postId)) return null

  // Round H (H1): a video's poster frame, stored next to it as <videoObjectId>.poster.jpg.
  const poster = filename.match(/^([0-9a-f-]+)\.poster\.jpg$/i)
  if (poster) {
    const [, objectId] = poster
    if (!objectId || !UUID_PATTERN.test(objectId)) return null
    return { key: `${profileId}/${postId}/${objectId}.poster.jpg`, profileId, postId, contentType: 'image/jpeg', poster: true }
  }

  const match = filename.match(/^([0-9a-f-]+)\.([a-z0-9]+)$/i)
  if (!match) return null

  const [, objectId, extensionRaw] = match
  if (!objectId || !UUID_PATTERN.test(objectId)) return null
  const extension = extensionRaw?.toLowerCase() ?? ''
  const contentType = CONTENT_TYPE_BY_EXTENSION[extension]
  if (!contentType) return null

  return { key: `${profileId}/${postId}/${objectId}.${extension}`, profileId, postId, contentType, poster: false }
}

/**
 * Post photos, videos and documents. Round 14 (2.2): the viewer must be able to see the post (the
 * feed's own visibility rules: blocks, private groups, deleted posts). Photos and videos redirect
 * to an hour-stable signed S3 URL instead of passing through the web task (which held up to
 * 200 MB in memory per request); S3 answers Range requests, so videos seek on iOS, and the
 * redirect may be kept privately for 30 minutes. PDFs (at most 25 MB) are still served from this
 * origin: the document carousel reads them with pdf.js, and a cross-origin read would need
 * bucket CORS for GET.
 *
 * Round H (H1):
 * - `<video>.poster.jpg` is the video's poster frame. It is checked first, so a video that has no
 *   poster yet answers 404 here instead of a redirect to a missing S3 object.
 * - `?source=poster` on a video streams it from this origin (with Range support, never buffered), so
 *   the browser can draw a frame on a canvas to make a missing poster. Only the post's author and
 *   platform administrators get this; everyone else plays the video through the S3 redirect.
 */
export async function GET(
  request: Request,
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
    if (media.poster) {
      try {
        await headMediaObject(media.key)
      } catch {
        return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
      }
    }
    const wantsPosterSource = new URL(request.url).searchParams.get('source') === 'poster'
    if (wantsPosterSource && media.contentType.startsWith('video/')) {
      const allowed = Boolean(user) && (user!.id === media.profileId || await canUsePlatformAdminAuthority(user!.id))
      if (!allowed) return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
      const object = await streamMediaObject({ key: media.key, range: request.headers.get('range') })
      return new Response(object.body, {
        status: object.status,
        headers: {
          'cache-control': 'private, no-store',
          'content-type': media.contentType,
          ...(object.contentLength !== null ? { 'content-length': String(object.contentLength) } : {}),
          ...(object.contentRange ? { 'content-range': object.contentRange } : {}),
          'accept-ranges': 'bytes',
          'x-content-type-options': 'nosniff',
        },
      })
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
    // Round P3 (B7): to the CDN copy once the media CDN is configured (posters, which are uploaded
    // without a server-side confirm step, stay on S3).
    const location = (media.poster ? null : cdnMediaUrl(media.key, media.contentType)) ?? await createMediaDownloadUrl({
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
