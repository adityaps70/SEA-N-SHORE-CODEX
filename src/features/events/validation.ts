import { z } from 'zod'
import { POST_REACTIONS } from '@/features/feed/types'

const uuid = z.string().uuid()
const occurredAt = z.string().datetime()
const reaction = z.enum(POST_REACTIONS)
const envelope = { id: uuid, aggregateId: uuid, schemaVersion: z.literal(1), occurredAt }

const followedEvent = z.object({
  ...envelope,
  aggregateType: z.literal('profile'),
  eventType: z.literal('user.followed'),
  payload: z.object({ eventType: z.literal('user.followed'), actorId: uuid, targetId: uuid }),
})

const connectionRequestedEvent = z.object({
  ...envelope,
  aggregateType: z.literal('connection'),
  eventType: z.literal('connection.requested'),
  payload: z.object({ eventType: z.literal('connection.requested'), actorId: uuid, targetId: uuid, connectionId: uuid }),
})

const connectionAcceptedEvent = z.object({
  ...envelope,
  aggregateType: z.literal('connection'),
  eventType: z.literal('connection.accepted'),
  payload: z.object({ eventType: z.literal('connection.accepted'), actorId: uuid, targetId: uuid, connectionId: uuid, requestedBy: uuid }),
})

const postCommentedEvent = z.object({
  ...envelope,
  aggregateType: z.literal('post'),
  eventType: z.literal('post.commented'),
  payload: z.object({ eventType: z.literal('post.commented'), actorId: uuid, targetId: uuid, postId: uuid, commentId: uuid }),
})

const commentRepliedEvent = z.object({
  ...envelope,
  aggregateType: z.literal('comment'),
  eventType: z.literal('comment.replied'),
  payload: z.object({ eventType: z.literal('comment.replied'), actorId: uuid, targetId: uuid, postId: uuid, commentId: uuid, parentCommentId: uuid }),
})

const postReactedEvent = z.object({
  ...envelope,
  aggregateType: z.literal('post'),
  eventType: z.literal('post.reacted'),
  payload: z.object({ eventType: z.literal('post.reacted'), actorId: uuid, targetId: uuid, postId: uuid, reactionType: reaction }),
})

const commentReactedEvent = z.object({
  ...envelope,
  aggregateType: z.literal('comment'),
  eventType: z.literal('comment.reacted'),
  payload: z.object({ eventType: z.literal('comment.reacted'), actorId: uuid, targetId: uuid, postId: uuid, commentId: uuid, reactionType: reaction }),
})

const postMentionedEvent = z.object({
  ...envelope,
  aggregateType: z.literal('post'),
  eventType: z.literal('post.mentioned'),
  payload: z.object({ eventType: z.literal('post.mentioned'), actorId: uuid, targetId: uuid, postId: uuid }),
})

const commentMentionedEvent = z.object({
  ...envelope,
  aggregateType: z.literal('comment'),
  eventType: z.literal('comment.mentioned'),
  payload: z.object({ eventType: z.literal('comment.mentioned'), actorId: uuid, targetId: uuid, postId: uuid, commentId: uuid }),
})

export const domainEventSchema = z.discriminatedUnion('eventType', [
  followedEvent,
  connectionRequestedEvent,
  connectionAcceptedEvent,
  postCommentedEvent,
  commentRepliedEvent,
  postReactedEvent,
  commentReactedEvent,
  postMentionedEvent,
  commentMentionedEvent,
])

export function parseDomainEvent(value: unknown) {
  return domainEventSchema.parse(value)
}
