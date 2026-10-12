import { requireAwsUser } from '@/features/auth/aws-queries'
import { resolveFeedMediaUrls } from '@/features/feed/media'
import { POST_REACTION_META } from '@/features/feed/types'
import { getAwsPublicProfilesByIds } from '@/features/profiles/aws-queries'
import { createNotificationRepository, type NotificationPostPreviewRow, type NotificationRow } from './repository'
import type { NetworkNotification, NetworkNotificationType, NotificationChrome, NotificationPostPreview } from './types'
import { learningKindOf, learningNotificationCopy } from '@/features/learning/learning-notification-copy'
import type { LearningNotificationDetails } from '@/features/learning/learning-notifications'

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
  plan_trial_ending: 'your free trial ends soon',
  group_join_request: 'asked to join a group you manage',
  group_join_approved: 'approved your request to join a group',
  group_post: 'posted in a group you manage',
  organization_mention: 'mentioned an organization you manage',
  photo_tag: 'tagged you in a photo',
  organization_member_left: 'left an organization you manage',
  // Learning notifications have no actor; their words come from learningNotificationCopy.
  learning_enrolled: 'enrolled you in a course',
  learning_lessons_released: 'released new course materials',
  learning_assignment_graded: 'graded your assignment',
  learning_certificate_issued: 'issued your certificate',
  learning_course_approved: 'approved your course',
  learning_course_changes_requested: 'asked for changes to your course',
  learning_submissions_to_grade: 'submitted assignments to grade',
  learning_quiz_graded: 'graded your quiz answers',
  learning_certificate_expiring: 'your certificate expires soon',
  learning_announcement: 'posted a course announcement',
  learning_session_reminder: 'your live session starts soon',
}

function learningCopy(row: NotificationRow) {
  const kind = learningKindOf(row.notification_type)
  const details = row.details as LearningNotificationDetails | null | undefined
  return kind && details?.courseTitle ? learningNotificationCopy(kind, details) : null
}

const EVENT_CANCELLED_MESSAGE = 'An event you registered for was cancelled because its organiser left Sea N Shore. Paid tickets are refunded in full.'
export const PLAN_TRIAL_ENDING_MESSAGE = 'Your free Pro trial ends soon. Choose a plan to keep it — the first payment is only taken on the day the trial ends.'

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

type PostPreviews = {
  /** Previews by post id; tag rows prefer the photo the recipient is tagged in. */
  byPost: Map<string, NotificationPostPreview>
  tagged: Map<string, NotificationPostPreview & { mediaId: string | null }>
  /** False when the preview lookup failed: then nothing is marked unavailable. */
  loaded: boolean
}

function mapPostPreviews(rows: readonly NotificationPostPreviewRow[], signedUrls: Map<string, string>, loaded = true): PostPreviews {
  const byPost = new Map<string, NotificationPostPreview>()
  const tagged = new Map<string, NotificationPostPreview & { mediaId: string | null }>()
  for (const row of rows) {
    const mediaType = previewMediaType(row.media_mime_type)
    const mediaUrl = mediaType && row.media_path ? signedUrls.get(row.media_path) ?? null : null
    const preview: NotificationPostPreview = {
      postId: row.post_id,
      mediaUrl,
      mediaType: mediaUrl ? mediaType : null,
      text: previewText(row.snippet),
    }
    byPost.set(row.post_id, preview)
    const tagType = previewMediaType(row.tag_media_mime_type ?? null)
    const tagUrl = tagType && row.tag_media_path ? signedUrls.get(row.tag_media_path) ?? null : null
    tagged.set(row.post_id, tagUrl
      ? { ...preview, mediaUrl: tagUrl, mediaType: tagType, mediaId: row.tag_media_id ?? null }
      : { ...preview, mediaId: row.tag_media_id ?? null })
  }
  return { byPost, tagged, loaded }
}

const EMPTY_PREVIEWS: PostPreviews = { byPost: new Map(), tagged: new Map(), loaded: false }

function previewFor(row: NotificationRow, previews: PostPreviews): NotificationPostPreview | null {
  if (!row.post_id) return null
  if (row.notification_type === 'photo_tag') {
    const tagged = previews.tagged.get(row.post_id)
    if (tagged) return { postId: tagged.postId, mediaUrl: tagged.mediaUrl, mediaType: tagged.mediaType, text: tagged.text }
  }
  return previews.byPost.get(row.post_id) ?? null
}

function socialCopy(row: NotificationRow) {
  if ((row.notification_type === 'post_reaction' || row.notification_type === 'comment_reaction') && row.reaction_type) {
    const meta = POST_REACTION_META[row.reaction_type]
    return row.notification_type === 'post_reaction'
      ? `reacted ${meta.label} ${meta.emoji} to your post`
      : `reacted ${meta.label} ${meta.emoji} to your comment`
  }
  if (row.notification_type === 'group_join_request' && row.group_name) return `asked to join ${row.group_name}`
  if (row.notification_type === 'group_join_approved' && row.group_name) return `approved your request to join ${row.group_name}`
  if (row.notification_type === 'group_post' && row.group_name) return `posted in ${row.group_name}`
  if (row.notification_type === 'organization_member_left' && row.company_name) return `left ${row.company_name}`
  if (row.notification_type === 'organization_mention' && row.company_name) {
    return row.comment_id ? `mentioned ${row.company_name} in a comment` : `mentioned ${row.company_name} in a post`
  }
  return copyByType[row.notification_type]
}

function destinationFor(row: NotificationRow, actor: ProfileSummary | null, taggedMediaId: string | null = null) {
  const learning = learningCopy(row)
  if (learning) return learning.path
  if (learningKindOf(row.notification_type)) return '/learn/my-learning'
  if (row.notification_type === 'connection_request') return '/network?tab=requests'
  if (row.notification_type === 'event_cancelled') return '/events/my'
  if (row.notification_type === 'plan_trial_ending') return '/settings/billing'
  if (row.notification_type === 'group_join_request') return row.group_slug ? `/community/${row.group_slug}?tab=members&requests=1` : '/community'
  if (row.notification_type === 'group_join_approved') return row.group_slug ? `/community/${row.group_slug}` : '/community'
  if (row.notification_type === 'organization_member_left') return row.company_slug ? `/organizations/${row.company_slug}/manage` : '/organizations'
  if (row.post_id) {
    const base = `/posts/${row.post_id}`
    // Round F: a photo tag opens the post at the tagged photo.
    if (row.notification_type === 'photo_tag' && taggedMediaId) return `${base}?photo=${taggedMediaId}`
    return row.comment_id ? `${base}#comment-${row.comment_id}` : base
  }
  return actor ? `/people/${actor.slug}` : '/network'
}

function mapNotifications(
  rows: readonly NotificationRow[],
  profiles: readonly ProfileSummary[],
  previews: PostPreviews = EMPTY_PREVIEWS,
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
      message: row.notification_type === 'event_cancelled'
        ? EVENT_CANCELLED_MESSAGE
        : row.notification_type === 'plan_trial_ending'
          ? PLAN_TRIAL_ENDING_MESSAGE
          : learningKindOf(row.notification_type)
            ? learningCopy(row)?.message ?? 'There is news about one of your courses.'
            : `${actorName} ${socialCopy(row)}.`,
      destination: destinationFor(row, actor, row.post_id ? previews.tagged.get(row.post_id)?.mediaId ?? null : null),
      postId: row.post_id,
      commentId: row.comment_id,
      reactionType: row.reaction_type,
      postPreview: row.post_id ? previewFor(row, previews) : null,
      // Round F: the post was deleted or is out of the recipient's reach; the row says so and opens nothing.
      postUnavailable: Boolean(row.post_id && previews.loaded && !previews.byPost.has(row.post_id)),
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
    const [profiles, previewResult] = await Promise.all([
      actorIds.length ? input.getProfiles(actorIds) : Promise.resolve([]),
      postIds.length && input.repository.listPostPreviews
        ? input.repository.listPostPreviews(recipientId, postIds).then((found) => ({ rows: found, loaded: true }), () => ({ rows: [], loaded: false }))
        : Promise.resolve({ rows: [], loaded: Boolean(input.repository.listPostPreviews) }),
    ])
    const previewRows: NotificationPostPreviewRow[] = previewResult.rows
    const mediaPaths = previewRows.flatMap((row) => [
      ...(row.media_path && previewMediaType(row.media_mime_type) ? [row.media_path] : []),
      ...(row.tag_media_path && previewMediaType(row.tag_media_mime_type ?? null) ? [row.tag_media_path] : []),
    ])
    const signedUrls = mediaPaths.length
      ? await resolveMediaUrls([...new Set(mediaPaths)]).catch(() => new Map<string, string>())
      : new Map<string, string>()
    return mapNotifications(rows, profiles, mapPostPreviews(previewRows, signedUrls, previewResult.loaded))
  }

  async function getNotifications(limit = 50): Promise<NetworkNotification[]> {
    const user = await input.requireUser()
    const rows = await input.repository.listRecent(user.id, limit)
    return hydrate(user.id, rows)
  }

  /** Round 14 (3.9): the header badge only needs this one count (notifications_recipient_read_created_idx). */
  async function getUnreadNotificationCount(): Promise<number> {
    const user = await input.requireUser()
    return input.repository.countUnread(user.id)
  }

  /** The bell panel's recent list and count, loaded when the panel opens. */
  async function getNotificationChrome(): Promise<NotificationChrome> {
    const user = await input.requireUser()
    const [rows, unreadCount] = await Promise.all([
      input.repository.listRecent(user.id, 8),
      input.repository.countUnread(user.id),
    ])
    return { recent: await hydrate(user.id, rows), unreadCount }
  }

  return { getNotifications, getNotificationChrome, getUnreadNotificationCount }
}

const productionQueries = createNotificationQueries({
  requireUser: requireAwsUser,
  repository: createNotificationRepository(),
  getProfiles: getAwsPublicProfilesByIds,
})

export const getNotifications = productionQueries.getNotifications
export const getNotificationChrome = productionQueries.getNotificationChrome
export const getUnreadNotificationCount = productionQueries.getUnreadNotificationCount
