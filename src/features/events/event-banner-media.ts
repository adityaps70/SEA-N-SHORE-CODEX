import { createMediaReadUrl, createMediaUploadUrl, headMediaObject } from '@/lib/aws/storage'
import {
  EVENT_BANNER_MAX_BYTES,
  buildEventBannerStoragePath,
  eventBannerExpectedMime,
  isEventBannerStoragePath,
  isLegacyEventBannerUrl,
  isOwnedEventBannerStoragePath,
  validateEventBannerMetadata,
} from './event-banner-policy'

export async function prepareEventBannerUpload(input: { profileId: string; mimeType: string; size: number }) {
  const metadata = validateEventBannerMetadata(input)
  if (!metadata.ok) throw new Error('event_banner_policy_invalid')

  const storagePath = buildEventBannerStoragePath(input.profileId, metadata.mimeType)
  const uploadUrl = await createMediaUploadUrl({ key: storagePath, contentType: metadata.mimeType })
  return { storagePath, uploadUrl, mimeType: metadata.mimeType, size: metadata.size }
}

export async function verifyEventBannerReference(profileId: string, reference: string | null): Promise<void> {
  if (!reference || isLegacyEventBannerUrl(reference)) return
  if (!isOwnedEventBannerStoragePath(profileId, reference)) throw new Error('event_banner_reference_invalid')

  const expectedMime = eventBannerExpectedMime(reference)
  if (!expectedMime) throw new Error('event_banner_reference_invalid')

  let stored: Awaited<ReturnType<typeof headMediaObject>>
  try {
    stored = await headMediaObject(reference)
  } catch {
    throw new Error('event_banner_unavailable')
  }

  if (stored.contentType !== expectedMime || !stored.contentLength || stored.contentLength > EVENT_BANNER_MAX_BYTES) {
    throw new Error('event_banner_metadata_mismatch')
  }
}

export async function resolveEventBannerReference(reference: string | null): Promise<string | null> {
  if (!reference) return null
  if (isLegacyEventBannerUrl(reference)) return reference
  if (!isEventBannerStoragePath(reference)) return null
  try {
    return await createMediaReadUrl(reference)
  } catch {
    return null
  }
}
