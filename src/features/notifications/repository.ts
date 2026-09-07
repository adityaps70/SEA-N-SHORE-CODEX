import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'
import type { NetworkNotificationType } from './types'

export type NotificationRow = QueryResultRow & {
  id: string
  actor_id: string | null
  notification_type: NetworkNotificationType
  created_at: string
  read_at: string | null
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
        `select id, actor_id, notification_type::text as notification_type, created_at, read_at
         from public.notifications
         where recipient_id = $1
         order by created_at desc
         limit $2`,
        [recipientId, clampLimit(limit)],
      )
      return rows as NotificationRow[]
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
           recipient_id, actor_id, notification_type, connection_id
         ) values ($1, $2, $3, $4)
         returning id`,
        [input.recipientId, input.actorId, input.type, input.connectionId ?? null],
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
