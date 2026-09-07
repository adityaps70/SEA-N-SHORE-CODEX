import type { DatabaseQueryClient } from '@/lib/db/client'
import type { DomainEvent } from './types'

export function createOutboxRepositoryForClient(client: DatabaseQueryClient) {
  return {
    async enqueue(event: DomainEvent) {
      await client.query(
        `insert into public.event_outbox (
           id,
           aggregate_type,
           aggregate_id,
           event_type,
           schema_version,
           payload,
           occurred_at
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

export type OutboxRepository = ReturnType<typeof createOutboxRepositoryForClient>
