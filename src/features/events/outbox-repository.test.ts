import { describe, expect, it, vi } from 'vitest'
import { createOutboxRepositoryForClient } from './outbox-repository'
import type { DatabaseQueryClient } from '@/lib/db/client'

const EVENT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  aggregateType: 'profile' as const,
  aggregateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  eventType: 'user.followed' as const,
  schemaVersion: 1 as const,
  occurredAt: '2026-09-07T12:00:00.000Z',
  payload: {
    eventType: 'user.followed' as const,
    actorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    targetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  },
}

describe('event outbox repository', () => {
  it('enqueues an unpublished event with a JSON payload', async () => {
    const query = vi.fn<DatabaseQueryClient['query']>(async () => ({ rows: [] }))
    const repository = createOutboxRepositoryForClient({ query } as DatabaseQueryClient)

    await repository.enqueue(EVENT)

    expect(query).toHaveBeenCalledTimes(1)
    const [sql, values] = query.mock.calls[0]!
    expect(sql).toContain('insert into public.event_outbox')
    expect(sql).not.toContain('published_at')
    expect(values).toEqual([
      EVENT.id,
      EVENT.aggregateType,
      EVENT.aggregateId,
      EVENT.eventType,
      EVENT.schemaVersion,
      JSON.stringify(EVENT.payload),
      EVENT.occurredAt,
    ])
  })
})
