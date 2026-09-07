import { describe, expect, it, vi } from 'vitest'
import { createOutboxPublisher } from './outbox-publisher'
import type { DatabaseQueryClient } from '@/lib/db/client'
import type { EventBridgePublisher } from '@/lib/aws/eventbridge'

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function row() {
  return {
    id: EVENT_ID,
    aggregate_type: 'profile',
    aggregate_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    event_type: 'user.followed',
    schema_version: 1,
    payload: {
      eventType: 'user.followed',
      actorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      targetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
    occurred_at: '2026-09-07T12:00:00.000Z',
  }
}

function transactionWith(rows = [row()]) {
  const query = vi.fn(async (sql: string, _values?: readonly unknown[]) => {
    if (sql.includes('select id, aggregate_type')) return { rows }
    return { rows: [] }
  })
  const withTransaction = async <T>(fn: (client: DatabaseQueryClient) => Promise<T>) =>
    fn({ query } as unknown as DatabaseQueryClient)
  return { query, withTransaction }
}

describe('outbox publisher', () => {
  it('claims with skip locked and marks accepted events published', async () => {
    const transaction = transactionWith()
    const eventPublisher = {
      publish: vi.fn(async () => ({ successfulIds: [EVENT_ID], failures: [] })),
    }
    const publisher = createOutboxPublisher({
      publisher: eventPublisher as EventBridgePublisher,
      withTransaction: transaction.withTransaction,
    })

    await expect(publisher.publishBatch(50)).resolves.toEqual({ claimed: 1, published: 1, failed: 0 })

    const claimSql = transaction.query.mock.calls[0]![0]
    expect(claimSql).toContain('for update skip locked')
    expect(transaction.query.mock.calls[0]![1]).toEqual([10])
    expect(eventPublisher.publish).toHaveBeenCalledTimes(1)
    expect(transaction.query.mock.calls.some(([sql]) => sql.includes('set published_at = now()'))).toBe(true)
  })

  it('leaves rejected events unpublished and increments attempts', async () => {
    const transaction = transactionWith()
    const eventPublisher = {
      publish: vi.fn(async () => ({ successfulIds: [], failures: [{ id: EVENT_ID, error: 'retry' }] })),
    }
    const publisher = createOutboxPublisher({
      publisher: eventPublisher as EventBridgePublisher,
      withTransaction: transaction.withTransaction,
    })

    await expect(publisher.publishBatch()).resolves.toEqual({ claimed: 1, published: 0, failed: 1 })
    expect(transaction.query.mock.calls.some(([sql]) => sql.includes('attempts = attempts + 1'))).toBe(true)
    expect(transaction.query.mock.calls.some(([sql]) => sql.includes('set published_at = now()'))).toBe(false)
  })

  it('does not call EventBridge when no rows are claimable', async () => {
    const transaction = transactionWith([])
    const eventPublisher = { publish: vi.fn() }
    const publisher = createOutboxPublisher({
      publisher: eventPublisher as unknown as EventBridgePublisher,
      withTransaction: transaction.withTransaction,
    })

    await expect(publisher.publishBatch()).resolves.toEqual({ claimed: 0, published: 0, failed: 0 })
    expect(eventPublisher.publish).not.toHaveBeenCalled()
  })
})
