import {
  imageVariantFolder,
  isImageVariantSource,
  mediaCdnFileExtension,
  mediaCdnFileFolder,
} from './cdn-keys'
import { imageVariantWidthFor } from './cdn-url'
import { mediaCdnSigningConfig, signMediaCdnFolder, type MediaCdnAccess } from './signer'

/**
 * Round P3 (B7): URLs on the media CDN (`/m/*` on the site's own CloudFront distribution, read from
 * S3 through origin access control, never public). They are handed out only by the same server
 * code that already decided the viewer may see the object, and the CloudFront signature is the
 * permission. With no signing key configured (local dev, tests, or before rollout) every helper
 * answers null and callers keep their first-party URLs.
 */
export function mediaCdnEnabled(): boolean {
  return mediaCdnSigningConfig() !== null
}

const PUBLIC_PREFIXES = ['profiles/', 'organizations/', 'communities/', 'events/', 'site/']
const COURSE_THUMBNAIL = /^learning\/[^/]+\/[^/]+\/course_thumbnail\//

/**
 * Public-facing photos (member photos and covers, organization, community and event images, About
 * page images, course thumbnails) get 30-day windows; post, message and lesson media get 6 hours.
 */
export function mediaCdnAccessFor(sourceKey: string): MediaCdnAccess {
  if (PUBLIC_PREFIXES.some((prefix) => sourceKey.startsWith(prefix))) return 'public'
  if (COURSE_THUMBNAIL.test(sourceKey)) return 'public'
  return 'private'
}

/** Default size handed out: wide enough for a card or a 2x avatar; srcset picks the rest. */
export const DEFAULT_IMAGE_VARIANT_WIDTH = 768

/** Signed URL of a stored photo's WebP size closest above `width`, or null (not a photo, CDN off). */
export function cdnImageSrc(sourceKey: string, width: number = DEFAULT_IMAGE_VARIANT_WIDTH): string | null {
  if (!isImageVariantSource(sourceKey)) return null
  const folder = imageVariantFolder(sourceKey)
  const query = signMediaCdnFolder(folder, mediaCdnAccessFor(sourceKey))
  if (!query) return null
  return `/${folder}/${imageVariantWidthFor(width)}.webp?${query}`
}

/** Signed URL of a video or GIF served as uploaded, or null (another type, CDN off). */
export function cdnFileUrl(sourceKey: string, contentType: string): string | null {
  const extension = mediaCdnFileExtension(contentType)
  if (!extension) return null
  const folder = mediaCdnFileFolder(sourceKey)
  const query = signMediaCdnFolder(folder, mediaCdnAccessFor(sourceKey))
  if (!query) return null
  return `/${folder}/file.${extension}?${query}`
}

/** CDN URL for any stored media type it serves: a photo's size, or a video or GIF as uploaded. */
export function cdnMediaUrl(sourceKey: string, contentType: string, width?: number): string | null {
  return isImageVariantSource(sourceKey) && contentType.startsWith('image/') && contentType !== 'image/gif'
    ? cdnImageSrc(sourceKey, width)
    : cdnFileUrl(sourceKey, contentType)
}
