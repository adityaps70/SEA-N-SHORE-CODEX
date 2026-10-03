import { describe, expect, it } from 'vitest'
import { parseDomainEvent } from './validation'

const valid = {
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

describe('social event validation', () => {
  it('accepts a versioned supported event', () => {
    expect(parseDomainEvent(valid)).toEqual(valid)
  })

  it('rejects unknown event types and mismatched payload types', () => {
    expect(() => parseDomainEvent({ ...valid, eventType: 'post.shared' })).toThrow()
    expect(() => parseDomainEvent({
      ...valid,
      payload: { ...valid.payload, eventType: 'connection.requested' },
    })).toThrow()
  })

  it('rejects malformed ids and unsupported schema versions', () => {
    expect(() => parseDomainEvent({ ...valid, id: 'not-a-uuid' })).toThrow()
    expect(() => parseDomainEvent({ ...valid, schemaVersion: 2 })).toThrow()
  })
})
