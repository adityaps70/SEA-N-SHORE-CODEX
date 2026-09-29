import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'
import type { PostReactionType } from '@/features/feed/types'
import type { NetworkNotificationType } from './types'

export type NotificationRow = QueryResultRow & {
  id: string
  actor_id: string | null
  notification_type: NetworkNotificationType
  post_id: string | null
  comment_id: string | null
  reaction_type: PostReactionType | null
  created_at: string
  read_at: string | null
}

/** A compact look at the post a notification is about: its text and first photo or video. */
export type NotificationPostPreviewRow = QueryResultRow & {
  post_id: string
  snippet: string | null
  media_path: string | null
  media_mime_type: string | null
}

export type NotificationEventMode = 'shadow' | 'active'

type CountRow = QueryResultRow & { unread_count: string | number }
type IdRow = QueryResultRow & { id: string }
type ReceiptRow = QueryResultRow & { event_id: string }

type NotificationQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResultRow[]>

function clampLimit(limit: number) {
  return Math.min(Math.max(limit, 1), 50)
}

export function createNotificationRepository(input: { query?: NotificationQuery } = {}) {
  const queryRows: NotificationQuery = input.query ?? ((text, values) => databaseQuery(text, values))

  return {
    async listRecent(recipientId: string, limit: number): Promise<NotificationRow[]> {
      const rows = await queryRows(
        `select id, actor_id, notification_type::text as notification_type,
                post_id, comment_id, reaction_type::text as reaction_type,
                created_at, read_at
         from public.notifications
         where recipient_id = $1
         order by created_at desc
         limit $2`,
        [recipientId, clampLimit(limit)],
      )
      return rows as NotificationRow[]
    },

    /**
     * One batched lookup for the posts a page of notifications points at. Plain reposts fall back
     * to the original post's text and media. Deleted posts, and posts by members the recipient
     * blocked (or who blocked them), return nothing.
     */
    async listPostPreviews(recipientId: string, postIds: readonly string[]): Promise<NotificationPostPreviewRow[]> {
      const ids = [...new Set(postIds)]
      if (!ids.length) return []
      const rows = await queryRows(
        `select
           p.id as post_id,
           left(coalesce(nullif(btrim(p.body), ''), source.body, ''), 160) as snippet,
           first_media.storage_path as media_path,
           first_media.mime_type as media_mime_type
         from public.posts p
         left join public.posts source on source.id = p.repost_of_post_id and source.deleted_at is null
         left join lateral (
           select media.storage_path, media.mime_type
           from public.post_media media
           where media.post_id = coalesce(p.repost_of_post_id, p.id)
           order by media.position asc, media.created_at asc, media.id asc
           limit 1
         ) first_media on true
         where p.id = any($2::uuid[])
           and p.deleted_at is null
           and not exists (
             select 1 from public.user_blocks b
             where (b.blocker_id = $1 and b.blocked_id = p.author_id)
                or (b.blocker_id = p.author_id and b.blocked_id = $1)
           )`,
        [recipientId, ids],
      )
      return rows as NotificationPostPreviewRow[]
    },

    async countUnread(recipientId: string): Promise<number> {
      const rows = await queryRows(
        `select count(*)::text as unread_count
         from public.notifications
         where recipient_id = $1
           and read_at is null`,
        [recipientId],
      )
      const row = rows[0] as CountRow | undefined
      return Number(row?.unread_count ?? 0)
    },

    async markRead(recipientId: string, notificationId: string): Promise<boolean> {
      const rows = await queryRows(
        `update public.notifications
         set read_at = now()
         where id = $1
           and recipient_id = $2
         returning id`,
        [notificationId, recipientId],
      )
      return Boolean((rows[0] as IdRow | undefined)?.id)
    },

    /**
     * Deletes one notification, only when it belongs to `recipientId` (the signed-in member).
     * Returns false when there is no such notification for this recipient. Event receipts keep
     * their dedupe row, so the same event never recreates a deleted notification.
     */
    async deleteForRecipient(recipientId: string, notificationId: string): Promise<boolean> {
      const rows = await queryRows(
        `delete from public.notifications
         where id = $1
           and recipient_id = $2
         returning id`,
        [notificationId, recipientId],
      )
      return Boolean((rows[0] as IdRow | undefined)?.id)
    },

    async markAllRead(recipientId: string): Promise<void> {
      await queryRows(
        `update public.notifications
         set read_at = now()
         where recipient_id = $1
           and read_at is null`,
        [recipientId],
      )
    },
  }
}

export function createNotificationEventRepositoryForClient(client: DatabaseQueryClient) {
  return {
    async processNotificationEvent(input: {
      eventId: string
      mode: NotificationEventMode
      recipientId: string
      actorId: string
      type: NetworkNotificationType
      connectionId?: string
      postId?: string
      commentId?: string
      reactionType?: PostReactionType
    }) {
      const receipt = await client.query<ReceiptRow>(
        `insert into public.notification_event_receipts (event_id, processing_mode)
         values ($1, $2)
         on conflict do nothing
         returning event_id`,
        [input.eventId, input.mode],
      )

      if (!receipt.rows[0]?.event_id) {
        return { processed: false, created: false, notificationId: null }
      }

      if (input.mode === 'shadow') {
        return { processed: true, created: false, notificationId: null }
      }

      const notification = await client.query<IdRow>(
        `insert into public.notifications (
           recipient_id, actor_id, notification_type, connection_id,
           post_id, comment_id, reaction_type
         ) values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          input.recipientId,
          input.actorId,
          input.type,
          input.connectionId ?? null,
          input.postId ?? null,
          input.commentId ?? null,
          input.reactionType ?? null,
        ],
      )
      const notificationId = notification.rows[0]?.id
      if (!notificationId) throw new Error('notification_event_insert_failed')

      await client.query(
        `update public.notification_event_receipts
         set notification_id = $2,
             processed_at = now()
         where event_id = $1`,
        [input.eventId, notificationId],
      )

      return { processed: true, created: true, notificationId }
    },
  }
}

export type NotificationEventRepository = ReturnType<typeof createNotificationEventRepositoryForClient>

const repository = createNotificationRepository()

export const listRecentNotificationsFromAurora = repository.listRecent
export const countUnreadNotificationsFromAurora = repository.countUnread
export const markNotificationReadInAurora = repository.markRead
export const markAllNotificationsReadInAurora = repository.markAllRead
export const deleteNotificationInAurora = repository.deleteForRecipient
