import type { DatabaseQueryClient } from '@/lib/db/client'
import type { DomainEvent } from '@/features/events/types'
import type { NetworkNotificationType } from '@/features/notifications/types'
import type { PostReactionType } from './types'

export function createFeedSocialWriterForClient(client: DatabaseQueryClient) {
  return {
    async upsertNotification(input: {
      recipientId: string
      actorId: string
      type: NetworkNotificationType
      dedupeKey: string
      postId?: string
      commentId?: string
      reactionType?: PostReactionType
      /** Community group the notification is about (round 9B). */
      groupId?: string
      /** Organization the notification is about (round 9B). */
      companyId?: string
    }) {
      await client.query(
        `insert into public.notifications (
           recipient_id, actor_id, notification_type, post_id, comment_id, reaction_type, dedupe_key, group_id, company_id
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (recipient_id, dedupe_key) where dedupe_key is not null
         do update set
           actor_id = excluded.actor_id,
           notification_type = excluded.notification_type,
           post_id = excluded.post_id,
           comment_id = excluded.comment_id,
           reaction_type = excluded.reaction_type,
           group_id = excluded.group_id,
           company_id = excluded.company_id,
           created_at = now(),
           read_at = null`,
        [
          input.recipientId,
          input.actorId,
          input.type,
          input.postId ?? null,
          input.commentId ?? null,
          input.reactionType ?? null,
          input.dedupeKey,
          input.groupId ?? null,
          input.companyId ?? null,
        ],
      )
    },

    async deleteNotification(recipientId: string, dedupeKey: string) {
      await client.query(
        `delete from public.notifications where recipient_id = $1 and dedupe_key = $2`,
        [recipientId, dedupeKey],
      )
    },

    async enqueue(event: DomainEvent) {
      await client.query(
        `insert into public.event_outbox (
           id, aggregate_type, aggregate_id, event_type, schema_version, payload, occurred_at
         ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          event.id,
          event.aggregateType,
          event.aggregateId,
          event.eventType,
          event.schemaVersion,
          JSON.stringify(event.payload),
          event.occurredAt,
        ],
      )
    },
  }
}

export type FeedSocialWriter = ReturnType<typeof createFeedSocialWriterForClient>
