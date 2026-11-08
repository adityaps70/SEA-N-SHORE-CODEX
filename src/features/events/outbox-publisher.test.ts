import { describe, expect, it, vi } from 'vitest'
import { createOutboxPublisher, OUTBOX_MAX_ATTEMPTS } from './outbox-publisher'
import type { DatabaseQueryClient } from '@/lib/db/client'
import type { EventBridgePublisher } from '@/lib/aws/eventbridge'

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SECOND_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function row(id = EVENT_ID) {
  return {
    id,
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
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    void values
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

  it('publishes each event as prepared (Round ARCH broadcast fix: feed events gain their push audience)', async () => {
    const transaction = transactionWith()
    const eventPublisher = { publish: vi.fn(async () => ({ successfulIds: [EVENT_ID], failures: [] })) }
    const prepare = vi.fn(async (events: Array<{ payload: object }>) => events.map((event) => ({ ...event, payload: { ...event.payload, audienceProfileIds: ['p1'] } })))
    const publisher = createOutboxPublisher({
      publisher: eventPublisher as EventBridgePublisher,
      withTransaction: transaction.withTransaction,
      prepare: prepare as never,
    })

    await expect(publisher.publishBatch()).resolves.toEqual({ claimed: 1, published: 1, failed: 0 })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(eventPublisher.publish).toHaveBeenCalledWith([expect.objectContaining({ id: EVENT_ID, payload: expect.objectContaining({ audienceProfileIds: ['p1'] }) })])
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

  it('claims with a 60 s lease in its own transaction, capped at the attempt limit, oldest first', async () => {
    const transaction = transactionWith()
    const eventPublisher = { publish: vi.fn(async () => ({ successfulIds: [EVENT_ID], failures: [] })) }
    const publisher = createOutboxPublisher({
      publisher: eventPublisher as EventBridgePublisher,
      withTransaction: transaction.withTransaction,
    })

    await publisher.publishBatch(3)

    const [claimSql, claimValues] = transaction.query.mock.calls[0]!
    expect(claimValues).toEqual([3])
    expect(claimSql).toMatch(/update public\.event_outbox outbox\s+set claimed_until = now\(\) \+ interval '60 seconds'/)
    expect(claimSql).toContain('candidate.published_at is null')
    expect(claimSql).toContain(`candidate.attempts < ${OUTBOX_MAX_ATTEMPTS}`)
    expect(OUTBOX_MAX_ATTEMPTS).toBe(10)
    expect(claimSql).toContain('(candidate.claimed_until is null or candidate.claimed_until < now())')
    expect(claimSql).toMatch(/order by candidate\.occurred_at asc, candidate\.id asc\s+for update skip locked\s+limit \$1/)
    expect(claimSql).toMatch(/from claimed\s+order by occurred_at asc, id asc$/)
    expect(claimSql).not.toMatch(/\bdelete\b/i)
  })

  it('calls EventBridge only after the claim transaction committed, with no connection held, then marks results', async () => {
    const log: string[] = []
    let open = false
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      void values
      log.push(sql.includes('set claimed_until = now()') && sql.includes('with claimed') ? 'claim' : 'mark')
      if (sql.includes('with claimed')) return { rows: [row(), row(SECOND_ID)] }
      return { rows: [] }
    })
    const withTransaction = async <T>(fn: (client: DatabaseQueryClient) => Promise<T>) => {
      log.push('begin')
      open = true
      try {
        const result = await fn({ query } as unknown as DatabaseQueryClient)
        log.push('commit')
        return result
      } finally {
        open = false
      }
    }
    const eventPublisher = {
      publish: vi.fn(async () => {
        expect(open).toBe(false)
        log.push('publish')
        return { successfulIds: [EVENT_ID], failures: [{ id: SECOND_ID, error: 'ThrottlingException:slow down' }] }
      }),
    }
    const publisher = createOutboxPublisher({ publisher: eventPublisher as EventBridgePublisher, withTransaction })

    await expect(publisher.publishBatch()).resolves.toEqual({ claimed: 2, published: 1, failed: 1 })

    expect(log).toEqual(['begin', 'claim', 'commit', 'publish', 'begin', 'mark', 'mark', 'commit'])
    expect(eventPublisher.publish).toHaveBeenCalledWith([
      expect.objectContaining({ id: EVENT_ID, eventType: 'user.followed', occurredAt: '2026-09-07T12:00:00.000Z' }),
      expect.objectContaining({ id: SECOND_ID }),
    ])
    const [publishedSql, publishedValues] = query.mock.calls[1]!
    expect(publishedSql).toMatch(/set published_at = now\(\),\s+last_error = null,\s+claimed_until = null\s+where id = any\(\$1::uuid\[\]\)/)
    expect(publishedValues).toEqual([[EVENT_ID]])
    const [failedSql, failedValues] = query.mock.calls[2]!
    expect(failedSql).toContain('set attempts = attempts + 1')
    expect(failedSql).toContain('last_error = left(failure.error, 1000)')
    expect(failedSql).toMatch(/claimed_until = now\(\) \+ make_interval\(secs => least\(300, power\(2, outbox\.attempts \+ 1\)\)\)/)
    expect(failedSql).toContain('from unnest($1::uuid[], $2::text[]) as failure(id, error)')
    expect(failedValues).toEqual([[SECOND_ID], ['ThrottlingException:slow down']])
    expect(query.mock.calls.some(([sql]) => /\bdelete\b/i.test(sql))).toBe(false)
  })

  it('marks every claimed row failed when the EventBridge call throws', async () => {
    const transaction = transactionWith([row(), row(SECOND_ID)])
    const eventPublisher = { publish: vi.fn(async () => { throw new Error('connect ETIMEDOUT') }) }
    const publisher = createOutboxPublisher({
      publisher: eventPublisher as unknown as EventBridgePublisher,
      withTransaction: transaction.withTransaction,
    })

    await expect(publisher.publishBatch()).resolves.toEqual({ claimed: 2, published: 0, failed: 2 })

    expect(transaction.query).toHaveBeenCalledTimes(2)
    const [failedSql, failedValues] = transaction.query.mock.calls[1]!
    expect(failedSql).toContain('set attempts = attempts + 1')
    expect(failedSql).toContain('from unnest($1::uuid[], $2::text[])')
    expect(failedValues).toEqual([[EVENT_ID, SECOND_ID], ['connect ETIMEDOUT', 'connect ETIMEDOUT']])
    expect(transaction.query.mock.calls.some(([sql]) => sql.includes('set published_at = now()'))).toBe(false)
  })

  it('ignores ids the publisher reports outside the batch and leaves unreported rows on their lease', async () => {
    const transaction = transactionWith([row(), row(SECOND_ID)])
    const stranger = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const eventPublisher = {
      publish: vi.fn(async () => ({
        successfulIds: [EVENT_ID, EVENT_ID, stranger],
        failures: [{ id: EVENT_ID, error: 'contradiction' }, { id: stranger, error: 'x' }],
      })),
    }
    const publisher = createOutboxPublisher({
      publisher: eventPublisher as EventBridgePublisher,
      withTransaction: transaction.withTransaction,
    })

    await expect(publisher.publishBatch()).resolves.toEqual({ claimed: 2, published: 1, failed: 0 })
    expect(transaction.query).toHaveBeenCalledTimes(2)
    expect(transaction.query.mock.calls[1]![1]).toEqual([[EVENT_ID]])
  })

  it('falls back to the in-transaction path, still capped, while the lease column is missing (42703)', async () => {
    let clock = 1_000_000
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      void values
      if (sql.includes('claimed_until')) throw Object.assign(new Error('column "claimed_until" does not exist'), { code: '42703' })
      if (sql.includes('select id, aggregate_type')) return { rows: [row()] }
      return { rows: [] }
    })
    let open = false
    const withTransaction = async <T>(fn: (client: DatabaseQueryClient) => Promise<T>) => {
      open = true
      try {
        return await fn({ query } as unknown as DatabaseQueryClient)
      } finally {
        open = false
      }
    }
    const eventPublisher = {
      publish: vi.fn(async () => {
        // The pre-migration path keeps its original shape: EventBridge inside the transaction.
        expect(open).toBe(true)
        return { successfulIds: [EVENT_ID], failures: [] }
      }),
    }
    const publisher = createOutboxPublisher({
      publisher: eventPublisher as EventBridgePublisher,
      withTransaction,
      now: () => clock,
    })

    await expect(publisher.publishBatch()).resolves.toEqual({ claimed: 1, published: 1, failed: 0 })
    const sqls = query.mock.calls.map(([sql]) => sql)
    expect(sqls[0]).toContain('with claimed')
    expect(sqls[1]).toMatch(/where published_at is null\s+and attempts < 10\s+order by occurred_at asc, id asc\s+for update skip locked\s+limit \$1/)
    expect(sqls[2]).toMatch(/set published_at = now\(\),\s+last_error = null\s+where id = any/)
    expect(sqls.slice(1).some((sql) => sql.includes('claimed_until'))).toBe(false)

    // The missing column is not re-probed on every batch...
    query.mockClear()
    await publisher.publishBatch()
    expect(query.mock.calls.some(([sql]) => sql.includes('with claimed'))).toBe(false)

    // ...but it is after five minutes, so the lease path takes over once 0068 is applied.
    clock += 5 * 60 * 1000
    query.mockClear()
    await publisher.publishBatch()
    expect(query.mock.calls[0]![0]).toContain('with claimed')
  })

  it('propagates claim errors other than a missing column', async () => {
    const query = vi.fn(async () => {
      throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
    })
    const withTransaction = async <T>(fn: (client: DatabaseQueryClient) => Promise<T>) =>
      fn({ query } as unknown as DatabaseQueryClient)
    const eventPublisher = { publish: vi.fn() }
    const publisher = createOutboxPublisher({
      publisher: eventPublisher as unknown as EventBridgePublisher,
      withTransaction,
    })

    await expect(publisher.publishBatch()).rejects.toThrow('lock timeout')
    expect(query).toHaveBeenCalledTimes(1)
    expect(eventPublisher.publish).not.toHaveBeenCalled()
  })

  it('propagates a failure to record results so the lease lapses and the batch is retried', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('with claimed')) return { rows: [row()] }
      throw new Error('connection terminated')
    })
    const withTransaction = async <T>(fn: (client: DatabaseQueryClient) => Promise<T>) =>
      fn({ query } as unknown as DatabaseQueryClient)
    const eventPublisher = { publish: vi.fn(async () => ({ successfulIds: [EVENT_ID], failures: [] })) }
    const publisher = createOutboxPublisher({ publisher: eventPublisher as EventBridgePublisher, withTransaction })

    await expect(publisher.publishBatch()).rejects.toThrow('connection terminated')
    expect(eventPublisher.publish).toHaveBeenCalledTimes(1)
  })
})
