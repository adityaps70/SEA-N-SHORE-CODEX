/**
 * Round P3: a picked video's duration and frame size, read in the browser from its metadata only
 * (nothing is decoded or uploaded). Null when the browser cannot read it in time.
 */
export const VIDEO_DETAILS_TIMEOUT_MS = 10_000

export async function readVideoDetails(file: File, timeoutMs = VIDEO_DETAILS_TIMEOUT_MS): Promise<{ durationSeconds: number; width: number; height: number } | null> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'metadata'
  try {
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs)
      video.addEventListener('loadedmetadata', () => {
        clearTimeout(timer)
        resolve({ durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight })
      }, { once: true })
      video.addEventListener('error', () => {
        clearTimeout(timer)
        resolve(null)
      }, { once: true })
      video.src = objectUrl
    })
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(objectUrl)
  }
}
