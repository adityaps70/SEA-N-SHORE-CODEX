import { randomUUID } from 'node:crypto'
import { FILE_SIGNATURE_BYTES, matchesFileSignature } from '@/lib/uploads/file-signature'

export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const extensionByType: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** The messages a member may see from an upload; anything else (storage errors, internal codes) stays private. */
export const PROFILE_IMAGE_MESSAGES = [
  'Please upload a JPG, PNG or WebP image.',
  'Image must be 5 MB or smaller.',
  'This file is not a real JPG, PNG or WebP image. Choose another image.',
] as const

export function profileMediaErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && (PROFILE_IMAGE_MESSAGES as readonly string[]).includes(error.message) ? error.message : fallback
}

export function validateProfileImage(file: { type: string; size: number; bytes?: Uint8Array }): { ok: true } | { ok: false; error: string } {
  if (!extensionByType[file.type]) {
    return { ok: false, error: 'Please upload a JPG, PNG or WebP image.' }
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > PROFILE_IMAGE_MAX_BYTES) {
    return { ok: false, error: 'Image must be 5 MB or smaller.' }
  }
  // Round P3: the bytes must really be the declared image type.
  if (file.bytes && !matchesFileSignature(file.type, file.bytes.subarray(0, FILE_SIGNATURE_BYTES))) {
    return { ok: false, error: 'This file is not a real JPG, PNG or WebP image. Choose another image.' }
  }
  return { ok: true }
}

export function buildProfileMediaKey(profileId: string, kind: 'avatar' | 'cover', contentType: string): string {
  const extension = extensionByType[contentType]
  if (!extension) throw new Error('profile_media_type_unsupported')
  return `profiles/${profileId}/${kind}-${randomUUID()}.${extension}`
}
