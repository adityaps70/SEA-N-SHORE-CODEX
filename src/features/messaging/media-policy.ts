export const MESSAGE_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const MESSAGE_VIDEO_MAX_BYTES = 100 * 1024 * 1024
export const MESSAGE_FILE_MAX_BYTES = 25 * 1024 * 1024

export const MESSAGE_ATTACHMENT_MIME_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
} as const

export type MessageAttachmentMime = keyof typeof MESSAGE_ATTACHMENT_MIME_EXTENSION

export type MessageAttachmentMetadataValidation =
  | {
      ok: true
      mimeType: MessageAttachmentMime
      extension: string
      kind: 'image' | 'video' | 'file'
      name: string
    }
  | { ok: false; error: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isSupportedMime(value: string): value is MessageAttachmentMime {
  return Object.prototype.hasOwnProperty.call(MESSAGE_ATTACHMENT_MIME_EXTENSION, value)
}

export function isImageMessageAttachmentMime(value: string) {
  return value.startsWith('image/')
}

export function isVideoMessageAttachmentMime(value: string) {
  return value === 'video/mp4' || value === 'video/webm'
}

function safeDisplayName(name: string) {
  const normalized = name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return normalized.slice(0, 255)
}

export function validateMessageAttachmentMetadata(input: {
  mimeType: string
  size: number
  name: string
}): MessageAttachmentMetadataValidation {
  if (!Number.isFinite(input.size) || !Number.isInteger(input.size) || input.size <= 0) {
    return { ok: false, error: 'Attachment file size is invalid.' }
  }

  if (!isSupportedMime(input.mimeType)) {
    return { ok: false, error: 'Choose a supported photo, video, PDF, Office document, text, CSV, or ZIP file.' }
  }

  const name = safeDisplayName(input.name)
  if (!name) return { ok: false, error: 'Attachment file name is invalid.' }

  const kind = isImageMessageAttachmentMime(input.mimeType)
    ? 'image'
    : isVideoMessageAttachmentMime(input.mimeType)
      ? 'video'
      : 'file'

  const maximum = kind === 'image'
    ? MESSAGE_IMAGE_MAX_BYTES
    : kind === 'video'
      ? MESSAGE_VIDEO_MAX_BYTES
      : MESSAGE_FILE_MAX_BYTES

  if (input.size > maximum) {
    return {
      ok: false,
      error: kind === 'image'
        ? 'Photos must be 10 MB or smaller.'
        : kind === 'video'
          ? 'Videos must be 100 MB or smaller.'
          : 'Files must be 25 MB or smaller.',
    }
  }

  return {
    ok: true,
    mimeType: input.mimeType,
    extension: MESSAGE_ATTACHMENT_MIME_EXTENSION[input.mimeType],
    kind,
    name,
  }
}

export function buildMessageAttachmentStoragePath(input: {
  profileId: string
  conversationId: string
  mimeType: MessageAttachmentMime
  objectId?: string
}) {
  const objectId = input.objectId ?? crypto.randomUUID()
  return `messages/${input.profileId}/${input.conversationId}/${objectId}.${MESSAGE_ATTACHMENT_MIME_EXTENSION[input.mimeType]}`
}

export function isOwnedMessageAttachmentStoragePath(input: {
  profileId: string
  conversationId: string
  storagePath: string
  mimeType: MessageAttachmentMime
}) {
  const parts = input.storagePath.split('/')
  if (
    parts.length !== 4
    || parts[0] !== 'messages'
    || parts[1] !== input.profileId
    || parts[2] !== input.conversationId
  ) return false

  const filename = parts[3] ?? ''
  const extension = MESSAGE_ATTACHMENT_MIME_EXTENSION[input.mimeType]
  const suffix = `.${extension}`
  if (!filename.endsWith(suffix)) return false
  const objectId = filename.slice(0, -suffix.length)
  return UUID_PATTERN.test(objectId)
}
