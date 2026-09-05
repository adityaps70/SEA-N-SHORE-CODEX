import { describe, expect, it, vi } from 'vitest'

const RECIPIENT_ID = '11111111-1111-4111-8111-111111111111'
const NOTIFICATION_ID = '22222222-2222-4222-8222-222222222222'

type QueryCall = [text: string, values?: readonly unknown[]]

function callsOf(query: { mock: { calls: unknown[] } }): QueryCall[] {
  return query.mock.calls as unknown as QueryCall[]
}

describe('Aurora notification repository', () => {
  it('lists only notifications belonging to the authenticated recipient with a clamped limit', async () => {
    const query = vi.fn(async () => [{
      id: NOTIFICATION_ID,
      actor_id: null,
      notification_type: 'new_follower',
      created_at: '2026-09-05T10:00:00.000Z',
      read_at: null,
    }])
    const { createNotificationRepository } = await import('./repository')
    const repository = createNotificationRepository({ query })

    await repository.listRecent(RECIPIENT_ID, 100)

    const [sql, values] = callsOf(query)[0]
    expect(sql).toContain('from public.notifications')
    expect(sql).toContain('recipient_id = $1')
    expect(sql).toContain('order by created_at desc')
    expect(sql).toContain('limit $2')
    expect(values).toEqual([RECIPIENT_ID, 50])
  })

  it('counts unread notifications only for the authenticated recipient', async () => {
    const query = vi.fn(async () => [{ unread_count: '3' }])
    const { createNotificationRepository } = await import('./repository')
    const repository = createNotificationRepository({ query })

    await expect(repository.countUnread(RECIPIENT_ID)).resolves.toBe(3)

    const [sql, values] = callsOf(query)[0]
    expect(sql).toContain('recipient_id = $1')
    expect(sql).toContain('read_at is null')
    expect(values).toEqual([RECIPIENT_ID])
  })

  it('marks one notification read only when both id and recipient match', async () => {
    const query = vi.fn(async () => [{ id: NOTIFICATION_ID }])
    const { createNotificationRepository } = await import('./repository')
    const repository = createNotificationRepository({ query })

    await expect(repository.markRead(RECIPIENT_ID, NOTIFICATION_ID)).resolves.toBe(true)

    const [sql, values] = callsOf(query)[0]
    expect(sql).toContain('update public.notifications')
    expect(sql).toContain('id = $1')
    expect(sql).toContain('recipient_id = $2')
    expect(sql).toContain('read_at = now()')
    expect(values).toEqual([NOTIFICATION_ID, RECIPIENT_ID])
  })

  it('fails closed when the requested notification does not belong to the recipient', async () => {
    const query = vi.fn(async () => [])
    const { createNotificationRepository } = await import('./repository')
    const repository = createNotificationRepository({ query })

    await expect(repository.markRead(RECIPIENT_ID, NOTIFICATION_ID)).resolves.toBe(false)
  })

  it('marks all unread notifications read only for the authenticated recipient', async () => {
    const query = vi.fn(async () => [])
    const { createNotificationRepository } = await import('./repository')
    const repository = createNotificationRepository({ query })

    await repository.markAllRead(RECIPIENT_ID)

    const [sql, values] = callsOf(query)[0]
    expect(sql).toContain('update public.notifications')
    expect(sql).toContain('recipient_id = $1')
    expect(sql).toContain('read_at is null')
    expect(sql).toContain('read_at = now()')
    expect(values).toEqual([RECIPIENT_ID])
  })
})
