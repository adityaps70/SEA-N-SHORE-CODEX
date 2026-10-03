import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'

type RetentionQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type PurgedPostRow = QueryResultRow & { id: string }

export function createDeletedPostRetention(input: { query?: RetentionQuery } = {}) {
  const query = input.query ?? ((text, values) => databaseQuery(text, values))

  return {
    async purgeExpiredDeletedPosts(limit = 200) {
      const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500)
      const rows = await query(
        `with expired as (
           select
             p.id,
             p.deleted_at,
             p.purge_after,
             p.deletion_reason
           from public.posts p
           where p.deleted_at is not null
             and p.purge_after is not null
             and p.purge_after <= now()
           order by p.purge_after asc, p.id asc
           limit $1
           for update skip locked
         ),
         audited as (
           insert into public.audit_events (
             actor_id,
             action,
             target_type,
             target_id,
             metadata
           )
           select
             null,
             'content.post_purged',
             'post',
             expired.id::text,
             jsonb_build_object(
               'deletedAt', expired.deleted_at,
               'purgeAfter', expired.purge_after,
               'deletionReason', expired.deletion_reason
             )
           from expired
           returning target_id
         )
         delete from public.posts p
         using expired
         where p.id = expired.id
         returning p.id`,
        [boundedLimit],
      ) as PurgedPostRow[]

      return {
        purged: rows.length,
        postIds: rows.map((row) => row.id),
      }
    },
  }
}

export const deletedPostRetention = createDeletedPostRetention()
