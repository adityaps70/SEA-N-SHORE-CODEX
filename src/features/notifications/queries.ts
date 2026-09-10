import { requireAwsUser } from '@/features/auth/aws-queries'
import { POST_REACTION_META } from '@/features/feed/types'
import { getAwsPublicProfilesByIds } from '@/features/profiles/aws-queries'
import { createNotificationRepository, type NotificationRow } from './repository'
import type { NetworkNotification, NetworkNotificationType, NotificationChrome } from './types'

const copyByType: Record<NetworkNotificationType, string> = {
  connection_request: 'sent you a connection request',
  connection_accepted: 'accepted your connection request',
  new_follower: 'started following you',
  post_comment: 'commented on your post',
  comment_reply: 'replied to your comment',
  post_reaction: 'reacted to your post',
  comment_reaction: 'reacted to your comment',
  post_mention: 'mentioned you in a post',
  comment_mention: 'mentioned you in a comment',
}

type NotificationRepository = Pick<ReturnType<typeof createNotificationRepository>, 'listRecent' | 'countUnread'>
type ProfileSummary = { id: string; slug: string; fullName: string }
type RequireUser = () => Promise<{ id: string }>
type GetProfiles = (ids: string[]) => Promise<ProfileSummary[]>

function socialCopy(row: NotificationRow) {
  if ((row.notification_type === 'post_reaction' || row.notification_type === 'comment_reaction') && row.reaction_type) {
    const meta = POST_REACTION_META[row.reaction_type]
    return row.notification_type === 'post_reaction'
      ? `reacted ${meta.label} ${meta.emoji} to your post`
      : `reacted ${meta.label} ${meta.emoji} to your comment`
  }
  return copyByType[row.notification_type]
}

function destinationFor(row: NotificationRow, actor: ProfileSummary | null) {
  if (row.notification_type === 'connection_request') return '/network?tab=requests'
  if (row.post_id) {
    const base = `/posts/${row.post_id}`
    return row.comment_id ? `${base}#comment-${row.comment_id}` : base
  }
  return actor ? `/people/${actor.slug}` : '/network'
}

function mapNotifications(rows: readonly NotificationRow[], profiles: readonly ProfileSummary[]) {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))

  return rows.map((row): NetworkNotification => {
    const profile = row.actor_id ? profilesById.get(row.actor_id) : undefined
    const actor = profile ? { id: profile.id, slug: profile.slug, fullName: profile.fullName } : null
    const actorName = actor?.fullName ?? 'A maritime professional'
    return {
      id: row.id,
      type: row.notification_type,
      createdAt: row.created_at,
      readAt: row.read_at,
      actor,
      message: `${actorName} ${socialCopy(row)}.`,
      destination: destinationFor(row, actor),
      postId: row.post_id,
      commentId: row.comment_id,
      reactionType: row.reaction_type,
    }
  })
}

export function createNotificationQueries(input: {
  requireUser: RequireUser
  repository: NotificationRepository
  getProfiles: GetProfiles
}) {
  async function loadNotifications(limit: number): Promise<NetworkNotification[]> {
    const user = await input.requireUser()
    const rows = await input.repository.listRecent(user.id, limit)
    const actorIds = [...new Set(rows.flatMap((row) => row.actor_id ? [row.actor_id] : []))]
    const profiles = actorIds.length ? await input.getProfiles(actorIds) : []
    return mapNotifications(rows, profiles)
  }

  async function getNotifications(limit = 50): Promise<NetworkNotification[]> {
    return loadNotifications(limit)
  }

  async function getNotificationChrome(): Promise<NotificationChrome> {
    const user = await input.requireUser()
    const [rows, unreadCount] = await Promise.all([
      input.repository.listRecent(user.id, 8),
      input.repository.countUnread(user.id),
    ])
    const actorIds = [...new Set(rows.flatMap((row) => row.actor_id ? [row.actor_id] : []))]
    const profiles = actorIds.length ? await input.getProfiles(actorIds) : []
    return { recent: mapNotifications(rows, profiles), unreadCount }
  }

  return { getNotifications, getNotificationChrome }
}

const productionQueries = createNotificationQueries({
  requireUser: requireAwsUser,
  repository: createNotificationRepository(),
  getProfiles: getAwsPublicProfilesByIds,
})

export const getNotifications = productionQueries.getNotifications
export const getNotificationChrome = productionQueries.getNotificationChrome
