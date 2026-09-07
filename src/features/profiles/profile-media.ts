import { randomUUID } from 'node:crypto'

export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const extensionByType: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function validateProfileImage(file: { type: string; size: number }): { ok: true } | { ok: false; error: string } {
  if (!extensionByType[file.type]) {
    return { ok: false, error: 'Please upload a JPG, PNG or WebP image.' }
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > PROFILE_IMAGE_MAX_BYTES) {
    return { ok: false, error: 'Image must be 5 MB or smaller.' }
  }
  return { ok: true }
}

export function buildProfileMediaKey(profileId: string, kind: 'avatar' | 'cover', contentType: string): string {
  const extension = extensionByType[contentType]
  if (!extension) throw new Error('profile_media_type_unsupported')
  return `profiles/${profileId}/${kind}-${randomUUID()}.${extension}`
}
