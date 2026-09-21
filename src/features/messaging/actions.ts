'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  createPendingMessageAttachmentUpload,
  removeMessageAttachment,
  verifyPendingMessageAttachment,
} from './media'
import {
  isOwnedMessageAttachmentStoragePath,
  validateMessageAttachmentMetadata,
} from './media-policy'
import { hydratedMessagingMessageDto } from './queries'
import { messagingRepository } from './repository'
import {
  deleteMessageInputSchema,
  directConversationInputSchema,
  editMessageInputSchema,
  markConversationReadInputSchema,
  sendMessageInputSchema,
  setMessageReactionInputSchema,
} from './schemas'
import { createProductionMessagingService } from './service'
import type { SendMessageInput } from './types'

const messagingService = createProductionMessagingService()

function messagingError(message?: string) {
  switch (message) {
    case 'messaging_not_allowed':
      return 'You can message accepted connections only.'
    case 'messaging_self_conversation':
      return 'You cannot message yourself.'
    case 'messaging_not_participant':
    case 'messaging_message_not_found':
      return 'This conversation is not available.'
    case 'messaging_invalid_message':
      return 'Enter a message or attach a file before sending.'
    case 'messaging_invalid_reaction':
      return 'Choose one emoji reaction.'
    case 'messaging_reply_unavailable':
      return 'The message you are replying to is no longer available.'
    case 'messaging_action_not_allowed':
      return 'You can only edit or remove messages you sent.'
    case 'messaging_edit_window_expired':
      return 'Messages can only be edited within 5 minutes of sending.'
    case 'messaging_idempotency_conflict':
      return 'This message could not be reconciled. Please retry.'
    default:
      return 'We could not update this conversation. Please try again.'
  }
}

function revalidateMessaging(conversationId?: string) {
  revalidatePath('/messages')
  if (conversationId) revalidatePath(`/messages/${conversationId}`)
}

async function bestEffortRemoveUnreferencedAttachment(storagePath: string) {
  try {
    if (!await messagingRepository.isAttachmentReferenced(storagePath)) {
      await removeMessageAttachment(storagePath)
    }
  } catch {
    // Pending-object cleanup is best effort. A referenced attachment must never be deleted.
  }
}

export async function startDirectConversationAction(targetProfileId: string) {
  const parsed = directConversationInputSchema.safeParse({ targetProfileId })
  if (!parsed.success) return { ok: false as const, error: 'Invalid member.' }

  try {
    const user = await requireAwsUser()
    const conversationId = await messagingService.startDirectConversation(
      user.id,
      parsed.data.targetProfileId,
    )
    revalidateMessaging(conversationId)
    return { ok: true as const, conversationId }
  } catch (error) {
    return {
      ok: false as const,
      error: messagingError(error instanceof Error ? error.message : undefined),
    }
  }
}

export async function createMessageAttachmentUploadAction(input: {
  conversationId: string
  name: string
  mimeType: string
  size: number
}) {
  const metadata = validateMessageAttachmentMetadata(input)
  if (!metadata.ok) return { ok: false as const, error: metadata.error }

  try {
    const user = await requireAwsUser()
    if (!await messagingRepository.isParticipant(user.id, input.conversationId)) {
      return { ok: false as const, error: 'This conversation is not available.' }
    }
    const upload = await createPendingMessageAttachmentUpload({
      profileId: user.id,
      conversationId: input.conversationId,
      name: metadata.name,
      mimeType: metadata.mimeType,
      size: input.size,
    })
    return { ok: true as const, upload }
  } catch {
    return { ok: false as const, error: 'We could not prepare this attachment. Please try again.' }
  }
}

export async function discardMessageAttachmentAction(input: {
  conversationId: string
  storagePath: string
  name: string
  mimeType: string
  size: number
}) {
  const metadata = validateMessageAttachmentMetadata(input)
  if (!metadata.ok) return { ok: false as const, error: 'Invalid attachment.' }

  try {
    const user = await requireAwsUser()
    if (!isOwnedMessageAttachmentStoragePath({
      profileId: user.id,
      conversationId: input.conversationId,
      storagePath: input.storagePath,
      mimeType: metadata.mimeType,
    })) {
      return { ok: false as const, error: 'Invalid attachment.' }
    }
    if (await messagingRepository.isAttachmentReferenced(input.storagePath)) {
      return { ok: false as const, error: 'This attachment is already part of a message.' }
    }
    await removeMessageAttachment(input.storagePath)
    return { ok: true as const }
  } catch {
    return { ok: false as const, error: 'We could not remove this attachment.' }
  }
}

export async function sendMessageAction(rawInput: SendMessageInput) {
  const parsed = sendMessageInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false as const,
      error: 'Enter a message or attach a file before sending.',
    }
  }

  let user: Awaited<ReturnType<typeof requireAwsUser>>
  try {
    user = await requireAwsUser()
  } catch {
    return { ok: false as const, error: 'Please sign in to send a message.' }
  }

  if (parsed.data.attachment) {
    try {
      await verifyPendingMessageAttachment({
        profileId: user.id,
        conversationId: parsed.data.conversationId,
        ...parsed.data.attachment,
      })
    } catch {
      return {
        ok: false as const,
        error: 'We could not verify this attachment. Please attach it again.',
      }
    }
  }

  try {
    const message = await messagingService.sendMessage(user.id, parsed.data)
    revalidateMessaging(parsed.data.conversationId)
    return {
      ok: true as const,
      message: await hydratedMessagingMessageDto(message),
    }
  } catch (error) {
    if (parsed.data.attachment) {
      await bestEffortRemoveUnreferencedAttachment(parsed.data.attachment.storagePath)
    }
    return {
      ok: false as const,
      error: messagingError(error instanceof Error ? error.message : undefined),
    }
  }
}

export async function editMessageAction(messageId: string, body: string) {
  const parsed = editMessageInputSchema.safeParse({ messageId, body })
  if (!parsed.success) return { ok: false as const, error: 'Enter a message before saving.' }

  try {
    const user = await requireAwsUser()
    const message = await messagingService.editMessage(user.id, parsed.data)
    revalidateMessaging(message.conversation_id)
    return {
      ok: true as const,
      message: await hydratedMessagingMessageDto(message),
    }
  } catch (error) {
    return {
      ok: false as const,
      error: messagingError(error instanceof Error ? error.message : undefined),
    }
  }
}

export async function setMessageReactionAction(messageId: string, emoji: string | null) {
  const parsed = setMessageReactionInputSchema.safeParse({ messageId, emoji })
  if (!parsed.success) return { ok: false as const, error: 'Choose one emoji reaction.' }

  try {
    const user = await requireAwsUser()
    await messagingService.setMessageReaction(user.id, parsed.data.messageId, parsed.data.emoji)
    revalidateMessaging()
    return { ok: true as const }
  } catch (error) {
    return {
      ok: false as const,
      error: messagingError(error instanceof Error ? error.message : undefined),
    }
  }
}

export async function deleteMessageAction(messageId: string) {
  const parsed = deleteMessageInputSchema.safeParse({ messageId })
  if (!parsed.success) return { ok: false as const, error: 'Invalid message.' }

  try {
    const user = await requireAwsUser()
    const removed = await messagingService.deleteMessage(user.id, parsed.data.messageId)
    if (removed.attachmentStoragePath) {
      try { await removeMessageAttachment(removed.attachmentStoragePath) } catch { /* best effort */ }
    }
    revalidateMessaging(removed.conversationId)
    return { ok: true as const, messageId: parsed.data.messageId }
  } catch (error) {
    return {
      ok: false as const,
      error: messagingError(error instanceof Error ? error.message : undefined),
    }
  }
}

export async function markConversationReadAction(conversationId: string, messageId: string) {
  const parsed = markConversationReadInputSchema.safeParse({ conversationId, messageId })
  if (!parsed.success) return { ok: false as const, error: 'Invalid conversation.' }

  try {
    const user = await requireAwsUser()
    const advanced = await messagingService.markConversationRead(
      user.id,
      parsed.data.conversationId,
      parsed.data.messageId,
    )
    const unreadCount = await messagingRepository.countUnreadMessages(user.id)
    revalidateMessaging(parsed.data.conversationId)
    return { ok: true as const, advanced, unreadCount }
  } catch (error) {
    return {
      ok: false as const,
      error: messagingError(error instanceof Error ? error.message : undefined),
    }
  }
}
