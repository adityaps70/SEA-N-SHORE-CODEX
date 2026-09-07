import { describe, expect, it, vi } from 'vitest'
import { createNotificationEventConsumer } from './event-consumer'
import type { NotificationEventRepository } from './repository'
import type { DomainEvent } from '@/features/events/types'

function consumer(mode: 'shadow' | 'active' = 'shadow') {
  const repository = {
    processNotificationEvent: vi.fn(async () => ({
      processed: true,
      created: mode === 'active',
      notificationId: mode === 'active' ? 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' : null,
    })),
  }
  const withTransaction = async <T>(fn: (repo: NotificationEventRepository) => Promise<T>) =>
    fn(repository as unknown as NotificationEventRepository)
  return { consumer: createNotificationEventConsumer({ mode, withTransaction }), repository }
}

const base = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  schemaVersion: 1 as const,
  occurredAt: '2026-09-07T12:00:00.000Z',
}

const followedEvent: DomainEvent = {
  ...base,
  aggregateType: 'profile',
  aggregateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  eventType: 'user.followed',
  payload: {
    eventType: 'user.followed',
    actorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    targetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  },
}

describe('notification event consumer', () => {
  it.each([
    [
      followedEvent,
      'new_follower',
    ],
    [
      {
        ...base,
        aggregateType: 'connection' as const,
        aggregateId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        eventType: 'connection.requested' as const,
        payload: {
          eventType: 'connection.requested' as const,
          actorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          targetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          connectionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        },
      },
      'connection_request',
    ],
    [
      {
        ...base,
        aggregateType: 'connection' as const,
        aggregateId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        eventType: 'connection.accepted' as const,
        payload: {
          eventType: 'connection.accepted' as const,
          actorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          connectionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          requestedBy: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
      },
      'connection_accepted',
    ],
  ])('maps %s to notification type %s while preserving the configured mode', async (event, expectedType) => {
    const context = consumer('shadow')
    await context.consumer.consume(event as DomainEvent)
    expect(context.repository.processNotificationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: base.id,
      type: expectedType,
      mode: 'shadow',
    }))
  })

  it('keeps shadow processing receipt-only', async () => {
    const context = consumer('shadow')
    await expect(context.consumer.consume(followedEvent)).resolves.toEqual({
      processed: true,
      created: false,
      notificationId: null,
    })
  })

  it('allows active mode to create notifications after cutover', async () => {
    const context = consumer('active')
    await expect(context.consumer.consume(followedEvent)).resolves.toEqual({
      processed: true,
      created: true,
      notificationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    })
    expect(context.repository.processNotificationEvent).toHaveBeenCalledWith(expect.objectContaining({ mode: 'active' }))
  })

  it('propagates duplicate event receipts as a successful no-op', async () => {
    const repository = {
      processNotificationEvent: vi.fn(async () => ({ processed: false, created: false, notificationId: null })),
    }
    const withTransaction = async <T>(fn: (repo: NotificationEventRepository) => Promise<T>) =>
      fn(repository as unknown as NotificationEventRepository)
    const eventConsumer = createNotificationEventConsumer({ mode: 'shadow', withTransaction })

    await expect(eventConsumer.consume(followedEvent)).resolves.toEqual({
      processed: false,
      created: false,
      notificationId: null,
    })
  })
})
