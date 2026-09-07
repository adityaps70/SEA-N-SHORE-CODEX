import { describe, expect, it, vi } from 'vitest'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { createNotificationEventRepositoryForClient } from './repository'

const input = {
  eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  recipientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  actorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  type: 'new_follower' as const,
}

describe('notification event repository', () => {
  it('records a shadow receipt without inserting a notification', async () => {
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      void values
      if (sql.includes('insert into public.notification_event_receipts')) {
        return { rows: [{ event_id: input.eventId }] }
      }
      return { rows: [] }
    })
    const repository = createNotificationEventRepositoryForClient({ query } as unknown as DatabaseQueryClient)

    await expect(repository.processNotificationEvent({ ...input, mode: 'shadow' })).resolves.toEqual({
      processed: true,
      created: false,
      notificationId: null,
    })

    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]?.[0]).toContain('notification_event_receipts')
    expect(query.mock.calls[0]?.[1]).toEqual([input.eventId, 'shadow'])
    expect(query.mock.calls.some(([sql]) => sql.includes('insert into public.notifications'))).toBe(false)
  })

  it('creates one notification in active mode and links the receipt', async () => {
    const notificationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      void values
      if (sql.includes('insert into public.notification_event_receipts')) return { rows: [{ event_id: input.eventId }] }
      if (sql.includes('insert into public.notifications')) return { rows: [{ id: notificationId }] }
      return { rows: [] }
    })
    const repository = createNotificationEventRepositoryForClient({ query } as unknown as DatabaseQueryClient)

    await expect(repository.processNotificationEvent({ ...input, mode: 'active' })).resolves.toEqual({
      processed: true,
      created: true,
      notificationId,
    })

    expect(query.mock.calls.some(([sql]) => sql.includes('insert into public.notifications'))).toBe(true)
    expect(query.mock.calls.some(([sql]) => sql.includes('update public.notification_event_receipts'))).toBe(true)
  })

  it('treats a duplicate event id as a no-op in either mode', async () => {
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      void sql
      void values
      return { rows: [] }
    })
    const repository = createNotificationEventRepositoryForClient({ query } as unknown as DatabaseQueryClient)

    await expect(repository.processNotificationEvent({ ...input, mode: 'active' })).resolves.toEqual({
      processed: false,
      created: false,
      notificationId: null,
    })
    expect(query).toHaveBeenCalledTimes(1)
  })
})
