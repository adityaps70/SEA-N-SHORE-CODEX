import { randomUUID } from 'node:crypto'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { createNetworkRepositoryForClient, type NetworkRepository } from '@/features/network/repository'
import { createOutboxRepositoryForClient, type OutboxRepository } from '@/features/events/outbox-repository'
import type { DomainEvent } from '@/features/events/types'
import { sendMessageInputSchema } from './schemas'
import {
  createMessagingRepositoryForClient,
  type MessagingRepository,
} from './repository'
import type { SendMessageInput } from './types'

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

export function createMessagingService(input: { withTransaction: MessagingTransaction }) {
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

      return input.withTransaction(async ({ messaging, outbox }) => {
        if (!await messaging.isParticipant(actorId, data.conversationId)) {
          error('messaging_not_participant')
        }

        const existing = await messaging.findMessageByClientId(actorId, data.clientMessageId)
        if (existing) {
          if (existing.conversation_id !== data.conversationId || existing.body !== data.body) {
            error('messaging_idempotency_conflict')
          }
          return existing
        }

        const message = await messaging.insertMessage({
          conversationId: data.conversationId,
          senderProfileId: actorId,
          clientMessageId: data.clientMessageId,
          body: data.body,
        })
        const createdAt = iso(message.created_at)
        await messaging.updateConversationLastMessage(data.conversationId, message.id, createdAt)

        const participantIds = await messaging.listParticipantIds?.(data.conversationId) ?? []
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

    async markConversationRead(actorId: string, conversationId: string, messageId: string) {
      return input.withTransaction(async ({ messaging }) => {
        if (!await messaging.isParticipant(actorId, conversationId)) {
          error('messaging_not_participant')
        }
        const message = await messaging.findMessageInConversation(conversationId, messageId)
        if (!message) error('messaging_message_not_found')
        return messaging.advanceReadState(
          actorId,
          conversationId,
          messageId,
          iso(message.created_at),
        )
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
