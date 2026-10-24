/**
 * Round P3: the real content of an upload, checked from its first bytes. The browser's MIME type comes from
 * the file name, so a renamed file would otherwise pass. Shared by every upload path (images, video, audio,
 * documents, captions, archives); unknown types are always refused.
 */
export const FILE_SIGNATURE_BYTES = 1024

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
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const

function looksLikeText(bytes: Uint8Array) {
  // Plain text, CSV and captions must not carry binary control bytes (NUL and friends).
  for (const value of bytes) {
    if (value === 0x09 || value === 0x0a || value === 0x0c || value === 0x0d) continue
    if (value < 0x20 || value === 0x7f) return false
  }
  return true
}

function isMp3(bytes: Uint8Array) {
  if (startsWithBytes(bytes, ascii('ID3'))) return true
  // An MPEG audio frame sync: 11 set bits, then a layer that is not "reserved".
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0 && (bytes[1]! & 0x06) !== 0
}

/** True when the first bytes of a file match its declared MIME type. */
export function matchesFileSignature(mimeType: string, bytes: Uint8Array) {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return startsWithBytes(bytes, [0xff, 0xd8, 0xff])
    case 'image/png':
      return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/gif':
      return startsWithBytes(bytes, ascii('GIF87a')) || startsWithBytes(bytes, ascii('GIF89a'))
    case 'image/webp':
      return startsWithBytes(bytes, ascii('RIFF')) && startsWithBytes(bytes, ascii('WEBP'), 8)
    case 'video/mp4':
    case 'audio/mp4':
    case 'audio/x-m4a':
      return startsWithBytes(bytes, ascii('ftyp'), 4)
    case 'video/webm':
    case 'audio/webm':
      return startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])
    case 'audio/mpeg':
      return isMp3(bytes)
    case 'audio/wav':
    case 'audio/x-wav':
      return startsWithBytes(bytes, ascii('RIFF')) && startsWithBytes(bytes, ascii('WAVE'), 8)
    case 'application/pdf':
      return containsAscii(bytes, '%PDF-', FILE_SIGNATURE_BYTES)
    case 'application/zip':
    case 'application/x-zip-compressed':
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
    case 'text/vtt': {
      const body = startsWithBytes(bytes, UTF8_BOM) ? bytes.subarray(3) : bytes
      return startsWithBytes(body, ascii('WEBVTT')) && looksLikeText(body)
    }
    default:
      return false
  }
}
