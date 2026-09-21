import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMessagingRealtimeConnection } from './connection'

const SIGNAL = JSON.stringify({
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
})

class FakeSocket {
  static instances: FakeSocket[] = []

  readonly url: string
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  send = vi.fn()
  close = vi.fn(() => {
    if (this.readyState === 3) return
    this.readyState = 3
    this.onclose?.(new CloseEvent('close'))
  })

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  open() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  message(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }))
  }
}

describe('messaging realtime connection lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.instances = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens with a fresh ticket, publishes each event once, reconnects after close and renews before registry expiry', async () => {
    const requestTicket = vi.fn(async () => ({
      ticket: `ticket-${requestTicket.mock.calls.length}`,
      webSocketUrl: 'wss://abc.execute-api.ap-south-1.amazonaws.com/staging',
    }))
    const onConnected = vi.fn()
    const onStatusChange = vi.fn()
    const listener = vi.fn()
    const connection = createMessagingRealtimeConnection({
      requestTicket,
      createSocket: (url) => new FakeSocket(url),
      onConnected,
      onStatusChange,
      random: () => 0,
      renewalMs: 55 * 60 * 1000,
    })
    connection.subscribe(listener)

    await connection.start()

    expect(FakeSocket.instances).toHaveLength(1)
    expect(FakeSocket.instances[0]?.url).toContain('ticket=ticket-1')
    FakeSocket.instances[0]?.open()
    expect(onConnected).toHaveBeenCalledTimes(1)
    expect(onStatusChange).toHaveBeenLastCalledWith('connected')

    FakeSocket.instances[0]?.message(SIGNAL)
    FakeSocket.instances[0]?.message(SIGNAL)
    expect(listener).toHaveBeenCalledTimes(1)

    expect(connection.sendTyping({
      conversationId: '33333333-3333-4333-8333-333333333333',
      targetProfileId: '22222222-2222-4222-8222-222222222222',
      isTyping: true,
    })).toBe(true)
    expect(FakeSocket.instances[0]?.send).toHaveBeenCalledWith(JSON.stringify({
      action: 'typing',
      conversationId: '33333333-3333-4333-8333-333333333333',
      targetProfileId: '22222222-2222-4222-8222-222222222222',
      isTyping: true,
    }))

    FakeSocket.instances[0]?.close()
    expect(onStatusChange).toHaveBeenLastCalledWith('backoff')
    expect(connection.sendTyping({
      conversationId: '33333333-3333-4333-8333-333333333333',
      targetProfileId: '22222222-2222-4222-8222-222222222222',
      isTyping: true,
    })).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(requestTicket).toHaveBeenCalledTimes(2)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(FakeSocket.instances[1]?.url).toContain('ticket=ticket-2')

    FakeSocket.instances[1]?.open()
    await vi.advanceTimersByTimeAsync(55 * 60 * 1000)
    expect(FakeSocket.instances[1]?.close).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(requestTicket).toHaveBeenCalledTimes(3)
  })

  it('backs off after ticket failure and stop prevents further reconnects', async () => {
    const requestTicket = vi.fn()
      .mockRejectedValueOnce(new Error('realtime unavailable'))
      .mockResolvedValue({
        ticket: 'second-ticket',
        webSocketUrl: 'wss://abc.execute-api.ap-south-1.amazonaws.com/staging',
      })
    const onStatusChange = vi.fn()
    const connection = createMessagingRealtimeConnection({
      requestTicket,
      createSocket: (url) => new FakeSocket(url),
      onStatusChange,
      random: () => 0,
    })

    await connection.start()
    expect(onStatusChange).toHaveBeenLastCalledWith('backoff')

    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeSocket.instances).toHaveLength(1)
    connection.stop()
    expect(FakeSocket.instances[0]?.close).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(requestTicket).toHaveBeenCalledTimes(2)
    expect(onStatusChange).toHaveBeenLastCalledWith('disconnected')
  })
})
