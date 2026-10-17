import { POST_VIDEO_POSTER_MAX_BYTES, POST_VIDEO_POSTER_MIME } from './media-policy'

/**
 * Round H (H1): makes a video's poster in the browser, with no transcoding service. A hidden
 * <video> loads the file (a local File while composing, or the same-origin `?source=poster` stream
 * for the backfill), seeks to a frame about a tenth of the way in (at most 1 s), draws it on a
 * canvas and encodes a JPEG under POST_VIDEO_POSTER_MAX_BYTES.
 */
export const POSTER_MAX_WIDTH = 1280
export const POSTER_CAPTURE_TIMEOUT_MS = 20_000

export function posterSeekTime(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(1, duration * 0.1)
}

export function posterSize(width: number, height: number, maxWidth = POSTER_MAX_WIDTH) {
  if (!width || !height) return null
  const scale = Math.min(1, maxWidth / width)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, POST_VIDEO_POSTER_MIME, quality))
}

export async function captureVideoPoster(source: File | string, timeoutMs = POSTER_CAPTURE_TIMEOUT_MS): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = objectUrl ?? (source as string)

  try {
    const frameReady = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('poster_capture_timeout')), timeoutMs)
      video.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('poster_capture_load_failed'))
      }, { once: true })
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = posterSeekTime(video.duration)
      }, { once: true })
      video.addEventListener('seeked', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
    video.load()
    await frameReady

    const size = posterSize(video.videoWidth, video.videoHeight)
    if (!size) return null
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(video, 0, 0, size.width, size.height)

    for (const quality of [0.82, 0.7, 0.55, 0.4]) {
      const blob = await canvasToJpeg(canvas, quality)
      if (blob && blob.size <= POST_VIDEO_POSTER_MAX_BYTES) return blob
    }
    return null
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

type PosterUploadTarget = (input: { videoStoragePath: string; size: number }) => Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }>

/** Best effort: a missing poster never blocks a post. Resolves true when the poster was stored. */
export async function uploadVideoPoster(input: {
  videoStoragePath: string
  source: File | string
  createUpload: PosterUploadTarget
  capture?: typeof captureVideoPoster
  put?: typeof fetch
}): Promise<boolean> {
  try {
    const poster = await (input.capture ?? captureVideoPoster)(input.source)
    if (!poster) return false
    const target = await input.createUpload({ videoStoragePath: input.videoStoragePath, size: poster.size })
    if (!target.ok) return false
    const response = await (input.put ?? fetch)(target.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': POST_VIDEO_POSTER_MIME },
      body: poster,
    })
    return response.ok
  } catch {
    return false
  }
}
