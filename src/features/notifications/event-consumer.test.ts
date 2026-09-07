import { describe, expect, it, vi } from 'vitest'
import { createNotificationEventConsumer } from './event-consumer'
import type { NotificationEventRepository } from './repository'
import type { DomainEvent } from '@/features/events/types'

function consumer() {
  const repository = {
    createNotificationFromEvent: vi.fn(async () => ({ created: true, notificationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })),
  }
  const withTransaction = async <T>(fn: (repo: NotificationEventRepository) => Promise<T>) =>
    fn(repository as unknown as NotificationEventRepository)
  return { consumer: createNotificationEventConsumer({ withTransaction }), repository }
}

const base = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  schemaVersion: 1 as const,
  occurredAt: '2026-09-07T12:00:00.000Z',
}

describe('notification event consumer', () => {
  it.each([
    [
      {
        ...base,
        aggregateType: 'profile' as const,
        aggregateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        eventType: 'user.followed' as const,
        payload: {
          eventType: 'user.followed' as const,
          actorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          targetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      },
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
  ])('maps %s to notification type %s', async (event, expectedType) => {
    const context = consumer()
    await context.consumer.consume(event as DomainEvent)
    expect(context.repository.createNotificationFromEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: base.id,
      type: expectedType,
    }))
  })

  it('propagates the repository duplicate no-op result as success', async () => {
    const repository = {
      createNotificationFromEvent: vi.fn(async () => ({ created: false, notificationId: null })),
    }
    const withTransaction = async <T>(fn: (repo: NotificationEventRepository) => Promise<T>) =>
      fn(repository as unknown as NotificationEventRepository)
    const eventConsumer = createNotificationEventConsumer({ withTransaction })
    const event: DomainEvent = {
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

    await expect(eventConsumer.consume(event)).resolves.toEqual({ created: false, notificationId: null })
  })
})
