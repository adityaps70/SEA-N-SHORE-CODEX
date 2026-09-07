import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import type { DomainEvent } from '@/features/events/types'
import {
  createNotificationEventRepositoryForClient,
  type NotificationEventRepository,
} from './repository'

type NotificationTransaction = <T>(fn: (repository: NotificationEventRepository) => Promise<T>) => Promise<T>

function notificationInput(event: DomainEvent) {
  switch (event.eventType) {
    case 'user.followed':
      if (event.payload.eventType !== 'user.followed') throw new Error('notification_event_invalid_payload')
      return {
        eventId: event.id,
        recipientId: event.payload.targetId,
        actorId: event.payload.actorId,
        type: 'new_follower' as const,
      }
    case 'connection.requested':
      if (event.payload.eventType !== 'connection.requested') throw new Error('notification_event_invalid_payload')
      return {
        eventId: event.id,
        recipientId: event.payload.targetId,
        actorId: event.payload.actorId,
        type: 'connection_request' as const,
        connectionId: event.payload.connectionId,
      }
    case 'connection.accepted':
      if (event.payload.eventType !== 'connection.accepted') throw new Error('notification_event_invalid_payload')
      return {
        eventId: event.id,
        recipientId: event.payload.targetId,
        actorId: event.payload.actorId,
        type: 'connection_accepted' as const,
        connectionId: event.payload.connectionId,
      }
  }
}

export function createNotificationEventConsumer(input: { withTransaction: NotificationTransaction }) {
  return {
    async consume(event: DomainEvent) {
      const mapped = notificationInput(event)
      return input.withTransaction((repository) => repository.createNotificationFromEvent(mapped))
    },
  }
}

const productionConsumer = createNotificationEventConsumer({
  withTransaction: (fn) => databaseTransaction((client: DatabaseQueryClient) =>
    fn(createNotificationEventRepositoryForClient(client))),
})

export const consumeNotificationEvent = productionConsumer.consume
