import { describe, expect, it } from 'vitest'
import {
  buildRealtimeWebSocketUrl,
  createRealtimeEventDedupe,
  parseRealtimeSignal,
  reconnectDelayMs,
} from './client'

const MESSAGE_SIGNAL = {
  eventId: 'event-1',
  eventType: 'message.created',
  schemaVersion: 1,
  occurredAt: '2026-09-13T10:00:00.000Z',
  aggregateId: '55555555-5555-4555-8555-555555555555',
  payload: {
    eventType: 'message.created',
    conversationId: '33333333-3333-4333-8333-333333333333',
    messageId: '55555555-5555-4555-8555-555555555555',
    senderId: '11111111-1111-4111-8111-111111111111',
    recipientProfileIds: ['22222222-2222-4222-8222-222222222222'],
  },
} as const

const SOCIAL_INVALIDATION_TYPES = [
  ['feed.post_created', 'feed'],
  ['feed.post_reaction_changed', 'feed'],
  ['feed.post_comments_changed', 'feed'],
  ['feed.post_reposted', 'feed'],
  ['connection.accepted', 'network'],
] as const

describe('realtime browser client primitives', () => {
  it('adds the short-lived ticket to a WebSocket URL without losing existing query parameters', () => {
    expect(buildRealtimeWebSocketUrl(
      'wss://abc.execute-api.ap-south-1.amazonaws.com/staging?source=web',
      'payload.signature',
    )).toBe(
      'wss://abc.execute-api.ap-south-1.amazonaws.com/staging?source=web&ticket=payload.signature',
    )
  })

  it('rejects non-WebSocket endpoints', () => {
    expect(() => buildRealtimeWebSocketUrl('https://example.test/realtime', 'ticket')).toThrow(
      'realtime_invalid_websocket_url',
    )
  })

  it('parses routing-safe message and read-cursor signals and ignores malformed or unknown events', () => {
    expect(parseRealtimeSignal(JSON.stringify(MESSAGE_SIGNAL))).toEqual(MESSAGE_SIGNAL)

    const readSignal = {
      eventId: 'event-2',
      eventType: 'conversation.read_cursor_advanced',
      schemaVersion: 1,
      occurredAt: '2026-09-13T10:01:00.000Z',
      aggregateId: '33333333-3333-4333-8333-333333333333',
      payload: {
        eventType: 'conversation.read_cursor_advanced',
        conversationId: '33333333-3333-4333-8333-333333333333',
        readerProfileId: '22222222-2222-4222-8222-222222222222',
        lastReadMessageId: '55555555-5555-4555-8555-555555555555',
        lastReadAt: '2026-09-13T10:00:00.000Z',
        participantProfileIds: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
      },
    }

    expect(parseRealtimeSignal(JSON.stringify(readSignal))).toEqual(readSignal)

    const updatedSignal = {
      eventId: 'event-3',
      eventType: 'message.updated',
      schemaVersion: 1,
      occurredAt: '2026-09-20T10:02:00.000Z',
      aggregateId: '55555555-5555-4555-8555-555555555555',
      payload: {
        eventType: 'message.updated',
        conversationId: '33333333-3333-4333-8333-333333333333',
        messageId: '55555555-5555-4555-8555-555555555555',
        actorId: '11111111-1111-4111-8111-111111111111',
        participantProfileIds: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
      },
    }

    expect(parseRealtimeSignal(JSON.stringify(updatedSignal))).toEqual(updatedSignal)

    const typingSignal = {
      eventId: 'typing-1',
      eventType: 'conversation.typing',
      schemaVersion: 1,
      occurredAt: '2026-09-20T10:03:00.000Z',
      aggregateId: '33333333-3333-4333-8333-333333333333',
      payload: {
        eventType: 'conversation.typing',
        conversationId: '33333333-3333-4333-8333-333333333333',
        actorId: '11111111-1111-4111-8111-111111111111',
        targetProfileId: '22222222-2222-4222-8222-222222222222',
        isTyping: true,
      },
    }

    expect(parseRealtimeSignal(JSON.stringify(typingSignal))).toEqual(typingSignal)
    expect(parseRealtimeSignal('{not-json')).toBeNull()
    expect(parseRealtimeSignal(JSON.stringify({ ...MESSAGE_SIGNAL, eventId: '' }))).toBeNull()
    expect(parseRealtimeSignal(JSON.stringify({ ...MESSAGE_SIGNAL, eventType: 'message.delivered' }))).toBeNull()
    expect(parseRealtimeSignal(JSON.stringify({ ...MESSAGE_SIGNAL, payload: null }))).toBeNull()
    expect(parseRealtimeSignal(new ArrayBuffer(8))).toBeNull()
  })

  it.each(SOCIAL_INVALIDATION_TYPES)(
    'parses metadata-only %s invalidation signals without exposing domain payloads',
    (eventType, scope) => {
      const signal = {
        eventId: `event-${eventType}`,
        eventType,
        schemaVersion: 1,
        occurredAt: '2026-09-14T08:30:00.000Z',
        scope,
      }

      expect(parseRealtimeSignal(JSON.stringify(signal))).toEqual(signal)
      expect(parseRealtimeSignal(JSON.stringify({
        ...signal,
        aggregateId: '33333333-3333-4333-8333-333333333333',
      }))).toBeNull()
      expect(parseRealtimeSignal(JSON.stringify({
        ...signal,
        payload: { body: 'must never cross the realtime boundary' },
      }))).toBeNull()
    },
  )

  it('suppresses duplicate event ids with bounded memory and allows an evicted id again', () => {
    const accept = createRealtimeEventDedupe(2)

    expect(accept('event-a')).toBe(true)
    expect(accept('event-a')).toBe(false)
    expect(accept('event-b')).toBe(true)
    expect(accept('event-c')).toBe(true)
    expect(accept('event-a')).toBe(true)
  })

  it('uses capped exponential reconnect backoff with bounded jitter', () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(1000)
    expect(reconnectDelayMs(1, () => 0)).toBe(2000)
    expect(reconnectDelayMs(2, () => 1)).toBe(5000)
    expect(reconnectDelayMs(20, () => 1)).toBe(30000)
  })
})
