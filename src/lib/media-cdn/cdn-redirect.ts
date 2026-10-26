import { cdnImageSrc } from './media-cdn'

/**
 * Round P3 (B7): for first-party image routes that have already checked who may see the image, a
 * redirect to its signed CDN size instead of streaming the bytes through the web task. Null when
 * the media CDN is not configured (or the key is not a photo), so the route keeps streaming.
 */
export function cdnImageRedirect(storageKey: string, options: { width: number; cacheControl: string }): Response | null {
  const location = cdnImageSrc(storageKey, options.width)
  if (!location) return null
  return new Response(null, {
    status: 302,
    headers: {
      location,
      'cache-control': options.cacheControl,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  })
}
