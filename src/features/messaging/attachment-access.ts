import { z } from 'zod'
import {
  isOwnedMessageAttachmentStoragePath,
  validateMessageAttachmentMetadata,
} from './media-policy'
import type { MessagingMessageRow } from './types'

const messageIdSchema = z.string().uuid()

export type MessageAttachmentAccessResult =
  | { ok: true; url: string }
  | { ok: false; status: 401 | 404 }

export type MessageAttachmentAccessDependencies = {
  /** Resolves the signed-in member or throws when there is no session. */
  requireUser: () => Promise<{ id: string }>
  isAuthenticationError: (error: unknown) => boolean
  /** Returns the message only when `profileId` is a participant of its conversation. */
  findMessageForParticipant: (profileId: string, messageId: string) => Promise<MessagingMessageRow | null>
  createReadUrl: (input: {
    storagePath: string
    name: string
    mimeType: string
    download: boolean
  }) => Promise<string>
}

/**
 * Authorises one attachment read. Every failure other than a missing session
 * is reported as "not found" so the route never reveals whether a message
 * exists in a conversation the viewer is not part of.
 */
export function createMessageAttachmentAccess(deps: MessageAttachmentAccessDependencies) {
  return async function resolveMessageAttachment(input: {
    messageId: string
    download: boolean
  }): Promise<MessageAttachmentAccessResult> {
    let viewer: { id: string }
    try {
      viewer = await deps.requireUser()
    } catch (error) {
      if (deps.isAuthenticationError(error)) return { ok: false, status: 401 }
      throw error
    }

    const parsed = messageIdSchema.safeParse(input.messageId)
    if (!parsed.success) return { ok: false, status: 404 }

    const message = await deps.findMessageForParticipant(viewer.id, parsed.data)
    if (
      !message
      || message.deleted_at
      || !message.attachment_storage_path
      || !message.attachment_name
      || !message.attachment_mime_type
    ) {
      return { ok: false, status: 404 }
    }

    const size = Number(message.attachment_size)
    const metadata = validateMessageAttachmentMetadata({
      name: message.attachment_name,
      mimeType: message.attachment_mime_type,
      size: Number.isSafeInteger(size) ? size : 1,
    })
    if (!metadata.ok) return { ok: false, status: 404 }

    // Defence in depth: only objects stored under the sender's own path for
    // this exact conversation can ever be served.
    if (!isOwnedMessageAttachmentStoragePath({
      profileId: message.sender_profile_id,
      conversationId: message.conversation_id,
      storagePath: message.attachment_storage_path,
      mimeType: metadata.mimeType,
    })) {
      return { ok: false, status: 404 }
    }

    const url = await deps.createReadUrl({
      storagePath: message.attachment_storage_path,
      name: metadata.name,
      mimeType: metadata.mimeType,
      download: input.download,
    })
    return { ok: true, url }
  }
}
