import { requireAwsUser } from '@/features/auth/aws-queries'
import { resolveFeedMediaUrls } from '@/features/feed/media'
import { POST_REACTION_META } from '@/features/feed/types'
import { getAwsPublicProfilesByIds } from '@/features/profiles/aws-queries'
import { createNotificationRepository, type NotificationPostPreviewRow, type NotificationRow } from './repository'
import type { NetworkNotification, NetworkNotificationType, NotificationChrome, NotificationPostPreview } from './types'

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
  event_cancelled: 'cancelled an event you registered for',
}

const EVENT_CANCELLED_MESSAGE = 'An event you registered for was cancelled because its organiser left Sea N Shore. Paid tickets are refunded in full.'

type NotificationRepository = Pick<ReturnType<typeof createNotificationRepository>, 'listRecent' | 'countUnread'>
  & Partial<Pick<ReturnType<typeof createNotificationRepository>, 'listPostPreviews'>>
type ProfileSummary = { id: string; slug: string; fullName: string; avatarUrl?: string | null }
type RequireUser = () => Promise<{ id: string }>
type GetProfiles = (ids: string[]) => Promise<ProfileSummary[]>
type ResolveMediaUrls = (paths: string[]) => Promise<Map<string, string>>

function previewMediaType(mimeType: string | null): 'image' | 'video' | null {
  if (mimeType?.startsWith('image/')) return 'image'
  if (mimeType?.startsWith('video/')) return 'video'
  return null
}

/** The first few words of a post, on one line, for the preview tile. */
export function previewText(body: string | null | undefined, maxChars = 60) {
  const text = (body ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const boundary = cut.lastIndexOf(' ')
  return `${(boundary > maxChars * 0.5 ? cut.slice(0, boundary) : cut).trimEnd()}…`
}

function mapPostPreviews(rows: readonly NotificationPostPreviewRow[], signedUrls: Map<string, string>) {
  return new Map(rows.map((row): [string, NotificationPostPreview] => {
    const mediaType = previewMediaType(row.media_mime_type)
    const mediaUrl = mediaType && row.media_path ? signedUrls.get(row.media_path) ?? null : null
    return [row.post_id, {
      postId: row.post_id,
      mediaUrl,
      mediaType: mediaUrl ? mediaType : null,
      text: previewText(row.snippet),
    }]
  }))
}

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
  if (row.notification_type === 'event_cancelled') return '/events/my'
  if (row.post_id) {
    const base = `/posts/${row.post_id}`
    return row.comment_id ? `${base}#comment-${row.comment_id}` : base
  }
  return actor ? `/people/${actor.slug}` : '/network'
}

function mapNotifications(
  rows: readonly NotificationRow[],
  profiles: readonly ProfileSummary[],
  previews: Map<string, NotificationPostPreview> = new Map(),
) {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))

  return rows.map((row): NetworkNotification => {
    const profile = row.actor_id ? profilesById.get(row.actor_id) : undefined
    const actor = profile
      ? { id: profile.id, slug: profile.slug, fullName: profile.fullName, avatarUrl: profile.avatarUrl ?? null }
      : null
    const actorName = actor?.fullName ?? 'A maritime professional'
    return {
      id: row.id,
      type: row.notification_type,
      createdAt: row.created_at,
      readAt: row.read_at,
      actor,
      message: row.notification_type === 'event_cancelled' ? EVENT_CANCELLED_MESSAGE : `${actorName} ${socialCopy(row)}.`,
      destination: destinationFor(row, actor),
      postId: row.post_id,
      commentId: row.comment_id,
      reactionType: row.reaction_type,
      postPreview: row.post_id ? previews.get(row.post_id) ?? null : null,
    }
  })
}

export function createNotificationQueries(input: {
  requireUser: RequireUser
  repository: NotificationRepository
  getProfiles: GetProfiles
  resolveMediaUrls?: ResolveMediaUrls
}) {
  const resolveMediaUrls = input.resolveMediaUrls ?? resolveFeedMediaUrls

  /** Actors (with signed photos) and post previews for one page of rows, in two batched lookups. */
  async function hydrate(recipientId: string, rows: readonly NotificationRow[]) {
    const actorIds = [...new Set(rows.flatMap((row) => row.actor_id ? [row.actor_id] : []))]
    const postIds = [...new Set(rows.flatMap((row) => row.post_id ? [row.post_id] : []))]
    const [profiles, previewRows] = await Promise.all([
      actorIds.length ? input.getProfiles(actorIds) : Promise.resolve([]),
      postIds.length && input.repository.listPostPreviews
        ? input.repository.listPostPreviews(recipientId, postIds).catch(() => [])
        : Promise.resolve([]),
    ])
    const mediaPaths = previewRows.flatMap((row) => row.media_path && previewMediaType(row.media_mime_type) ? [row.media_path] : [])
    const signedUrls = mediaPaths.length
      ? await resolveMediaUrls(mediaPaths).catch(() => new Map<string, string>())
      : new Map<string, string>()
    return mapNotifications(rows, profiles, mapPostPreviews(previewRows, signedUrls))
  }

  async function getNotifications(limit = 50): Promise<NetworkNotification[]> {
    const user = await input.requireUser()
    const rows = await input.repository.listRecent(user.id, limit)
    return hydrate(user.id, rows)
  }

  async function getNotificationChrome(): Promise<NotificationChrome> {
    const user = await input.requireUser()
    const [rows, unreadCount] = await Promise.all([
      input.repository.listRecent(user.id, 8),
      input.repository.countUnread(user.id),
    ])
    return { recent: await hydrate(user.id, rows), unreadCount }
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
