import { describe, expect, it, vi } from 'vitest'
import { createEventBridgePublisher } from './eventbridge'
import type { DomainEvent } from '@/features/events/types'

const event: DomainEvent = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  aggregateType: 'profile',
  aggregateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  eventType: 'user.followed',
  schemaVersion: 1,
  occurredAt: '2026-09-07T12:00:00.000Z',
  payload: {
    eventType: 'user.followed',
    actorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    targetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  },
}

describe('EventBridge publisher', () => {
  it('maps accepted and rejected entries back to outbox event ids', async () => {
    const sender = {
      send: vi.fn(async () => ({ Entries: [{ EventId: 'aws-event' }] })),
    }
    const publisher = createEventBridgePublisher({ busName: 'social-events', sender })

    await expect(publisher.publish([event])).resolves.toEqual({
      successfulIds: [event.id],
      failures: [],
    })

    const command = sender.send.mock.calls[0]![0]
    expect(command.input.Entries?.[0]).toMatchObject({
      EventBusName: 'social-events',
      Source: 'sea-n-shore.social',
      DetailType: 'user.followed',
      Detail: JSON.stringify(event),
    })
  })

  it('returns a bounded failure description for rejected entries', async () => {
    const sender = {
      send: vi.fn(async () => ({ Entries: [{ ErrorCode: 'InternalFailure', ErrorMessage: 'retry me' }] })),
    }
    const publisher = createEventBridgePublisher({ busName: 'social-events', sender })

    await expect(publisher.publish([event])).resolves.toEqual({
      successfulIds: [],
      failures: [{ id: event.id, error: 'InternalFailure:retry me' }],
    })
  })

  it('rejects batches larger than EventBridge PutEvents supports', async () => {
    const publisher = createEventBridgePublisher({
      busName: 'social-events',
      sender: { send: vi.fn() },
    })

    await expect(publisher.publish(Array.from({ length: 11 }, () => event))).rejects.toThrow('eventbridge_batch_too_large')
  })
})
