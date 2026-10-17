export const POST_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const POST_IMAGE_MAX_COUNT = 10
export const POST_VIDEO_MAX_BYTES = 200 * 1024 * 1024
export const POST_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024
export const POST_DOCUMENT_MAX_PAGES = 50

export const POST_MEDIA_MIME_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
} as const

export type PostMediaMime = keyof typeof POST_MEDIA_MIME_EXTENSION

export type PostMediaMetadataValidation =
  | { ok: true; mimeType: PostMediaMime; extension: string }
  | { ok: false; error: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isVideoPostMediaMime(value: string): value is 'video/mp4' | 'video/webm' {
  return value === 'video/mp4' || value === 'video/webm'
}

function isPostMediaMime(value: string): value is PostMediaMime {
  return Object.prototype.hasOwnProperty.call(POST_MEDIA_MIME_EXTENSION, value)
}

export function validatePostMediaMetadata(input: {
  mimeType: string
  size: number
}): PostMediaMetadataValidation {
  if (!Number.isFinite(input.size) || !Number.isInteger(input.size) || input.size <= 0) {
    return { ok: false, error: 'Media file size is invalid.' }
  }

  if (!isPostMediaMime(input.mimeType)) {
    return { ok: false, error: 'Choose a JPEG, PNG, WebP, MP4, WebM, or PDF file.' }
  }

  if (input.mimeType === 'application/pdf') {
    if (input.size > POST_DOCUMENT_MAX_BYTES) {
      return { ok: false, error: 'PDF documents must be 25 MB or smaller.' }
    }
  } else if (isVideoPostMediaMime(input.mimeType)) {
    if (input.size > POST_VIDEO_MAX_BYTES) {
      return { ok: false, error: 'Videos must be 200 MB or smaller.' }
    }
  } else if (input.size > POST_IMAGE_MAX_BYTES) {
    return { ok: false, error: 'Images must be 5 MiB or smaller.' }
  }

  return {
    ok: true,
    mimeType: input.mimeType,
    extension: POST_MEDIA_MIME_EXTENSION[input.mimeType],
  }
}

export function buildPostMediaStoragePath(input: {
  profileId: string
  postId: string
  mimeType: PostMediaMime
  objectId?: string
}): string {
  const objectId = input.objectId ?? crypto.randomUUID()
  return `${input.profileId}/${input.postId}/${objectId}.${POST_MEDIA_MIME_EXTENSION[input.mimeType]}`
}

export function isOwnedPostMediaStoragePath(input: {
  profileId: string
  postId: string
  storagePath: string
  mimeType: PostMediaMime
}): boolean {
  const parts = input.storagePath.split('/')
  if (parts.length !== 3 || parts[0] !== input.profileId || parts[1] !== input.postId) return false

  const filename = parts[2] ?? ''
  const extension = POST_MEDIA_MIME_EXTENSION[input.mimeType]
  const suffix = `.${extension}`
  if (!filename.endsWith(suffix)) return false

  const objectId = filename.slice(0, -suffix.length)
  return UUID_PATTERN.test(objectId)
}

/**
 * Round H (H1): a video's poster is a JPEG frame captured in the browser and stored next to the
 * video as `<videoObjectId>.poster.jpg`. The name is derived from the video's, so no database
 * column is needed: the player always asks for it, and a video without one simply has no poster.
 */
export const POST_VIDEO_POSTER_MAX_BYTES = 512 * 1024
export const POST_VIDEO_POSTER_MIME = 'image/jpeg'
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm'])

export function parsePostVideoStoragePath(storagePath: string): { profileId: string; postId: string; objectId: string } | null {
  const parts = storagePath.split('/')
  if (parts.length !== 3) return null
  const [profileId, postId, filename] = parts
  const match = (filename ?? '').match(/^([0-9a-f-]+)\.([a-z0-9]+)$/i)
  if (!profileId || !postId || !match) return null
  const [, objectId, extension] = match
  if (!objectId || !extension || !VIDEO_EXTENSIONS.has(extension.toLowerCase())) return null
  if (![profileId, postId, objectId].every((value) => UUID_PATTERN.test(value))) return null
  return { profileId, postId, objectId }
}

export function postVideoPosterStoragePath(videoStoragePath: string): string | null {
  const video = parsePostVideoStoragePath(videoStoragePath)
  return video ? `${video.profileId}/${video.postId}/${video.objectId}.poster.jpg` : null
}
