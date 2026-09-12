'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { messagingMessageDto } from './queries'
import {
  directConversationInputSchema,
  markConversationReadInputSchema,
  sendMessageInputSchema,
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
      return 'Enter a message before sending.'
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

export async function sendMessageAction(rawInput: SendMessageInput) {
  const parsed = sendMessageInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    const emptyBody = typeof rawInput?.body === 'string' && rawInput.body.trim().length === 0
    return {
      ok: false as const,
      error: emptyBody ? 'Enter a message before sending.' : 'Invalid message.',
    }
  }

  try {
    const user = await requireAwsUser()
    const message = await messagingService.sendMessage(user.id, parsed.data)
    revalidateMessaging(parsed.data.conversationId)
    return { ok: true as const, message: messagingMessageDto(message) }
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
    revalidateMessaging(parsed.data.conversationId)
    return { ok: true as const, advanced }
  } catch (error) {
    return {
      ok: false as const,
      error: messagingError(error instanceof Error ? error.message : undefined),
    }
  }
}
