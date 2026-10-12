import type { NetworkNotification, NetworkNotificationType } from './types'

/**
 * Notification chips (round 8 on phones; round F on every screen): All · Jobs · My posts · Mentions,
 * plus Learning (learning round A). Mentions covers @mentions of the member or an organization they
 * manage, and photo tags. No notification type is about jobs yet, so the Jobs chip shows its empty
 * state until job notifications exist; connection, follower and event notifications appear under All only.
 */
export const NOTIFICATION_FILTERS = ['all', 'jobs', 'my_posts', 'mentions', 'learning'] as const
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number]

export const NOTIFICATION_FILTER_LABELS: Record<NotificationFilter, string> = {
  all: 'All',
  jobs: 'Jobs',
  my_posts: 'My posts',
  mentions: 'Mentions',
  learning: 'Learning',
}

export const NOTIFICATION_FILTER_TYPES: Record<Exclude<NotificationFilter, 'all'>, readonly NetworkNotificationType[]> = {
  jobs: [],
  my_posts: ['post_comment', 'comment_reply', 'post_reaction', 'comment_reaction'],
  mentions: ['post_mention', 'comment_mention', 'photo_tag', 'organization_mention'],
  learning: [
    'learning_enrolled', 'learning_lessons_released', 'learning_assignment_graded', 'learning_certificate_issued',
    'learning_course_approved', 'learning_course_changes_requested', 'learning_submissions_to_grade',
    'learning_quiz_graded', 'learning_certificate_expiring', 'learning_announcement', 'learning_session_reminder',
  ],
}

export function notificationMatchesFilter(notification: Pick<NetworkNotification, 'type'>, filter: NotificationFilter) {
  if (filter === 'all') return true
  return NOTIFICATION_FILTER_TYPES[filter].includes(notification.type)
}
