import type { QueryResultRow } from 'pg'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import type { EventBridgePublisher } from '@/lib/aws/eventbridge'
import type { DomainEvent, SocialDomainEventPayload, SocialDomainEventType } from './types'

type OutboxRow = QueryResultRow & {
  id: string
  aggregate_type: 'profile' | 'connection'
  aggregate_id: string
  event_type: SocialDomainEventType
  schema_version: 1
  payload: SocialDomainEventPayload
  occurred_at: string | Date
}

type OutboxTransaction = <T>(fn: (client: DatabaseQueryClient) => Promise<T>) => Promise<T>

function clampBatchSize(limit: number) {
  return Math.min(Math.max(Math.floor(limit), 1), 10)
}

function rowToEvent(row: OutboxRow): DomainEvent {
  return {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
    payload: row.payload,
  }
}

export function createOutboxPublisher(input: {
  publisher: EventBridgePublisher
  withTransaction?: OutboxTransaction
}) {
  const withTransaction = input.withTransaction ?? databaseTransaction

  return {
    async publishBatch(limit = 10) {
      return withTransaction(async (client) => {
        const result = await client.query<OutboxRow>(
          `select id, aggregate_type, aggregate_id, event_type, schema_version, payload, occurred_at
           from public.event_outbox
           where published_at is null
           order by occurred_at asc, id asc
           for update skip locked
           limit $1`,
          [clampBatchSize(limit)],
        )
        const events = result.rows.map(rowToEvent)
        if (events.length === 0) return { claimed: 0, published: 0, failed: 0 }

        let outcome: Awaited<ReturnType<EventBridgePublisher['publish']>>
        try {
          outcome = await input.publisher.publish(events)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'eventbridge_publish_failed'
          await client.query(
            `update public.event_outbox
             set attempts = attempts + 1,
                 last_error = left($2, 1000)
             where id = any($1::uuid[])`,
            [events.map((event) => event.id), message],
          )
          return { claimed: events.length, published: 0, failed: events.length }
        }

        if (outcome.successfulIds.length > 0) {
          await client.query(
            `update public.event_outbox
             set published_at = now(),
                 last_error = null
             where id = any($1::uuid[])`,
            [outcome.successfulIds],
          )
        }

        for (const failure of outcome.failures) {
          await client.query(
            `update public.event_outbox
             set attempts = attempts + 1,
                 last_error = left($2, 1000)
             where id = $1`,
            [failure.id, failure.error],
          )
        }

        return {
          claimed: events.length,
          published: outcome.successfulIds.length,
          failed: outcome.failures.length,
        }
      })
    },
  }
}
