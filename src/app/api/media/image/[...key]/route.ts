import { getMediaObject } from '@/lib/aws/storage'
import { MEDIA_IMAGE_MAX_BYTES, verifyMediaImageLink } from '@/lib/images/media-image-link'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RASTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

/**
 * Serves a member photo, cover, logo or banner behind a stable signed link (see
 * `createMediaImageLink`). This is the source Next's image optimizer fetches, so the optimized
 * result is cached for the whole link window instead of going stale every clock hour. The link
 * signature is the permission (the optimizer sends no cookies); only photo keys and raster types
 * are ever served.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key: segments } = await context.params
  let storageKey: string
  try {
    storageKey = segments.map((segment) => decodeURIComponent(segment)).join('/')
  } catch {
    return new Response(null, { status: 404 })
  }
  const url = new URL(request.url)
  const check = verifyMediaImageLink(storageKey, url.searchParams.get('w'), url.searchParams.get('s'))
  if (!check.ok) return new Response(null, { status: check.reason === 'not_configured' ? 503 : 404 })

  try {
    const object = await getMediaObject({ key: storageKey, maxBytes: MEDIA_IMAGE_MAX_BYTES })
    const contentType = object.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    if (!RASTER_TYPES.has(contentType)) return new Response(null, { status: 404 })
    return new Response(Uint8Array.from(object.body).buffer, {
      status: 200,
      headers: {
        // The link is stable for its window and changes when the stored path changes.
        'cache-control': 'private, max-age=86400',
        'content-length': String(object.contentLength),
        'content-type': contentType,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}
