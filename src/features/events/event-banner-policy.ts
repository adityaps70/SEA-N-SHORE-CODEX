export const EVENT_BANNER_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const EVENT_BANNER_MAX_BYTES = 8 * 1024 * 1024

export type EventBannerMime = typeof EVENT_BANNER_MIME_TYPES[number]

const extensionByMime: Record<EventBannerMime, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const mimeByExtension: Record<'jpg' | 'png' | 'webp', EventBannerMime> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const eventBannerPathPattern = new RegExp(`^events/(${uuid})/banners/(${uuid})\\.(jpg|png|webp)$`, 'i')

export function validateEventBannerMetadata(input: { mimeType: string; size: number }) {
  const mimeType = EVENT_BANNER_MIME_TYPES.find((value) => value === input.mimeType)
  if (!mimeType) return { ok: false as const, error: 'Use a JPEG, PNG or WebP image.' }
  if (!Number.isInteger(input.size) || input.size <= 0 || input.size > EVENT_BANNER_MAX_BYTES) {
    return { ok: false as const, error: 'Banner images must be 8 MB or smaller.' }
  }
  return { ok: true as const, mimeType, size: input.size }
}

export function buildEventBannerStoragePath(profileId: string, mimeType: EventBannerMime) {
  return `events/${profileId}/banners/${crypto.randomUUID()}.${extensionByMime[mimeType]}`
}

export function eventBannerExpectedMime(storagePath: string): EventBannerMime | null {
  const match = eventBannerPathPattern.exec(storagePath)
  const extension = match?.[3]?.toLowerCase() as 'jpg' | 'png' | 'webp' | undefined
  return extension ? mimeByExtension[extension] : null
}

export function isEventBannerStoragePath(reference: string) {
  return eventBannerPathPattern.test(reference)
}

export function isOwnedEventBannerStoragePath(profileId: string, reference: string) {
  const match = eventBannerPathPattern.exec(reference)
  return Boolean(match && match[1]?.toLowerCase() === profileId.toLowerCase())
}

export function isLegacyEventBannerUrl(reference: string) {
  try {
    const url = new URL(reference)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function isEventBannerReference(reference: string) {
  return isLegacyEventBannerUrl(reference) || isEventBannerStoragePath(reference)
}
