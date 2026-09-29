import {
  createMediaDownloadUrl,
  createMediaUploadUrl,
  deleteMediaObject,
  headMediaObject,
  readMediaObjectPrefix,
} from '@/lib/aws/storage'
import {
  buildMessageAttachmentStoragePath,
  isInlineMessageAttachment,
  isOwnedMessageAttachmentStoragePath,
  matchesMessageAttachmentSignature,
  MESSAGE_ATTACHMENT_SIGNATURE_BYTES,
  messageAttachmentContentDisposition,
  validateMessageAttachmentMetadata,
  type MessageAttachmentMime,
} from './media-policy'

/**
 * Signed storage URLs handed out by the attachment route for downloads live for five minutes.
 * Inline photos and videos use the per-hour cache window of `createMediaDownloadUrl` instead, so
 * a photo scrolled past twice is served from the browser cache the second time.
 */
export const MESSAGE_ATTACHMENT_READ_URL_SECONDS = 300

export async function createPendingMessageAttachmentUpload(input: {
  profileId: string
  conversationId: string
  name: string
  mimeType: string
  size: number
}) {
  const metadata = validateMessageAttachmentMetadata(input)
  if (!metadata.ok) throw new Error('messaging_attachment_policy_invalid')

  const storagePath = buildMessageAttachmentStoragePath({
    profileId: input.profileId,
    conversationId: input.conversationId,
    mimeType: metadata.mimeType,
  })
  const uploadUrl = await createMediaUploadUrl({
    key: storagePath,
    contentType: metadata.mimeType,
  })

  return {
    storagePath,
    name: metadata.name,
    mimeType: metadata.mimeType,
    size: input.size,
    kind: metadata.kind,
    uploadUrl,
  }
}

function normalizedMediaType(value: string | null) {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? null
}

async function discardRejectedUpload(storagePath: string) {
  try {
    await deleteMediaObject(storagePath)
  } catch {
    // Best effort: an unreferenced pending object is never served by the attachment route.
  }
}

export async function verifyPendingMessageAttachment(input: {
  profileId: string
  conversationId: string
  storagePath: string
  name: string
  mimeType: string
  size: number
}) {
  const metadata = validateMessageAttachmentMetadata(input)
  if (!metadata.ok) throw new Error('messaging_attachment_policy_invalid')

  if (!isOwnedMessageAttachmentStoragePath({
    profileId: input.profileId,
    conversationId: input.conversationId,
    storagePath: input.storagePath,
    mimeType: metadata.mimeType,
  })) {
    throw new Error('messaging_attachment_reference_invalid')
  }

  let stored: Awaited<ReturnType<typeof headMediaObject>>
  try {
    stored = await headMediaObject(input.storagePath)
  } catch {
    throw new Error('messaging_attachment_unavailable')
  }

  if (
    normalizedMediaType(stored.contentType) !== metadata.mimeType.toLowerCase()
    || stored.contentLength !== input.size
  ) {
    await discardRejectedUpload(input.storagePath)
    throw new Error('messaging_attachment_metadata_mismatch')
  }

  let prefix: Uint8Array
  try {
    prefix = await readMediaObjectPrefix(
      input.storagePath,
      Math.min(MESSAGE_ATTACHMENT_SIGNATURE_BYTES, input.size),
    )
  } catch {
    throw new Error('messaging_attachment_unavailable')
  }

  if (!matchesMessageAttachmentSignature(metadata.mimeType, prefix)) {
    await discardRejectedUpload(input.storagePath)
    throw new Error('messaging_attachment_content_mismatch')
  }

  return {
    storagePath: input.storagePath,
    name: metadata.name,
    mimeType: metadata.mimeType as MessageAttachmentMime,
    size: input.size,
  }
}

export async function removeMessageAttachment(storagePath: string) {
  await deleteMediaObject(storagePath)
}

/**
 * Storage URL for an attachment the caller has already authorised. Photos and
 * videos open inline on a cacheable, hour-stable URL; everything else downloads
 * on a five-minute URL.
 */
export async function createMessageAttachmentReadUrl(input: {
  storagePath: string
  name: string
  mimeType: string
  download?: boolean
}) {
  const inline = isInlineMessageAttachment(input)
  return createMediaDownloadUrl({
    key: input.storagePath,
    contentType: input.mimeType,
    contentDisposition: messageAttachmentContentDisposition({
      name: input.name,
      disposition: inline ? 'inline' : 'attachment',
    }),
    ...(inline ? { cacheWindow: true } : { expiresInSeconds: MESSAGE_ATTACHMENT_READ_URL_SECONDS }),
  })
}
