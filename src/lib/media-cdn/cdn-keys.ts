import { createHash } from 'node:crypto'
import { IMAGE_VARIANT_WIDTHS, type ImageVariantWidth } from './cdn-url'

/**
 * Where the CloudFront-served copies of a stored object live. Everything CloudFront may read is
 * under `m/` (the bucket policy lets the distribution read nothing else), and each source key maps
 * to one folder named by a hash of the key, so the server, the backfill and the tests all derive
 * the same location without a database column.
 */
export const MEDIA_CDN_KEY_PREFIX = 'm/'

/** Long-lived because every folder is unique to one stored object, which is never rewritten. */
export const MEDIA_CDN_OBJECT_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** 32 URL-safe characters (192 bits) of the key's SHA-256. */
export function mediaCdnId(sourceKey: string): string {
  return createHash('sha256').update(sourceKey).digest('base64url').slice(0, 32)
}

export function imageVariantFolder(sourceKey: string): string {
  return `m/i/${mediaCdnId(sourceKey)}`
}

export function imageVariantKey(sourceKey: string, width: ImageVariantWidth): string {
  return `${imageVariantFolder(sourceKey)}/${width}.webp`
}

export function imageVariantKeys(sourceKey: string): string[] {
  return IMAGE_VARIANT_WIDTHS.map((width) => imageVariantKey(sourceKey, width))
}

const FILE_EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'image/gif': 'gif',
}

/** Extension for a file served as it is, or null for a type that is never served from the CDN. */
export function mediaCdnFileExtension(contentType: string): string | null {
  return FILE_EXTENSIONS[contentType.split(';', 1)[0]!.trim().toLowerCase()] ?? null
}

export function mediaCdnFileFolder(sourceKey: string): string {
  return `m/f/${mediaCdnId(sourceKey)}`
}

export function mediaCdnFileKey(sourceKey: string, extension: string): string {
  return `${mediaCdnFileFolder(sourceKey)}/file.${extension}`
}

const RASTER_EXTENSION = /\.(?:jpe?g|png|webp|avif)$/i

/** Stored photos that get WebP sizes. GIFs (which may animate) and everything else do not. */
export function isImageVariantSource(sourceKey: string): boolean {
  return RASTER_EXTENSION.test(sourceKey)
}
