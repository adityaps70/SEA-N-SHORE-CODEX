import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

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

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  close = vi.fn(() => {
    if (this.readyState === 3) return
    this.readyState = 3
    this.onclose?.(new CloseEvent('close'))
  })

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  message(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }))
  }
}

describe('MessagingRealtimeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ticket: 'payload.signature',
      expiresAt: '2026-09-13T10:01:00.000Z',
      webSocketUrl: 'wss://abc.execute-api.ap-south-1.amazonaws.com/staging',
    }), { status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shares one authenticated socket, refreshes canonical state and publishes each signal once', async () => {
    const providerPath = './provider'
    const { MessagingRealtimeProvider, useMessagingRealtime } = await import(providerPath) as typeof import('./provider')
    const listener = vi.fn()

    function Probe() {
      const realtime = useMessagingRealtime()
      useEffect(() => realtime.subscribe(listener), [realtime])
      return <span data-testid="status">{realtime.status}</span>
    }

    const rendered = render(
      <MessagingRealtimeProvider>
        <Probe />
      </MessagingRealtimeProvider>,
    )

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    expect(fetch).toHaveBeenCalledWith('/api/realtime/ticket', {
      method: 'POST',
      cache: 'no-store',
    })
    expect(FakeWebSocket.instances[0]?.url).toContain('ticket=payload.signature')

    act(() => FakeWebSocket.instances[0]?.open())
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    expect(router.refresh).toHaveBeenCalledTimes(1)

    act(() => {
      FakeWebSocket.instances[0]?.message(SIGNAL)
      FakeWebSocket.instances[0]?.message(SIGNAL)
    })
    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(2))

    rendered.unmount()
    expect(FakeWebSocket.instances[0]?.close).toHaveBeenCalled()
  })
})
