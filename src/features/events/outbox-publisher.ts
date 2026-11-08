import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { withFeedPushAudience } from '@/features/realtime/feed-push-audience'
import type { EventBridgePublisher } from '@/lib/aws/eventbridge'
import type { DomainEvent, SocialDomainEventPayload, SocialDomainEventType } from './types'

type OutboxRow = QueryResultRow & {
  id: string
  aggregate_type: DomainEvent['aggregateType']
  aggregate_id: string
  event_type: SocialDomainEventType
  schema_version: 1
  payload: SocialDomainEventPayload
  occurred_at: string | Date
}

type OutboxTransaction = <T>(fn: (client: DatabaseQueryClient) => Promise<T>) => Promise<T>
type PublishOutcome = Awaited<ReturnType<EventBridgePublisher['publish']>>
type BatchResult = { claimed: number; published: number; failed: number }

// Round 14 (3.10): a row that has failed this many times stays unpublished, with its last_error,
// for inspection; it is never deleted and never retried automatically.
export const OUTBOX_MAX_ATTEMPTS = 10
// The lease covers one EventBridge PutEvents call; a worker that dies mid-batch releases its rows
// when the lease lapses.
export const OUTBOX_LEASE_SECONDS = 60
// Until migration 0068 is applied (Postgres 42703, undefined column), the worker uses the original
// in-transaction path and only re-probes for the lease column this often.
// Longest wait before a failed row is retried (see MARK_FAILED_LEASED_SQL).
export const OUTBOX_RETRY_MAX_SECONDS = 300
const LEASE_COLUMN_RECHECK_MS = 5 * 60 * 1000

const UNDEFINED_COLUMN = '42703'

// Claims in its own one-statement transaction: the row locks are held only while the lease is
// written and are released at commit, before the EventBridge call.
const CLAIM_WITH_LEASE_SQL = `with claimed as (
  update public.event_outbox outbox
  set claimed_until = now() + interval '${OUTBOX_LEASE_SECONDS} seconds'
  where outbox.id in (
    select candidate.id
    from public.event_outbox candidate
    where candidate.published_at is null
      and candidate.attempts < ${OUTBOX_MAX_ATTEMPTS}
      and (candidate.claimed_until is null or candidate.claimed_until < now())
    order by candidate.occurred_at asc, candidate.id asc
    for update skip locked
    limit $1
  )
  returning outbox.id, outbox.aggregate_type, outbox.aggregate_id, outbox.event_type,
    outbox.schema_version, outbox.payload, outbox.occurred_at
)
select id, aggregate_type, aggregate_id, event_type, schema_version, payload, occurred_at
from claimed
order by occurred_at asc, id asc`

const MARK_PUBLISHED_LEASED_SQL = `update public.event_outbox
set published_at = now(),
    last_error = null,
    claimed_until = null
where id = any($1::uuid[])`

// A failed row is not claimable again until its retry delay passes: 2 s, 4 s, 8 s ... capped at
// OUTBOX_RETRY_MAX_SECONDS (about 13 minutes across the ten attempts), so a short EventBridge
// outage cannot burn through the attempt cap in seconds. claimed_until doubles as that not-before.
const MARK_FAILED_LEASED_SQL = `update public.event_outbox outbox
set attempts = attempts + 1,
    last_error = left(failure.error, 1000),
    claimed_until = now() + make_interval(secs => least(${OUTBOX_RETRY_MAX_SECONDS}, power(2, outbox.attempts + 1)))
from unnest($1::uuid[], $2::text[]) as failure(id, error)
where outbox.id = failure.id`

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'eventbridge_publish_failed'
}

function isUndefinedColumn(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === UNDEFINED_COLUMN
}

// Keeps only ids from this batch, each counted once, so a misreporting publisher cannot touch other
// rows or mark one row both published and failed.
function normalizeOutcome(events: DomainEvent[], outcome: PublishOutcome) {
  const claimedIds = new Set(events.map((event) => event.id))
  const publishedIds = [...new Set(outcome.successfulIds)].filter((id) => claimedIds.has(id))
  const published = new Set(publishedIds)
  const failures = new Map<string, string>()
  for (const failure of outcome.failures) {
    if (claimedIds.has(failure.id) && !published.has(failure.id) && !failures.has(failure.id)) {
      failures.set(failure.id, failure.error)
    }
  }
  return { publishedIds, failures: [...failures].map(([id, error]) => ({ id, error })) }
}

export function createOutboxPublisher(input: {
  publisher: EventBridgePublisher
  withTransaction?: OutboxTransaction
  now?: () => number
  /** Round ARCH (broadcast fix): adds each feed event's push audience just before publishing; fails safe. */
  prepare?: (events: DomainEvent[]) => Promise<DomainEvent[]>
}) {
  const withTransaction = input.withTransaction ?? databaseTransaction
  const now = input.now ?? Date.now
  const prepare = input.prepare ?? ((events: DomainEvent[]) => withFeedPushAudience(events, databaseQuery))
  let leaseUnavailableUntil = 0

  // Before migration 0068: the original path, which holds the row locks and the transaction open
  // across the EventBridge call, now also capped at OUTBOX_MAX_ATTEMPTS.
  async function publishBatchInTransaction(batchSize: number): Promise<BatchResult> {
    return withTransaction(async (client) => {
      const result = await client.query<OutboxRow>(
        `select id, aggregate_type, aggregate_id, event_type, schema_version, payload, occurred_at
         from public.event_outbox
         where published_at is null
           and attempts < ${OUTBOX_MAX_ATTEMPTS}
         order by occurred_at asc, id asc
         for update skip locked
         limit $1`,
        [batchSize],
      )
      const events = result.rows.map(rowToEvent)
      if (events.length === 0) return { claimed: 0, published: 0, failed: 0 }

      let outcome: PublishOutcome
      try {
        outcome = await input.publisher.publish(await prepare(events))
      } catch (error) {
        await client.query(
          `update public.event_outbox
           set attempts = attempts + 1,
               last_error = left($2, 1000)
           where id = any($1::uuid[])`,
          [events.map((event) => event.id), errorMessage(error)],
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
  }

  async function markResults(
    publishedIds: string[],
    failures: Array<{ id: string; error: string }>,
  ) {
    if (publishedIds.length === 0 && failures.length === 0) return
    await withTransaction(async (client) => {
      if (publishedIds.length > 0) {
        await client.query(MARK_PUBLISHED_LEASED_SQL, [publishedIds])
      }
      if (failures.length > 0) {
        await client.query(MARK_FAILED_LEASED_SQL, [
          failures.map((failure) => failure.id),
          failures.map((failure) => failure.error),
        ])
      }
    })
  }

  async function publishBatchWithLease(batchSize: number): Promise<BatchResult | null> {
    let rows: OutboxRow[]
    try {
      rows = await withTransaction(async (client) => {
        const result = await client.query<OutboxRow>(CLAIM_WITH_LEASE_SQL, [batchSize])
        return result.rows
      })
    } catch (error) {
      if (!isUndefinedColumn(error)) throw error
      leaseUnavailableUntil = now() + LEASE_COLUMN_RECHECK_MS
      return null
    }

    const events = rows.map(rowToEvent)
    if (events.length === 0) return { claimed: 0, published: 0, failed: 0 }

    // No transaction and no pooled connection is held here.
    let outcome: PublishOutcome
    try {
      outcome = await input.publisher.publish(await prepare(events))
    } catch (error) {
      const message = errorMessage(error)
      await markResults([], events.map((event) => ({ id: event.id, error: message })))
      return { claimed: events.length, published: 0, failed: events.length }
    }

    const { publishedIds, failures } = normalizeOutcome(events, outcome)
    // A row the publisher reported neither way keeps its lease and is retried once it lapses.
    await markResults(publishedIds, failures)
    return { claimed: events.length, published: publishedIds.length, failed: failures.length }
  }

  return {
    async publishBatch(limit = 10): Promise<BatchResult> {
      const batchSize = clampBatchSize(limit)
      if (now() >= leaseUnavailableUntil) {
        const result = await publishBatchWithLease(batchSize)
        if (result) return result
      }
      return publishBatchInTransaction(batchSize)
    },
  }
}
