import type { PostReactionType } from '@/features/feed/types'

export type NetworkNotificationType =
  | 'connection_request'
  | 'connection_accepted'
  | 'new_follower'
  | 'post_comment'
  | 'comment_reply'
  | 'post_reaction'
  | 'comment_reaction'
  | 'post_mention'
  | 'comment_mention'

export type NotificationActor = {
  id: string
  slug: string
  fullName: string
}

export type NetworkNotification = {
  id: string
  type: NetworkNotificationType
  createdAt: string
  readAt: string | null
  actor: NotificationActor | null
  message: string
  destination: string
  postId?: string | null
  commentId?: string | null
  reactionType?: PostReactionType | null
}

export type NotificationChrome = {
  recent: NetworkNotification[]
  unreadCount: number
}
