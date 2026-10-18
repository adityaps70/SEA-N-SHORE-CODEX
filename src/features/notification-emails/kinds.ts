/**
 * Round H (H3): the four member activity email types, their member_preferences columns (migration 0088) and the
 * words Settings › Email notifications and the unsubscribe page use. Client-safe: no server imports.
 *
 * Defaults: every type is on (no row, or a NULL, means on). These are service emails about the member's own
 * account activity, like the learning and job alert emails that are already on by default; the newsletter is
 * marketing and stays double opt-in. Every email carries a one-click unsubscribe for its own type.
 */
export const NOTIFICATION_EMAIL_KINDS = ['messages', 'connection_requests', 'comments', 'mentions'] as const
export type NotificationEmailKind = (typeof NOTIFICATION_EMAIL_KINDS)[number]

export function isNotificationEmailKind(value: unknown): value is NotificationEmailKind {
  return (NOTIFICATION_EMAIL_KINDS as readonly unknown[]).includes(value)
}

/** The member_preferences column for each type. Fixed strings only: never built from input. */
export const NOTIFICATION_EMAIL_COLUMNS: Record<NotificationEmailKind, string> = {
  messages: 'email_messages_digest',
  connection_requests: 'email_connection_requests',
  comments: 'email_comments',
  mentions: 'email_mentions',
}

export const NOTIFICATION_EMAIL_DEFAULTS: Record<NotificationEmailKind, boolean> = {
  messages: true,
  connection_requests: true,
  comments: true,
  mentions: true,
}

/** The in-app notification types each email type follows (messages are a digest, not a notification). */
export const NOTIFICATION_TYPES_BY_KIND = {
  connection_requests: ['connection_request'],
  comments: ['post_comment', 'comment_reply'],
  mentions: ['post_mention', 'comment_mention', 'photo_tag'],
} as const satisfies Record<Exclude<NotificationEmailKind, 'messages'>, readonly string[]>

export type ActivityNotificationType = (typeof NOTIFICATION_TYPES_BY_KIND)[keyof typeof NOTIFICATION_TYPES_BY_KIND][number]

export const NOTIFICATION_EMAIL_COPY: Record<NotificationEmailKind, {
  title: string
  description: string
  onText: string
  offText: string
  /** "Turn off …" in email footers and on the unsubscribe page. */
  turnOff: string
}> = {
  messages: {
    title: 'Unread messages',
    description: 'At most one email an hour when you have unread messages, with how many and who they are from. Message text is never included.',
    onText: 'Message emails are on.',
    offText: 'Message emails are off. New messages still appear in Messages.',
    turnOff: 'unread message emails',
  },
  connection_requests: {
    title: 'Connection requests',
    description: 'When someone asks to connect with you.',
    onText: 'Connection request emails are on.',
    offText: 'Connection request emails are off. Requests still appear in My Network.',
    turnOff: 'connection request emails',
  },
  comments: {
    title: 'Comments on your posts',
    description: 'When someone comments on your post or replies to your comment.',
    onText: 'Comment emails are on.',
    offText: 'Comment emails are off. Comments still appear in Notifications.',
    turnOff: 'comment emails',
  },
  mentions: {
    title: 'Mentions and tags',
    description: 'When someone mentions you in a post or comment, or tags you in a photo.',
    onText: 'Mention and tag emails are on.',
    offText: 'Mention and tag emails are off. Mentions still appear in Notifications.',
    turnOff: 'mention and tag emails',
  },
}
