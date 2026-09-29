import { randomUUID } from 'node:crypto'

/** Community images (round 9C): the banner (`cover_path`) and the rounded-square community photo (`icon_path`). */
export const COMMUNITY_MEDIA_KINDS = ['cover', 'icon'] as const
export type CommunityMediaKind = (typeof COMMUNITY_MEDIA_KINDS)[number]

export const COMMUNITY_IMAGE_MAX_BYTES = 5 * 1024 * 1024

const extensionByType: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** The upload and serving routes accept exactly these content types. */
export const COMMUNITY_IMAGE_CONTENT_TYPES: readonly string[] = Object.keys(extensionByType)

export function isCommunityMediaKind(value: string | null | undefined): value is CommunityMediaKind {
  return (COMMUNITY_MEDIA_KINDS as readonly string[]).includes(value ?? '')
}

export function isCommunityImageContentType(contentType: string | null | undefined) {
  return Boolean(contentType && extensionByType[contentType])
}

export function validateCommunityImage(file: { type: string; size: number }): { ok: true } | { ok: false; error: string } {
  if (!extensionByType[file.type]) {
    return { ok: false, error: 'Please upload a JPG, PNG or WebP image.' }
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > COMMUNITY_IMAGE_MAX_BYTES) {
    return { ok: false, error: 'Image must be 5 MB or smaller.' }
  }
  return { ok: true }
}

/** Private media-bucket key: `communities/<groupId>/<cover|icon>-<uuid>.<ext>`. */
export function buildCommunityMediaKey(groupId: string, kind: CommunityMediaKind, mimeType: string): string {
  const extension = extensionByType[mimeType]
  if (!extension) throw new Error('community_media_type_unsupported')
  return `communities/${groupId}/${kind}-${randomUUID()}.${extension}`
}
