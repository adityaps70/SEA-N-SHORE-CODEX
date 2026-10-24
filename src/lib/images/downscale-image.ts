/**
 * Re-encodes every photo in the browser before it is uploaded, so new avatars, covers, logos,
 * banners, post, lesson and message images carry no EXIF metadata (GPS location included) and are
 * small at the source. Round P3: re-encoding is unconditional. The long edge and encoder quality
 * are set per use and the result is WebP (JPEG where the browser cannot encode WebP; PNG for logos
 * so transparency survives). Certificate artwork is embedded in a PDF that only takes PNG or JPEG,
 * so it stays in those types. GIFs (which may animate) and non-images are returned unchanged. A
 * photo the browser cannot decode or encode is refused with `ImageReencodeError` instead of being
 * uploaded with its metadata.
 */
export type DownscaleImageKind = 'avatar' | 'cover' | 'post' | 'message' | 'logo' | 'certificate'

export const DOWNSCALE_MAX_EDGE_PX: Record<DownscaleImageKind, number> = {
  avatar: 800,
  cover: 1920,
  post: 2048,
  message: 2048,
  logo: 512,
  certificate: 1200,
}

/**
 * Encoder quality per use. Post and message images are mostly designed graphics (cards, posters)
 * whose small text and logos smear below 0.9; avatars and covers are photos and can go lower.
 */
export const DOWNSCALE_QUALITY: Record<DownscaleImageKind, number> = {
  avatar: 0.85,
  cover: 0.85,
  post: 0.92,
  message: 0.92,
  logo: 0.92,
  certificate: 0.92,
}

export const IMAGE_REENCODE_ERROR_MESSAGE = 'This photo could not be prepared for upload. Choose a JPG, PNG or WebP image.'

/** The browser could not decode or re-encode the photo, so it is not uploaded with its metadata. */
export class ImageReencodeError extends Error {
  constructor() {
    super(IMAGE_REENCODE_ERROR_MESSAGE)
    this.name = 'ImageReencodeError'
  }
}

type OutputType = 'image/webp' | 'image/jpeg' | 'image/png'

const EXTENSION: Record<OutputType, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }

/** Encodings to try, in order; the first one the browser can produce is used. */
function outputTypes(kind: DownscaleImageKind, sourceType: string): OutputType[] {
  if (kind === 'logo') return ['image/webp', 'image/png']
  // A signature or logo on a certificate is usually a transparent PNG; a photo stays a JPEG.
  if (kind === 'certificate') return sourceType === 'image/jpeg' ? ['image/jpeg'] : ['image/png']
  return ['image/webp', 'image/jpeg']
}

function encode(canvas: HTMLCanvasElement, type: OutputType, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    // A browser that cannot encode the requested type answers with PNG (or nothing).
    canvas.toBlob((blob) => resolve(blob && blob.type === type ? blob : null), type, quality)
  })
}

function withExtension(name: string, extension: string) {
  const base = name.replace(/\.[^./\\]+$/, '') || 'photo'
  return `${base}.${extension}`
}

export function isDownscalableImage(file: Pick<File, 'type'>) {
  return file.type.startsWith('image/') && file.type !== 'image/gif'
}

/** The member-facing message for an error from `downscaleImage`, or `fallback` for anything else. */
export function imageReencodeErrorMessage(error: unknown, fallback: string) {
  return error instanceof ImageReencodeError ? error.message : fallback
}

export async function downscaleImage(file: File, kind: DownscaleImageKind): Promise<File> {
  if (!isDownscalableImage(file)) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') throw new ImageReencodeError()

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ImageReencodeError()
  }

  try {
    const maxEdge = DOWNSCALE_MAX_EDGE_PX[kind]
    const longEdge = Math.max(bitmap.width, bitmap.height)
    if (!longEdge) throw new ImageReencodeError()

    const scale = Math.min(1, maxEdge / longEdge)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new ImageReencodeError()
    context.drawImage(bitmap, 0, 0, width, height)

    const quality = DOWNSCALE_QUALITY[kind]
    for (const type of outputTypes(kind, file.type)) {
      const blob = await encode(canvas, type, quality)
      if (blob) return new File([blob], withExtension(file.name, EXTENSION[type]), { type, lastModified: file.lastModified })
    }
    throw new ImageReencodeError()
  } catch {
    throw new ImageReencodeError()
  } finally {
    bitmap.close?.()
  }
}
