/**
 * Cuts the region a member framed in the crop dialog out of a photo, in the browser, before the
 * photo is uploaded. The crop box arrives in natural-image pixels (as react-easy-crop reports
 * it), is clamped to the decoded bitmap, drawn to a canvas no larger than `maxEdge` on its long
 * side and encoded as WebP (JPEG where the browser cannot encode WebP). Decoding honours EXIF
 * orientation, so the pixels match what the member saw while cropping. Anything the browser cannot
 * do (no `createImageBitmap`, an undecodable file, no encoder) resolves to `null` so the caller can
 * upload the original instead.
 */
export type PixelCrop = { x: number; y: number; width: number; height: number }

export type CropImageType = 'image/webp' | 'image/jpeg'

export type CropImageOptions = {
  /** Longest edge of the result in pixels; a larger crop is scaled down, a smaller one is kept. */
  maxEdge: number
  /** Preferred encoding; JPEG is the fallback when the browser answers with another type. */
  type?: CropImageType
  quality?: number
}

const DEFAULT_QUALITY = 0.92

const EXTENSION: Record<CropImageType, 'webp' | 'jpg'> = { 'image/webp': 'webp', 'image/jpeg': 'jpg' }

/** Keeps the crop box inside the image, at least 1px on each side, with whole-pixel edges. */
export function clampPixelCrop(crop: PixelCrop, imageWidth: number, imageHeight: number): PixelCrop {
  const x = Math.min(Math.max(0, Math.round(crop.x)), Math.max(0, imageWidth - 1))
  const y = Math.min(Math.max(0, Math.round(crop.y)), Math.max(0, imageHeight - 1))
  const width = Math.max(1, Math.min(Math.round(crop.width), imageWidth - x))
  const height = Math.max(1, Math.min(Math.round(crop.height), imageHeight - y))
  return { x, y, width, height }
}

/** The size of the encoded result: the crop box shrunk (never enlarged) so its long edge fits `maxEdge`. */
export function cropOutputSize(crop: Pick<PixelCrop, 'width' | 'height'>, maxEdge: number) {
  const longEdge = Math.max(crop.width, crop.height)
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1
  return {
    width: Math.max(1, Math.round(crop.width * scale)),
    height: Math.max(1, Math.round(crop.height * scale)),
  }
}

function withExtension(name: string, extension: string) {
  const base = name.replace(/\.[^./\\]+$/, '') || 'photo'
  return `${base}.${extension}`
}

function encode(canvas: HTMLCanvasElement, type: CropImageType, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    // A browser that cannot encode the requested type answers with PNG (or nothing).
    canvas.toBlob((blob) => resolve(blob && blob.type === type ? blob : null), type, quality)
  })
}

export async function cropImageToFile(file: File, pixelCrop: PixelCrop, options: CropImageOptions): Promise<File | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return null
  }

  try {
    if (!bitmap.width || !bitmap.height) return null
    const source = clampPixelCrop(pixelCrop, bitmap.width, bitmap.height)
    const { width, height } = cropOutputSize(source, options.maxEdge)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, width, height)

    const quality = options.quality ?? DEFAULT_QUALITY
    const preferred = options.type ?? 'image/webp'
    const order: CropImageType[] = preferred === 'image/webp' ? ['image/webp', 'image/jpeg'] : ['image/jpeg', 'image/webp']
    for (const type of order) {
      const blob = await encode(canvas, type, quality)
      if (blob) {
        return new File([blob], withExtension(file.name, EXTENSION[type]), { type, lastModified: file.lastModified })
      }
    }
    return null
  } catch {
    return null
  } finally {
    bitmap.close?.()
  }
}
