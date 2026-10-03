import type { NetworkNotification, NetworkNotificationType } from './types'

/**
 * Phone notification chips (round 8): All · Jobs · My posts · Mentions.
 * No notification type is about jobs yet, so the Jobs chip shows its empty state until job
 * notifications exist; connection, follower and event notifications appear under All only.
 */
export const NOTIFICATION_FILTERS = ['all', 'jobs', 'my_posts', 'mentions'] as const
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number]

export const NOTIFICATION_FILTER_LABELS: Record<NotificationFilter, string> = {
  all: 'All',
  jobs: 'Jobs',
  my_posts: 'My posts',
  mentions: 'Mentions',
}

export const NOTIFICATION_FILTER_TYPES: Record<Exclude<NotificationFilter, 'all'>, readonly NetworkNotificationType[]> = {
  jobs: [],
  my_posts: ['post_comment', 'comment_reply', 'post_reaction', 'comment_reaction'],
  mentions: ['post_mention', 'comment_mention'],
}

export function notificationMatchesFilter(notification: Pick<NetworkNotification, 'type'>, filter: NotificationFilter) {
  if (filter === 'all') return true
  return NOTIFICATION_FILTER_TYPES[filter].includes(notification.type)
}
