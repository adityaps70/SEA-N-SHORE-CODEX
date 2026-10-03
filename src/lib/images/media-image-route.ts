/** Client-safe part of the stable media image links (see media-image-link.ts, server only). */
export const MEDIA_IMAGE_ROUTE = '/api/media/image'

export function isMediaImageLink(src: string): boolean {
  return src.startsWith(MEDIA_IMAGE_ROUTE + '/')
}
