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
  /** Round F: a member left an organization the recipient owns or administers. */
  | 'organization_member_left'
  /** Learning round A (A6): course, grade, certificate and review news. No actor; the words come from details. */
  | 'learning_enrolled'
  | 'learning_lessons_released'
  | 'learning_assignment_graded'
  | 'learning_certificate_issued'
  | 'learning_course_approved'
  | 'learning_course_changes_requested'
  | 'learning_submissions_to_grade'
  /** Learning round B: written quiz answers graded; a certificate expires in 30 or 7 days. */
  | 'learning_quiz_graded'
  | 'learning_certificate_expiring'
  /** Learning round C: a trainer posted an announcement to a course the recipient is enrolled in. */
  | 'learning_announcement'
  /** Learning round D: a live session of the recipient's batch starts in a day or an hour. */
  | 'learning_session_reminder'
  /** Algorithms round G (G3): new jobs matched one of the recipient's job alerts. No actor; details name the alert. */
  | 'job_alert_match'
  /** Round GP (Part C): Sea N Shore approved, rejected or asked for changes to the recipient's organization verification. */
  | 'organization_review_decided'

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
  /** Round F: the post was deleted or the recipient can no longer open it. */
  postUnavailable?: boolean
  /** Round G (G6): every notification this row stands for when reactions or comments were merged. */
  groupIds?: string[]
  groupCount?: number
  /** Round G (G6): mentions, tags, requests, job matches and event changes: marked until read. */
  important?: boolean
}

export type NotificationChrome = {
  recent: NetworkNotification[]
  unreadCount: number
}
