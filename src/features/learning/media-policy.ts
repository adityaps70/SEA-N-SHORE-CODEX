export type LearningMediaKind =
  | 'course_thumbnail'
  | 'course_trailer'
  | 'lesson_video'
  | 'lesson_image'
  | 'lesson_audio'
  | 'lesson_document'
  | 'lesson_resource'
  | 'scorm_package'

export const LEARNING_MEDIA_MAX_BYTES: Record<LearningMediaKind, number> = {
  course_thumbnail: 5 * 1024 * 1024,
  course_trailer: 200 * 1024 * 1024,
  lesson_video: 500 * 1024 * 1024,
  lesson_image: 10 * 1024 * 1024,
  lesson_audio: 200 * 1024 * 1024,
  lesson_document: 100 * 1024 * 1024,
  lesson_resource: 100 * 1024 * 1024,
  scorm_package: 200 * 1024 * 1024,
}

const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

const VIDEO_TYPES = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
} as const

const AUDIO_TYPES = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
} as const

const DOCUMENT_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
} as const

const RESOURCE_TYPES = {
  ...DOCUMENT_TYPES,
  ...IMAGE_TYPES,
  'application/zip': 'zip',
} as const

const MIME_EXTENSION: Record<LearningMediaKind, Record<string, string>> = {
  course_thumbnail: IMAGE_TYPES,
  course_trailer: VIDEO_TYPES,
  lesson_video: VIDEO_TYPES,
  lesson_image: IMAGE_TYPES,
  lesson_audio: AUDIO_TYPES,
  lesson_document: DOCUMENT_TYPES,
  lesson_resource: RESOURCE_TYPES,
  scorm_package: { 'application/zip': 'zip', 'application/x-zip-compressed': 'zip' },
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type LearningMediaMetadataValidation =
  | { ok: true; mimeType: string; extension: string }
  | { ok: false; error: string }

function extensionFor(kind: LearningMediaKind, mimeType: string): string | null {
  return MIME_EXTENSION[kind][mimeType] ?? null
}

function formatLabel(kind: LearningMediaKind) {
  switch (kind) {
    case 'course_thumbnail': return 'JPEG, PNG, or WebP image'
    case 'course_trailer':
    case 'lesson_video': return 'MP4 or WebM video'
    case 'lesson_image': return 'JPEG, PNG, or WebP image'
    case 'lesson_audio': return 'MP3, M4A, WAV, or WebM audio'
    case 'lesson_document': return 'PDF, PowerPoint, Word, Excel, or text document'
    case 'lesson_resource': return 'supported document, image, or ZIP resource'
    case 'scorm_package': return 'SCORM ZIP package'
  }
}

export function learningMediaAccept(kind: LearningMediaKind): string {
  return Object.keys(MIME_EXTENSION[kind]).join(',')
}

export function learningMediaLimitLabel(kind: LearningMediaKind): string {
  return `${formatLabel(kind)} · up to ${Math.round(LEARNING_MEDIA_MAX_BYTES[kind] / (1024 * 1024))} MB`
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
    return { ok: false, error: `Choose a ${formatLabel(input.kind).toLowerCase()}.` }
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
