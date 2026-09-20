import {
  createMediaReadUrl,
  createMediaUploadUrl,
  deleteMediaObject,
  headMediaObject,
} from '@/lib/aws/storage'
import {
  buildMessageAttachmentStoragePath,
  isOwnedMessageAttachmentStoragePath,
  validateMessageAttachmentMetadata,
  type MessageAttachmentMime,
} from './media-policy'

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

  if (stored.contentType !== metadata.mimeType || stored.contentLength !== input.size) {
    throw new Error('messaging_attachment_metadata_mismatch')
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

export async function createMessageAttachmentReadUrl(storagePath: string) {
  return createMediaReadUrl(storagePath)
}
