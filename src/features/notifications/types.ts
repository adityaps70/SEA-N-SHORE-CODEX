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
  /** An event the member registered for was cancelled because its organiser deleted their account. */
  | 'event_cancelled'
  /** The member's (or their organization's) free Pro trial ends in 7 days / tomorrow. */
  | 'plan_trial_ending'
  /** Someone asked to join a private group the recipient administers (round 9B). */
  | 'group_join_request'
  /** The recipient's request to join a private group was approved. */
  | 'group_join_approved'
  /** A member posted in a group the recipient administers. */
  | 'group_post'
  /** Someone tagged an organization the recipient administers in a post or comment. */
  | 'organization_mention'
  /** Someone tagged the recipient in a photo. */
  | 'photo_tag'

export type NotificationActor = {
  id: string
  slug: string
  fullName: string
  /** Signed profile photo URL, when the member has one. */
  avatarUrl?: string | null
}

/** Small square preview of the post a notification is about. */
export type NotificationPostPreview = {
  postId: string
  /** First photo or video of the post, when it has one. */
  mediaUrl: string | null
  mediaType: 'image' | 'video' | null
  /** The first words of the post text. */
  text: string
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
  postPreview?: NotificationPostPreview | null
}

export type NotificationChrome = {
  recent: NetworkNotification[]
  unreadCount: number
}
