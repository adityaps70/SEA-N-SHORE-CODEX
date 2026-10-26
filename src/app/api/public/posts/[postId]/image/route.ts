import { feedRepository } from '@/features/feed/repository'
import { isPostId } from '@/features/feed/queries'
import { getMediaObject } from '@/lib/aws/storage'
import { cdnImageRedirect } from '@/lib/media-cdn/cdn-redirect'
import { trustedClientIp } from '@/lib/http/client-ip'
import { createPublicPageRateLimiter } from '@/lib/http/public-page-rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const allowImageRequest = createPublicPageRateLimiter()

/**
 * Round F: the share-card image (og:image) of a post its author shows to anyone. Link previews
 * (WhatsApp, LinkedIn) fetch it without an account. Any other post, or a post without a photo,
 * is a 404: nothing members-only is ever served here.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ postId: string }> },
): Promise<Response> {
  if (!allowImageRequest(trustedClientIp(request.headers) ?? 'unknown')) {
    return new Response(null, { status: 429, headers: { 'retry-after': '60' } })
  }
  const { postId } = await context.params
  if (!isPostId(postId)) return new Response(null, { status: 404 })

  const storagePath = await feedRepository.getPublicPostImagePath(postId).catch(() => null)
  if (!storagePath) return new Response(null, { status: 404 })

  // Round P3 (B7): the photo's CDN size once the media CDN is configured.
  const redirect = cdnImageRedirect(storagePath, { width: 1600, cacheControl: 'public, max-age=300' })
  if (redirect) return redirect

  try {
    const object = await getMediaObject({ key: storagePath, maxBytes: MAX_IMAGE_BYTES })
    const contentType = object.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) return new Response(null, { status: 404 })
    return new Response(Uint8Array.from(object.body).buffer, {
      status: 200,
      headers: {
        // Short: an author can switch the post back to members only.
        'cache-control': 'public, max-age=300',
        'content-length': String(object.contentLength),
        'content-type': contentType,
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}
