import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
const navigation = vi.hoisted(() => ({ pathname: '/home' }))
const unread = vi.hoisted(() => ({ publishMessagingUnreadCount: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => navigation.pathname,
}))

vi.mock('@/features/messaging/unread-client', () => ({
  publishMessagingUnreadCount: unread.publishMessagingUnreadCount,
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
  send = vi.fn()
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
    navigation.pathname = '/home'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/realtime/ticket') {
        return new Response(JSON.stringify({
          ticket: 'payload.signature',
          expiresAt: '2026-09-13T10:01:00.000Z',
          webSocketUrl: 'wss://abc.execute-api.ap-south-1.amazonaws.com/staging',
        }), { status: 200 })
      }
      if (url === '/api/realtime/messaging-state') {
        return new Response(JSON.stringify({
          unreadCount: 4,
          inbox: [{
            conversationId: '33333333-3333-4333-8333-333333333333',
            otherProfileId: '11111111-1111-4111-8111-111111111111',
            otherName: 'Capt. Anita Singh',
            otherHeadline: 'Master Mariner',
            otherAvatarUrl: null,
            lastMessageId: '55555555-5555-4555-8555-555555555555',
            lastMessageBody: 'Bridge photo received.',
            lastMessageSenderId: '11111111-1111-4111-8111-111111111111',
            lastMessageAt: '2026-09-13T10:00:00.000Z',
            otherLastReadMessageId: null,
            otherLastReadAt: null,
            unread: true,
          }],
        }), { status: 200 })
      }
      throw new Error(`Unexpected fetch ${url}`)
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shares one authenticated socket without refreshing on connect or messaging events', async () => {
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
    expect(router.refresh).not.toHaveBeenCalled()

    act(() => {
      FakeWebSocket.instances[0]?.message(SIGNAL)
      FakeWebSocket.instances[0]?.message(SIGNAL)
    })
    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    expect(router.refresh).not.toHaveBeenCalled()

    rendered.unmount()
    expect(FakeWebSocket.instances[0]?.close).toHaveBeenCalled()
  })

  it('still refreshes canonical server state for social invalidation signals', async () => {
    const providerPath = './provider'
    const { MessagingRealtimeProvider } = await import(providerPath) as typeof import('./provider')

    render(
      <MessagingRealtimeProvider>
        <div>Home content</div>
      </MessagingRealtimeProvider>,
    )

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    act(() => FakeWebSocket.instances[0]?.open())
    act(() => FakeWebSocket.instances[0]?.message(JSON.stringify({
      eventId: 'event-social-1',
      eventType: 'feed.post_created',
      schemaVersion: 1,
      occurredAt: '2026-09-13T10:00:01.000Z',
      scope: 'feed',
    })))

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1))
  })

  it('updates the global unread badge and shows an in-app new-message alert even outside Messages', async () => {
    const providerPath = './provider'
    const { MessagingRealtimeProvider } = await import(providerPath) as typeof import('./provider')

    render(
      <MessagingRealtimeProvider>
        <div>Home content</div>
      </MessagingRealtimeProvider>,
    )

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    act(() => FakeWebSocket.instances[0]?.open())
    act(() => FakeWebSocket.instances[0]?.message(SIGNAL))

    await waitFor(() => expect(unread.publishMessagingUnreadCount).toHaveBeenCalledWith(4))
    expect(await screen.findByText('New message from Capt. Anita Singh')).toBeVisible()
    expect(screen.getByText('Bridge photo received.')).toBeVisible()

    await act(async () => {
      screen.getByRole('button', { name: 'Open conversation' }).click()
    })
    expect(router.push).toHaveBeenCalledWith('/messages/33333333-3333-4333-8333-333333333333')
  })

  it('does not show a duplicate new-message alert while already inside that conversation', async () => {
    navigation.pathname = '/messages/33333333-3333-4333-8333-333333333333'
    const providerPath = './provider'
    const { MessagingRealtimeProvider } = await import(providerPath) as typeof import('./provider')

    render(
      <MessagingRealtimeProvider>
        <div>Conversation</div>
      </MessagingRealtimeProvider>,
    )

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    act(() => FakeWebSocket.instances[0]?.open())
    act(() => FakeWebSocket.instances[0]?.message(SIGNAL))

    await waitFor(() => expect(screen.getByText('Conversation')).toBeVisible())
    expect(router.refresh).not.toHaveBeenCalled()
    expect(unread.publishMessagingUnreadCount).not.toHaveBeenCalled()
    expect(screen.queryByText('New message from Capt. Anita Singh')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalledWith('/api/realtime/messaging-state', expect.anything())
  })
})
