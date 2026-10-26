/**
 * Client-safe part of media delivery through CloudFront (Round P3, B7 and Part D).
 *
 * Every photo has three WebP sizes under one folder, `/m/i/<id>/<width>.webp`, and one signed
 * query (a custom policy over `/m/i/<id>/*`) that is valid for all three. So the browser can be
 * handed one URL and any size is the same URL with the width swapped: `srcset` costs no extra
 * signatures. Files served as they are (feed and message videos, GIFs) live under `/m/f/<id>/`.
 */
export const MEDIA_CDN_PREFIX = '/m/'
export const IMAGE_VARIANT_WIDTHS = [320, 768, 1600] as const
export type ImageVariantWidth = (typeof IMAGE_VARIANT_WIDTHS)[number]

const CDN_IMAGE_URL = /^\/m\/i\/([A-Za-z0-9_-]{32})\/(320|768|1600)\.webp\?(.+)$/

export function isCdnImageUrl(src: string): boolean {
  return CDN_IMAGE_URL.test(src)
}

export function isCdnMediaUrl(src: string): boolean {
  return src.startsWith(MEDIA_CDN_PREFIX)
}

/** The smallest stored size at least `width` px wide (the largest when none is). */
export function imageVariantWidthFor(width: number): ImageVariantWidth {
  return IMAGE_VARIANT_WIDTHS.find((candidate) => candidate >= width) ?? IMAGE_VARIANT_WIDTHS[IMAGE_VARIANT_WIDTHS.length - 1]
}

/** The same signed photo at the stored size closest above `width`; other URLs come back unchanged. */
export function cdnImageUrlForWidth(src: string, width: number): string {
  const match = CDN_IMAGE_URL.exec(src)
  if (!match) return src
  const [, id, , query] = match
  return `/m/i/${id}/${imageVariantWidthFor(width)}.webp?${query}`
}

/** `srcset` with the three stored sizes, or undefined for a URL that is not a CDN photo. */
export function cdnImageSrcSet(src: string): string | undefined {
  if (!isCdnImageUrl(src)) return undefined
  return IMAGE_VARIANT_WIDTHS.map((width) => `${cdnImageUrlForWidth(src, width)} ${width}w`).join(', ')
}
