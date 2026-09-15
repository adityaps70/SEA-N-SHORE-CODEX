export type LearningMediaKind = 'course_thumbnail' | 'course_trailer' | 'lesson_video'

export const LEARNING_MEDIA_MAX_BYTES: Record<LearningMediaKind, number> = {
  course_thumbnail: 5 * 1024 * 1024,
  course_trailer: 200 * 1024 * 1024,
  lesson_video: 500 * 1024 * 1024,
}

const MIME_EXTENSION: Record<LearningMediaKind, Record<string, string>> = {
  course_thumbnail: {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  },
  course_trailer: {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  },
  lesson_video: {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  },
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type LearningMediaMetadataValidation =
  | { ok: true; mimeType: string; extension: string }
  | { ok: false; error: string }

function extensionFor(kind: LearningMediaKind, mimeType: string): string | null {
  return MIME_EXTENSION[kind][mimeType] ?? null
}

export function validateLearningMediaMetadata(input: {
  kind: LearningMediaKind
  mimeType: string
  size: number
}): LearningMediaMetadataValidation {
  if (!Number.isFinite(input.size) || !Number.isInteger(input.size) || input.size <= 0) {
    return { ok: false, error: 'Media file size is invalid.' }
  }

  const extension = extensionFor(input.kind, input.mimeType)
  if (!extension) {
    return {
      ok: false,
      error: input.kind === 'course_thumbnail'
        ? 'Choose a JPEG, PNG, or WebP image.'
        : 'Choose an MP4 or WebM video.',
    }
  }

  if (input.size > LEARNING_MEDIA_MAX_BYTES[input.kind]) {
    const maxMb = Math.round(LEARNING_MEDIA_MAX_BYTES[input.kind] / (1024 * 1024))
    return { ok: false, error: `This file must be ${maxMb} MB or smaller.` }
  }

  return { ok: true, mimeType: input.mimeType, extension }
}

export function buildLearningMediaStoragePath(input: {
  userId: string
  courseId: string
  kind: LearningMediaKind
  mimeType: string
  objectId?: string
}): string {
  const extension = extensionFor(input.kind, input.mimeType)
  if (!extension) throw new Error('learning_media_type_invalid')
  const objectId = input.objectId ?? crypto.randomUUID()
  if (!UUID_PATTERN.test(objectId)) throw new Error('learning_media_object_id_invalid')
  return `learning/${encodeURIComponent(input.userId)}/${input.courseId}/${input.kind}/${objectId}.${extension}`
}

export function isLearningMediaStoragePath(storagePath: string): boolean {
  return storagePath.startsWith('learning/')
}

export function isOwnedLearningMediaStoragePath(input: {
  userId: string
  courseId: string
  kind: LearningMediaKind
  storagePath: string
  mimeType?: string
}): boolean {
  const parts = input.storagePath.split('/')
  if (parts.length !== 5) return false
  if (parts[0] !== 'learning') return false
  if (parts[1] !== encodeURIComponent(input.userId)) return false
  if (parts[2] !== input.courseId || parts[3] !== input.kind) return false

  const filename = parts[4]
  if (!filename) return false
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex <= 0) return false
  const objectId = filename.slice(0, dotIndex)
  const extension = filename.slice(dotIndex + 1)
  if (!UUID_PATTERN.test(objectId)) return false

  if (input.mimeType) return extensionFor(input.kind, input.mimeType) === extension
  return Object.values(MIME_EXTENSION[input.kind]).includes(extension)
}
