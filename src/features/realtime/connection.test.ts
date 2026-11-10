// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMessagingRealtimeConnection, MAX_TICKET_REFUSALS, REALTIME_HEARTBEAT_MS, RealtimeTicketRefusedError, SERVER_CLOSE_RECONNECT_SPREAD_MS, SLOW_RETRY_AFTER_FAILURES, SLOW_RETRY_MS, TICKET_REFUSED_RETRY_MS, TYPING_MIN_INTERVAL_MS } from './connection'

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

  it('sends typing with a membership token, at most once per interval, latest state first (Round 14, 2.9)', async () => {
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const targetProfileId = '22222222-2222-4222-8222-222222222222'
    const requestTypingToken = vi.fn(async () => ({ token: '1790000000.signed', targetProfileId, expiresAt: Math.floor(Date.now() / 1000) + 3600 }))
    const connection = createMessagingRealtimeConnection({
      requestTicket: async () => ({ ticket: 'ticket', webSocketUrl: 'wss://abc.execute-api.ap-south-1.amazonaws.com/staging' }),
      requestTypingToken,
      createSocket: (url) => new FakeSocket(url),
      random: () => 0,
    })
    await connection.start()
    const socket = FakeSocket.instances[0]!
    socket.open()

    expect(connection.sendTyping({ conversationId, targetProfileId, isTyping: true })).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(socket.send.mock.calls[0]![0] as string)).toEqual({
      action: 'typing', conversationId, targetProfileId, isTyping: true, typingToken: '1790000000.signed',
    })

    // Within the interval: only the latest state is kept, and it goes out when the interval ends.
    connection.sendTyping({ conversationId, targetProfileId, isTyping: true })
    connection.sendTyping({ conversationId, targetProfileId, isTyping: false })
    await vi.advanceTimersByTimeAsync(TYPING_MIN_INTERVAL_MS - 100)
    expect(socket.send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(socket.send).toHaveBeenCalledTimes(2)
    expect(JSON.parse(socket.send.mock.calls[1]![0] as string)).toMatchObject({ isTyping: false })
    expect(requestTypingToken).toHaveBeenCalledTimes(1)

    // A token for a different participant is never used.
    connection.sendTyping({ conversationId, targetProfileId: '44444444-4444-4444-8444-444444444444', isTyping: true })
    await vi.advanceTimersByTimeAsync(TYPING_MIN_INTERVAL_MS)
    expect(socket.send).toHaveBeenCalledTimes(2)
    connection.stop()
  })
})

describe('heartbeat and reconnect spread (Round ARCH Phase 5)', () => {
  const ticket = async () => ({ ticket: 't', webSocketUrl: 'wss://abc.execute-api.ap-south-1.amazonaws.com/staging' })

  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.instances = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pings every 5 minutes while open, and stops pinging once closed', async () => {
    const connection = createMessagingRealtimeConnection({ requestTicket: ticket, createSocket: (url) => new FakeSocket(url), random: () => 0 })
    await connection.start()
    const socket = FakeSocket.instances[0]!
    socket.open()
    expect(REALTIME_HEARTBEAT_MS).toBe(300_000)
    await vi.advanceTimersByTimeAsync(REALTIME_HEARTBEAT_MS - 1)
    expect(socket.send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(socket.send).toHaveBeenCalledWith('{"action":"ping"}')
    await vi.advanceTimersByTimeAsync(REALTIME_HEARTBEAT_MS)
    expect(socket.send).toHaveBeenCalledTimes(2)
    connection.stop()
    await vi.advanceTimersByTimeAsync(REALTIME_HEARTBEAT_MS * 3)
    expect(socket.send).toHaveBeenCalledTimes(2)
  })

  it('spreads the reconnect after a server close of a working connection over up to 30 s, but not after a failed connect', async () => {
    const connection = createMessagingRealtimeConnection({ requestTicket: ticket, createSocket: (url) => new FakeSocket(url), random: () => 0.5 })
    await connection.start()
    const first = FakeSocket.instances[0]!
    first.open()
    // The server closes a working connection (a deploy): first backoff 1,000 ms + up to 250 ms, plus half of 30 s.
    first.readyState = 3
    first.onclose?.(new CloseEvent('close'))
    await vi.advanceTimersByTimeAsync(1_125 + SERVER_CLOSE_RECONNECT_SPREAD_MS / 2 - 1)
    expect(FakeSocket.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.instances).toHaveLength(2)

    // A connect that never opened (for example refused at the 5-connection cap) uses the plain backoff: the second
    // attempt waits 2,000 ms + 250 ms, with no spread.
    const second = FakeSocket.instances[1]!
    second.readyState = 3
    second.onclose?.(new CloseEvent('close'))
    await vi.advanceTimersByTimeAsync(2_249)
    expect(FakeSocket.instances).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.instances).toHaveLength(3)
    connection.stop()
  })
})

describe('ticket refusals and repeated failures (Round ARCH realtime ticket fix)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.instances = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const URL = 'wss://abc.execute-api.ap-south-1.amazonaws.com/staging'

  it('a 401 stops the fast retries: the next ask waits 5 minutes, and after 3 refusals it stops until shown again', async () => {
    const requestTicket = vi.fn(async (): Promise<{ ticket: string; webSocketUrl: string }> => { throw new RealtimeTicketRefusedError(401) })
    const onStatusChange = vi.fn()
    const connection = createMessagingRealtimeConnection({ requestTicket, createSocket: (url) => new FakeSocket(url), onStatusChange, random: () => 0 })

    await connection.start()
    expect(requestTicket).toHaveBeenCalledTimes(1)
    // Not on the fast backoff: nothing in the next 4 minutes 59 seconds.
    await vi.advanceTimersByTimeAsync(TICKET_REFUSED_RETRY_MS - 1_000)
    expect(requestTicket).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(requestTicket).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(TICKET_REFUSED_RETRY_MS)
    expect(requestTicket).toHaveBeenCalledTimes(MAX_TICKET_REFUSALS)
    // Three refusals in a row: it stops asking, and the socket stays down so the timed polls run.
    expect(connection.getStatus()).toBe('disconnected')
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(requestTicket).toHaveBeenCalledTimes(MAX_TICKET_REFUSALS)
    expect(FakeSocket.instances).toHaveLength(0)

    // Shown again (or back online): it asks at once, with fresh counts.
    requestTicket.mockImplementation(async () => ({ ticket: 'fresh', webSocketUrl: URL }))
    connection.reconnectNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(requestTicket).toHaveBeenCalledTimes(MAX_TICKET_REFUSALS + 1)
    FakeSocket.instances[0]?.open()
    expect(connection.getStatus()).toBe('connected')
    connection.stop()
  })

  it('a 403 counts as a refusal too; other errors keep the fast backoff', async () => {
    let calls = 0
    const requestTicket = vi.fn(async (): Promise<{ ticket: string; webSocketUrl: string }> => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('forbidden'), { status: 403 })
      throw new Error('network down')
    })
    const connection = createMessagingRealtimeConnection({ requestTicket, createSocket: (url) => new FakeSocket(url), random: () => 0 })
    await connection.start()
    await vi.advanceTimersByTimeAsync(TICKET_REFUSED_RETRY_MS)
    expect(requestTicket).toHaveBeenCalledTimes(2)
    // A network error: retried on the usual backoff (1 s first), not after 5 minutes.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(requestTicket).toHaveBeenCalledTimes(3)
    connection.stop()
  })

  it('after 10 failures in a row it retries every 5 minutes instead of every 30 s, until a socket opens', async () => {
    const requestTicket = vi.fn(async (): Promise<{ ticket: string; webSocketUrl: string }> => { throw new Error('network down') })
    const connection = createMessagingRealtimeConnection({ requestTicket, createSocket: (url) => new FakeSocket(url), random: () => 0 })
    await connection.start()
    // The usual backoff (1, 2, 4, ... capped at 30 s) until the 10th failure.
    while (requestTicket.mock.calls.length < SLOW_RETRY_AFTER_FAILURES) await vi.advanceTimersByTimeAsync(1_000)
    const at10 = requestTicket.mock.calls.length
    await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS - 1_000)
    expect(requestTicket).toHaveBeenCalledTimes(at10)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(requestTicket).toHaveBeenCalledTimes(at10 + 1)

    // A socket that opens resets the counts.
    requestTicket.mockImplementation(async () => ({ ticket: 'ok', webSocketUrl: URL }))
    await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS)
    FakeSocket.instances.at(-1)?.open()
    expect(connection.getStatus()).toBe('connected')
    FakeSocket.instances.at(-1)?.close()
    const afterClose = requestTicket.mock.calls.length
    await vi.advanceTimersByTimeAsync(SERVER_CLOSE_RECONNECT_SPREAD_MS + 1_000)
    expect(requestTicket.mock.calls.length).toBeGreaterThan(afterClose)
    connection.stop()
  })
})
