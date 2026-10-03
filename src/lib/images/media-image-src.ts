import { createMediaReadUrl } from '@/lib/aws/storage'
import { createMediaImageLink } from './media-image-link'

/**
 * Image `src` for a stored photo (avatar, cover, logo, banner): the stable signed link that Next's
 * optimizer can cache for its whole window, or, for keys that do not qualify or when link signing
 * is not configured, a pre-signed S3 URL that is shown unoptimized. It fits wherever a
 * `(key, seconds)` signer is expected; links do not need an expiry.
 */
export async function createMediaImageSrc(key: string): Promise<string> {
  return createMediaImageLink(key) ?? createMediaReadUrl(key)
}
