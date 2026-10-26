import { createMediaReadUrl } from '@/lib/aws/storage'
import { cdnImageSrc } from '@/lib/media-cdn/media-cdn'
import { createMediaImageLink } from './media-image-link'

/**
 * Image `src` for a stored photo (avatar, cover, logo, banner, post or message photo).
 *
 * Round P3 (B7): once the media CDN is configured, a signed CloudFront URL of the photo's resized
 * WebP (`/m/i/<id>/768.webp?…`). MediaImage swaps the width in it for srcset, so the web task never
 * touches the bytes. Until then (and for GIFs or keys that do not qualify), the stable signed link
 * that Next's optimizer caches for its whole window, or a pre-signed S3 URL shown unoptimized. It
 * fits wherever a `(key, seconds)` signer is expected; none of these needs an expiry.
 */
export async function createMediaImageSrc(key: string): Promise<string> {
  return cdnImageSrc(key) ?? createMediaImageLink(key) ?? createMediaReadUrl(key)
}
