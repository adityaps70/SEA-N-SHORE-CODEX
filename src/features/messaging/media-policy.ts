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

/** Photos and videos open inline in the thread; everything else (and any `?download=1`) downloads. */
export function isInlineMessageAttachment(input: { mimeType: string; download?: boolean }) {
  if (input.download) return false
  return isImageMessageAttachmentMime(input.mimeType) || isVideoMessageAttachmentMime(input.mimeType)
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

/**
 * Bytes read from the start of an uploaded object to confirm that its content
 * really is the declared type. The browser-reported MIME type comes from the
 * file extension, so a renamed file would otherwise be accepted.
 */
export const MESSAGE_ATTACHMENT_SIGNATURE_BYTES = 1024

function startsWithBytes(bytes: Uint8Array, signature: readonly number[], offset = 0) {
  if (bytes.length < offset + signature.length) return false
  return signature.every((value, index) => bytes[offset + index] === value)
}

function ascii(value: string) {
  return [...value].map((character) => character.charCodeAt(0))
}

function containsAscii(bytes: Uint8Array, value: string, limit: number) {
  const needle = ascii(value)
  const end = Math.min(bytes.length, limit) - needle.length
  for (let index = 0; index <= end; index += 1) {
    if (startsWithBytes(bytes, needle, index)) return true
  }
  return false
}

const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
] as const
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const

function looksLikeText(bytes: Uint8Array) {
  // Plain text and CSV must not carry binary control bytes (NUL and friends).
  for (const value of bytes) {
    if (value === 0x09 || value === 0x0a || value === 0x0c || value === 0x0d) continue
    if (value < 0x20 || value === 0x7f) return false
  }
  return true
}

/**
 * True when the first bytes of an uploaded file match the declared attachment
 * type. Unknown types are always rejected.
 */
export function matchesMessageAttachmentSignature(mimeType: string, bytes: Uint8Array) {
  switch (mimeType) {
    case 'image/jpeg':
      return startsWithBytes(bytes, [0xff, 0xd8, 0xff])
    case 'image/png':
      return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/gif':
      return startsWithBytes(bytes, ascii('GIF87a')) || startsWithBytes(bytes, ascii('GIF89a'))
    case 'image/webp':
      return startsWithBytes(bytes, ascii('RIFF')) && startsWithBytes(bytes, ascii('WEBP'), 8)
    case 'video/mp4':
      return startsWithBytes(bytes, ascii('ftyp'), 4)
    case 'video/webm':
      return startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])
    case 'application/pdf':
      return containsAscii(bytes, '%PDF-', MESSAGE_ATTACHMENT_SIGNATURE_BYTES)
    case 'application/zip':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return ZIP_SIGNATURES.some((signature) => startsWithBytes(bytes, signature))
    case 'application/msword':
    case 'application/vnd.ms-excel':
    case 'application/vnd.ms-powerpoint':
      return startsWithBytes(bytes, OLE_SIGNATURE)
    case 'text/plain':
    case 'text/csv':
      return bytes.length > 0 && looksLikeText(bytes)
    default:
      return false
  }
}

/**
 * Same-origin route that checks the viewer is a participant of the
 * conversation before handing out a short-lived storage URL.
 */
export function messageAttachmentRoute(messageId: string, options: { download?: boolean } = {}) {
  const path = `/api/messages/attachments/${encodeURIComponent(messageId)}`
  return options.download ? `${path}?download=1` : path
}

function asciiFallbackFileName(name: string) {
  const fallback = name
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\/;]/g, '')
    .trim()
  return fallback || 'attachment'
}

/** Content-Disposition header value that is safe for any user-supplied file name. */
export function messageAttachmentContentDisposition(input: {
  name: string
  disposition: 'inline' | 'attachment'
}) {
  const cleaned = input.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'attachment'
  const encoded = encodeURIComponent(cleaned).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${input.disposition}; filename="${asciiFallbackFileName(cleaned)}"; filename*=UTF-8''${encoded}`
}
