import type { PostReactionType } from '@/features/feed/types'

export type SocialDomainEventType =
  | 'user.followed'
  | 'connection.requested'
  | 'connection.accepted'
  | 'post.commented'
  | 'comment.replied'
  | 'post.reacted'
  | 'comment.reacted'
  | 'post.mentioned'
  | 'comment.mentioned'

export type SocialDomainEventPayload =
  | { eventType: 'user.followed'; actorId: string; targetId: string }
  | { eventType: 'connection.requested'; actorId: string; targetId: string; connectionId: string }
  | { eventType: 'connection.accepted'; actorId: string; targetId: string; connectionId: string; requestedBy: string }
  | { eventType: 'post.commented'; actorId: string; targetId: string; postId: string; commentId: string }
  | { eventType: 'comment.replied'; actorId: string; targetId: string; postId: string; commentId: string; parentCommentId: string }
  | { eventType: 'post.reacted'; actorId: string; targetId: string; postId: string; reactionType: PostReactionType }
  | { eventType: 'comment.reacted'; actorId: string; targetId: string; postId: string; commentId: string; reactionType: PostReactionType }
  | { eventType: 'post.mentioned'; actorId: string; targetId: string; postId: string }
  | { eventType: 'comment.mentioned'; actorId: string; targetId: string; postId: string; commentId: string }

export type DomainEvent = {
  id: string
  aggregateType: 'profile' | 'connection' | 'post' | 'comment'
  aggregateId: string
  eventType: SocialDomainEventType
  schemaVersion: 1
  occurredAt: string
  payload: SocialDomainEventPayload
}
