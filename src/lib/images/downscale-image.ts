/**
 * Shrinks a photo in the browser before it is uploaded, so new avatars, covers, post images and
 * message photos are small at the source: the long edge is capped per use, the result is WebP
 * (JPEG where the browser cannot encode WebP), and re-encoding through a canvas drops EXIF
 * metadata including GPS. Anything that cannot be improved is returned unchanged: GIFs (which may
 * animate), photos already within the size and under 400 KB, files the browser cannot decode
 * (e.g. HEIC), and results that would be bigger than the original.
 */
export type DownscaleImageKind = 'avatar' | 'cover' | 'post' | 'message'

export const DOWNSCALE_MAX_EDGE_PX: Record<DownscaleImageKind, number> = {
  avatar: 800,
  cover: 1920,
  post: 2048,
  message: 2048,
}

/** Photos at or under this size that already fit the long edge are uploaded as they are. */
export const DOWNSCALE_SKIP_BYTES = 400 * 1024

export const DOWNSCALE_QUALITY = 0.85

type Encoded = { blob: Blob; type: 'image/webp' | 'image/jpeg'; extension: 'webp' | 'jpg' }

function encode(canvas: HTMLCanvasElement, type: Encoded['type'], extension: Encoded['extension']) {
  return new Promise<Encoded | null>((resolve) => {
    canvas.toBlob((blob) => {
      // A browser that cannot encode the requested type answers with PNG (or nothing).
      resolve(blob && blob.type === type ? { blob, type, extension } : null)
    }, type, DOWNSCALE_QUALITY)
  })
}

function withExtension(name: string, extension: string) {
  const base = name.replace(/\.[^./\\]+$/, '') || 'photo'
  return `${base}.${extension}`
}

export function isDownscalableImage(file: Pick<File, 'type'>) {
  return file.type.startsWith('image/') && file.type !== 'image/gif'
}

export async function downscaleImage(file: File, kind: DownscaleImageKind): Promise<File> {
  if (!isDownscalableImage(file)) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return file
  }

  try {
    const maxEdge = DOWNSCALE_MAX_EDGE_PX[kind]
    const longEdge = Math.max(bitmap.width, bitmap.height)
    if (!longEdge) return file
    if (longEdge <= maxEdge && file.size <= DOWNSCALE_SKIP_BYTES) return file

    const scale = Math.min(1, maxEdge / longEdge)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, width, height)

    const encoded = (await encode(canvas, 'image/webp', 'webp')) ?? (await encode(canvas, 'image/jpeg', 'jpg'))
    if (!encoded || encoded.blob.size >= file.size) return file

    return new File([encoded.blob], withExtension(file.name, encoded.extension), {
      type: encoded.type,
      lastModified: file.lastModified,
    })
  } catch {
    return file
  } finally {
    bitmap.close?.()
  }
}
