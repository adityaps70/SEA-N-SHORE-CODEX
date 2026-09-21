import { randomUUID } from 'node:crypto'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { createNetworkRepositoryForClient, type NetworkRepository } from '@/features/network/repository'
import { createOutboxRepositoryForClient, type OutboxRepository } from '@/features/events/outbox-repository'
import type { DomainEvent } from '@/features/events/types'
import { editMessageInputSchema, sendMessageInputSchema, setMessageReactionInputSchema } from './schemas'
import {
  createMessagingRepositoryForClient,
  type MessagingRepository,
} from './repository'
import { isWithinMessageEditWindow } from './edit-policy'
import type { EditMessageInput, SendMessageInput } from './types'

type MessagingTransactionContext = {
  messaging: MessagingRepository
  network: NetworkRepository
  outbox: OutboxRepository
}

type MessagingTransaction = <T>(
  fn: (context: MessagingTransactionContext) => Promise<T>,
) => Promise<T>

function error(code: string): never {
  throw new Error(code)
}

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value
}

function messageUpdatedEvent(input: {
  conversationId: string
  messageId: string
  actorId: string
  participantProfileIds: string[]
}): DomainEvent {
  return {
    id: randomUUID(),
    aggregateType: 'message',
    aggregateId: input.messageId,
    eventType: 'message.updated',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      eventType: 'message.updated',
      conversationId: input.conversationId,
      messageId: input.messageId,
      actorId: input.actorId,
      participantProfileIds: input.participantProfileIds,
    },
  }
}

export function createMessagingService(input: {
  withTransaction: MessagingTransaction
  now?: () => Date
}) {
  const now = input.now ?? (() => new Date())

  return {
    async startDirectConversation(actorId: string, targetProfileId: string) {
      if (actorId === targetProfileId) error('messaging_self_conversation')

      return input.withTransaction(async ({ messaging, network }) => {
        const [connection, blocked] = await Promise.all([
          network.findConnectionByPair(actorId, targetProfileId),
          network.isPairBlocked(actorId, targetProfileId),
        ])
        if (!connection || connection.status !== 'accepted' || blocked) {
          error('messaging_not_allowed')
        }

        const existing = await messaging.findDirectConversationByPair(actorId, targetProfileId)
        if (existing) return existing.id
        return messaging.insertDirectConversation(actorId, targetProfileId)
      })
    },

    async sendMessage(actorId: string, rawInput: SendMessageInput) {
      const parsed = sendMessageInputSchema.safeParse(rawInput)
      if (!parsed.success) error('messaging_invalid_message')
      const data = parsed.data

      return input.withTransaction(async ({ messaging, network, outbox }) => {
        if (!await messaging.isParticipant(actorId, data.conversationId)) {
          error('messaging_not_participant')
        }

        const counterpartId = await messaging.findOtherParticipantId(
          data.conversationId,
          actorId,
        )
        if (!counterpartId) error('messaging_not_allowed')

        const [connection, blocked] = await Promise.all([
          network.findConnectionByPair(actorId, counterpartId),
          network.isPairBlocked(actorId, counterpartId),
        ])
        if (!connection || connection.status !== 'accepted' || blocked) {
          error('messaging_not_allowed')
        }

        if (data.replyToMessageId) {
          const replyTarget = await messaging.findMessageInConversation(
            data.conversationId,
            data.replyToMessageId,
          )
          if (!replyTarget || replyTarget.deleted_at) error('messaging_reply_unavailable')
        }

        const existing = await messaging.findMessageByClientId(actorId, data.clientMessageId)
        if (existing) {
          const sameAttachment = (existing.attachment_storage_path ?? null) === (data.attachment?.storagePath ?? null)
          if (
            existing.conversation_id !== data.conversationId
            || existing.body !== data.body
            || (existing.reply_to_message_id ?? null) !== (data.replyToMessageId ?? null)
            || !sameAttachment
          ) {
            error('messaging_idempotency_conflict')
          }
          return existing
        }

        const message = await messaging.insertMessage({
          conversationId: data.conversationId,
          senderProfileId: actorId,
          clientMessageId: data.clientMessageId,
          body: data.body,
          replyToMessageId: data.replyToMessageId,
          attachment: data.attachment,
        })
        const createdAt = iso(message.created_at)
        await messaging.updateConversationLastMessage(data.conversationId, message.id, createdAt)

        const participantIds = await messaging.listParticipantIds(data.conversationId)
        const recipientProfileIds = participantIds.filter((profileId) => profileId !== actorId)
        const event: DomainEvent = {
          id: randomUUID(),
          aggregateType: 'message',
          aggregateId: message.id,
          eventType: 'message.created',
          schemaVersion: 1,
          occurredAt: createdAt,
          payload: {
            eventType: 'message.created',
            conversationId: data.conversationId,
            messageId: message.id,
            senderId: actorId,
            recipientProfileIds,
          },
        }
        await outbox.enqueue(event)
        return message
      })
    },

    async editMessage(actorId: string, rawInput: EditMessageInput) {
      const parsed = editMessageInputSchema.safeParse(rawInput)
      if (!parsed.success) error('messaging_invalid_message')

      return input.withTransaction(async ({ messaging, outbox }) => {
        const message = await messaging.findMessageByIdForUpdate(parsed.data.messageId)
        if (!message || message.deleted_at) error('messaging_message_not_found')
        if (message.sender_profile_id !== actorId) error('messaging_action_not_allowed')
        if (!await messaging.isParticipant(actorId, message.conversation_id)) {
          error('messaging_not_participant')
        }

        const editedAt = now()
        if (!isWithinMessageEditWindow(message.created_at, editedAt)) {
          error('messaging_edit_window_expired')
        }

        const updated = await messaging.editMessageBody(
          message.id,
          parsed.data.body,
          editedAt.toISOString(),
        )
        const participantProfileIds = await messaging.listParticipantIds(message.conversation_id)
        await outbox.enqueue(messageUpdatedEvent({
          conversationId: message.conversation_id,
          messageId: message.id,
          actorId,
          participantProfileIds,
        }))
        return updated
      })
    },

    async setMessageReaction(actorId: string, messageId: string, emoji: string | null) {
      const parsed = setMessageReactionInputSchema.safeParse({ messageId, emoji })
      if (!parsed.success) error('messaging_invalid_reaction')

      return input.withTransaction(async ({ messaging, outbox }) => {
        const message = await messaging.findMessageAccessibleToParticipant(actorId, parsed.data.messageId)
        if (!message || message.deleted_at) error('messaging_message_not_found')

        await messaging.setMessageReaction(message.id, actorId, parsed.data.emoji)
        const participantProfileIds = await messaging.listParticipantIds(message.conversation_id)
        await outbox.enqueue(messageUpdatedEvent({
          conversationId: message.conversation_id,
          messageId: message.id,
          actorId,
          participantProfileIds,
        }))
        return true
      })
    },

    async deleteMessage(actorId: string, messageId: string) {
      return input.withTransaction(async ({ messaging, outbox }) => {
        const message = await messaging.findMessageByIdForUpdate(messageId)
        if (!message || message.deleted_at) error('messaging_message_not_found')
        if (message.sender_profile_id !== actorId) error('messaging_action_not_allowed')
        if (!await messaging.isParticipant(actorId, message.conversation_id)) {
          error('messaging_not_participant')
        }

        await messaging.softDeleteMessage(message.id)
        await messaging.refreshConversationLastMessage(message.conversation_id)
        const participantProfileIds = await messaging.listParticipantIds(message.conversation_id)
        await outbox.enqueue(messageUpdatedEvent({
          conversationId: message.conversation_id,
          messageId: message.id,
          actorId,
          participantProfileIds,
        }))
        return {
          conversationId: message.conversation_id,
          attachmentStoragePath: message.attachment_storage_path,
        }
      })
    },

    async markConversationRead(actorId: string, conversationId: string, messageId: string) {
      return input.withTransaction(async ({ messaging, outbox }) => {
        if (!await messaging.isParticipant(actorId, conversationId)) {
          error('messaging_not_participant')
        }
        const message = await messaging.findMessageInConversation(conversationId, messageId)
        if (!message) error('messaging_message_not_found')

        const lastReadAt = iso(message.created_at)
        const advanced = await messaging.advanceReadState(
          actorId,
          conversationId,
          messageId,
          lastReadAt,
        )
        if (!advanced) return false

        const participantProfileIds = await messaging.listParticipantIds(conversationId)
        const event: DomainEvent = {
          id: randomUUID(),
          aggregateType: 'conversation',
          aggregateId: conversationId,
          eventType: 'conversation.read_cursor_advanced',
          schemaVersion: 1,
          occurredAt: lastReadAt,
          payload: {
            eventType: 'conversation.read_cursor_advanced',
            conversationId,
            readerProfileId: actorId,
            lastReadMessageId: messageId,
            lastReadAt,
            participantProfileIds,
          },
        }
        await outbox.enqueue(event)
        return true
      })
    },
  }
}

export function createProductionMessagingService() {
  return createMessagingService({
    withTransaction: (fn) => databaseTransaction((client: DatabaseQueryClient) => fn({
      messaging: createMessagingRepositoryForClient(client),
      network: createNetworkRepositoryForClient(client),
      outbox: createOutboxRepositoryForClient(client),
    })),
  })
}
