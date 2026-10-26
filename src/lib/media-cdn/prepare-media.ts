import sharp from 'sharp'
import { copyMediaObject, getMediaObject, mediaObjectExists, putMediaObject } from '@/lib/aws/storage'
import {
  MEDIA_CDN_OBJECT_CACHE_CONTROL,
  imageVariantKey,
  isImageVariantSource,
  mediaCdnFileExtension,
  mediaCdnFileKey,
} from './cdn-keys'
import { IMAGE_VARIANT_WIDTHS } from './cdn-url'

/** Largest stored photo the server will resize (browsers already re-encode to 2048 px or less). */
export const IMAGE_VARIANT_SOURCE_MAX_BYTES = 15 * 1024 * 1024
/** WebP quality for every size: keeps text and logos in designed graphics sharp. */
export const IMAGE_VARIANT_QUALITY = 85
const MAX_INPUT_PIXELS = 50_000_000

/**
 * The three WebP sizes of one photo (320, 768 and 1600 px wide, never enlarged, at most four
 * times as tall as wide). sharp drops all metadata, EXIF and GPS included, unless asked to keep it.
 */
export async function renderImageVariants(source: Uint8Array): Promise<Array<{ width: number; body: Buffer }>> {
  const variants: Array<{ width: number; body: Buffer }> = []
  for (const width of IMAGE_VARIANT_WIDTHS) {
    const body = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true })
      .rotate()
      .resize({ width, height: width * 4, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: IMAGE_VARIANT_QUALITY })
      .toBuffer()
    variants.push({ width, body })
  }
  return variants
}

export async function writeImageVariants(sourceKey: string, source?: Uint8Array): Promise<void> {
  const body = source ?? (await getMediaObject({ key: sourceKey, maxBytes: IMAGE_VARIANT_SOURCE_MAX_BYTES })).body
  for (const variant of await renderImageVariants(body)) {
    await putMediaObject({
      key: imageVariantKey(sourceKey, variant.width as (typeof IMAGE_VARIANT_WIDTHS)[number]),
      body: variant.body,
      contentType: 'image/webp',
      cacheControl: MEDIA_CDN_OBJECT_CACHE_CONTROL,
    })
  }
}

/**
 * Round P3 (B7, Part D): makes the CloudFront copies of a just-verified upload. A photo gets its
 * three WebP sizes; a video or GIF is copied as it is under `m/f/`. Other types (PDFs, documents)
 * are never served from the CDN. Runs only where the media bucket is configured, and throws on
 * failure so the upload is refused rather than saved without its CDN copy.
 */
export async function prepareMediaForCdn(input: {
  key: string
  contentType: string
  body?: Uint8Array
  /** For saves that re-check an unchanged reference: nothing is written when the copy exists. */
  skipIfPresent?: boolean
}): Promise<void> {
  if (!process.env.AWS_MEDIA_BUCKET?.trim()) return
  const contentType = input.contentType.split(';', 1)[0]!.trim().toLowerCase()
  if (contentType.startsWith('image/') && contentType !== 'image/gif' && isImageVariantSource(input.key)) {
    // The largest size is written last, so its presence means all three are there.
    if (input.skipIfPresent && await mediaObjectExists(imageVariantKey(input.key, 1600))) return
    await writeImageVariants(input.key, input.body)
    return
  }
  const extension = mediaCdnFileExtension(contentType)
  if (!extension) return
  if (input.skipIfPresent && await mediaObjectExists(mediaCdnFileKey(input.key, extension))) return
  await copyMediaObject({
    sourceKey: input.key,
    destinationKey: mediaCdnFileKey(input.key, extension),
    contentType,
    cacheControl: MEDIA_CDN_OBJECT_CACHE_CONTROL,
  })
}
