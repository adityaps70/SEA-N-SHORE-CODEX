import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import type { DomainEvent } from '@/features/events/types'
import {
  createNotificationEventRepositoryForClient,
  type NotificationEventMode,
  type NotificationEventRepository,
} from './repository'

type NotificationTransaction = <T>(fn: (repository: NotificationEventRepository) => Promise<T>) => Promise<T>

function notificationInput(event: DomainEvent) {
  const payload = event.payload
  if (payload.eventType !== event.eventType) throw new Error('notification_event_invalid_payload')
  switch (event.eventType) {
    case 'user.followed':
      if (payload.eventType !== 'user.followed') throw new Error('notification_event_invalid_payload')
      return { eventId: event.id, recipientId: payload.targetId, actorId: payload.actorId, type: 'new_follower' as const }
    case 'connection.requested':
      if (payload.eventType !== 'connection.requested') throw new Error('notification_event_invalid_payload')
      return { eventId: event.id, recipientId: payload.targetId, actorId: payload.actorId, type: 'connection_request' as const, connectionId: payload.connectionId }
    case 'connection.accepted':
      if (payload.eventType !== 'connection.accepted') throw new Error('notification_event_invalid_payload')
      return { eventId: event.id, recipientId: payload.targetId, actorId: payload.actorId, type: 'connection_accepted' as const, connectionId: payload.connectionId }
    case 'post.commented':
      if (payload.eventType !== 'post.commented') throw new Error('notification_event_invalid_payload')
      return { eventId: event.id, recipientId: payload.targetId, actorId: payload.actorId, type: 'post_comment' as const, postId: payload.postId, commentId: payload.commentId }
    case 'comment.replied':
      if (payload.eventType !== 'comment.replied') throw new Error('notification_event_invalid_payload')
      return { eventId: event.id, recipientId: payload.targetId, actorId: payload.actorId, type: 'comment_reply' as const, postId: payload.postId, commentId: payload.commentId }
    case 'post.reacted':
      if (payload.eventType !== 'post.reacted') throw new Error('notification_event_invalid_payload')
      return { eventId: event.id, recipientId: payload.targetId, actorId: payload.actorId, type: 'post_reaction' as const, postId: payload.postId, reactionType: payload.reactionType }
    case 'comment.reacted':
      if (payload.eventType !== 'comment.reacted') throw new Error('notification_event_invalid_payload')
      return { eventId: event.id, recipientId: payload.targetId, actorId: payload.actorId, type: 'comment_reaction' as const, postId: payload.postId, commentId: payload.commentId, reactionType: payload.reactionType }
    case 'post.mentioned':
      if (payload.eventType !== 'post.mentioned') throw new Error('notification_event_invalid_payload')
      return { eventId: event.id, recipientId: payload.targetId, actorId: payload.actorId, type: 'post_mention' as const, postId: payload.postId }
    case 'comment.mentioned':
      if (payload.eventType !== 'comment.mentioned') throw new Error('notification_event_invalid_payload')
      return { eventId: event.id, recipientId: payload.targetId, actorId: payload.actorId, type: 'comment_mention' as const, postId: payload.postId, commentId: payload.commentId }
  }
}

export function createNotificationEventConsumer(input: {
  mode: NotificationEventMode
  withTransaction: NotificationTransaction
}) {
  return {
    async consume(event: DomainEvent) {
      const mapped = notificationInput(event)
      return input.withTransaction((repository) => repository.processNotificationEvent({ ...mapped, mode: input.mode }))
    },
  }
}

export function createProductionNotificationEventConsumer(mode: NotificationEventMode) {
  return createNotificationEventConsumer({
    mode,
    withTransaction: (fn) => databaseTransaction((client: DatabaseQueryClient) => fn(createNotificationEventRepositoryForClient(client))),
  })
}
