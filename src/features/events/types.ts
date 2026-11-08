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
  | 'feed.post_created'
  | 'feed.post_reaction_changed'
  | 'feed.post_comments_changed'
  | 'feed.post_reposted'
  | 'message.created'
  | 'message.updated'
  | 'conversation.read_cursor_advanced'
  | 'notification.created'

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
  // Round ARCH (broadcast fix): audienceProfileIds is added by the outbox publisher just before publishing (never
  // stored in the outbox row): the members whose open connections get the hint. The fan-out pushes to no one else.
  | { eventType: 'feed.post_created'; actorId: string; postId: string; audienceProfileIds?: string[] }
  | { eventType: 'feed.post_reaction_changed'; actorId: string; postId: string; audienceProfileIds?: string[] }
  | { eventType: 'feed.post_comments_changed'; actorId: string; postId: string; audienceProfileIds?: string[] }
  | { eventType: 'feed.post_reposted'; actorId: string; postId: string; audienceProfileIds?: string[] }
  // Round ARCH (Phase 5): queued by a trigger on public.notifications (migration 0098). The outbox publisher adds the
  // recipient as the audience and their unread count; the fan-out pushes the count to the recipient only.
  | { eventType: 'notification.created'; recipientId: string; notificationId: string; audienceProfileIds?: string[]; unreadNotificationCount?: number }
  | {
      eventType: 'message.created'
      conversationId: string
      messageId: string
      senderId: string
      recipientProfileIds: string[]
    }
  | {
      eventType: 'message.updated'
      conversationId: string
      messageId: string
      actorId: string
      participantProfileIds: string[]
    }
  | {
      eventType: 'conversation.read_cursor_advanced'
      conversationId: string
      readerProfileId: string
      lastReadMessageId: string
      lastReadAt: string
      participantProfileIds: string[]
    }

export type DomainEvent = {
  id: string
  aggregateType: 'profile' | 'connection' | 'post' | 'comment' | 'message' | 'conversation' | 'notification'
  aggregateId: string
  eventType: SocialDomainEventType
  schemaVersion: 1
  occurredAt: string
  payload: SocialDomainEventPayload
}
