import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
const navigation = vi.hoisted(() => ({ pathname: '/home' }))
const unread = vi.hoisted(() => {
  let snapshot = { count: 0, revision: 0 }
  const publishMessagingUnreadCount = vi.fn((count: number) => {
    snapshot = { count, revision: snapshot.revision + 1 }
  })

  return {
    publishMessagingUnreadCount,
    getMessagingUnreadCountSnapshot: () => snapshot,
    reset() {
      snapshot = { count: 0, revision: 0 }
    },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => navigation.pathname,
}))

vi.mock('@/features/messaging/unread-client', () => ({
  publishMessagingUnreadCount: unread.publishMessagingUnreadCount,
  getMessagingUnreadCountSnapshot: unread.getMessagingUnreadCountSnapshot,
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
  beforeEach(async () => {
    // Most tests want a socket that closes as soon as its provider unmounts.
    const { resetSharedRealtimeForTests } = await import('./provider')
    resetSharedRealtimeForTests(0)
    vi.clearAllMocks()
    unread.reset()
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

  afterEach(async () => {
    const { resetSharedRealtimeForTests } = await import('./provider')
    resetSharedRealtimeForTests()
    cleanup()
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
      <MessagingRealtimeProvider viewerProfileId="22222222-2222-4222-8222-222222222222">
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

  it('reconciles the global unread badge when the realtime socket connects even if a message event was missed', async () => {
    const providerPath = './provider'
    const { MessagingRealtimeProvider } = await import(providerPath) as typeof import('./provider')

    render(
      <MessagingRealtimeProvider viewerProfileId="22222222-2222-4222-8222-222222222222">
        <div>Home content</div>
      </MessagingRealtimeProvider>,
    )

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    expect(unread.publishMessagingUnreadCount).not.toHaveBeenCalled()

    act(() => FakeWebSocket.instances[0]?.open())

    await waitFor(() => expect(unread.publishMessagingUnreadCount).toHaveBeenCalledWith(4))
    expect(screen.queryByText('New message from Capt. Anita Singh')).not.toBeInTheDocument()
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it('still refreshes canonical server state for social invalidation signals', async () => {
    const providerPath = './provider'
    const { MessagingRealtimeProvider } = await import(providerPath) as typeof import('./provider')

    render(
      <MessagingRealtimeProvider viewerProfileId="22222222-2222-4222-8222-222222222222">
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

    // Round 14 (3.2): refreshes are coalesced into one per 2-second window.
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1), { timeout: 3_000 })
  })

  it('keeps one connection across navigation (Round 14, 3.2)', async () => {
    const providerPath = './provider'
    const { MessagingRealtimeProvider } = await import(providerPath) as typeof import('./provider')
    const view = render(
      <MessagingRealtimeProvider viewerProfileId="22222222-2222-4222-8222-222222222222">
        <div>Home content</div>
      </MessagingRealtimeProvider>,
    )
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    act(() => FakeWebSocket.instances[0]?.open())

    navigation.pathname = '/jobs'
    view.rerender(
      <MessagingRealtimeProvider viewerProfileId="22222222-2222-4222-8222-222222222222">
        <div>Jobs content</div>
      </MessagingRealtimeProvider>,
    )
    navigation.pathname = '/network'
    view.rerender(
      <MessagingRealtimeProvider viewerProfileId="22222222-2222-4222-8222-222222222222">
        <div>Network content</div>
      </MessagingRealtimeProvider>,
    )

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0]?.close).not.toHaveBeenCalled()
  })

  it('keeps one socket, one ticket and one state fetch when navigation moves to another layout (Round H, H1)', async () => {
    const { MessagingRealtimeProvider, resetSharedRealtimeForTests } = await import('./provider')
    resetSharedRealtimeForTests(30_000)
    const viewer = '22222222-2222-4222-8222-222222222222'
    const callsTo = (path: string) => vi.mocked(fetch).mock.calls.filter(([input]) => String(input) === path).length

    // Home, in the (app) layout.
    const app = render(<MessagingRealtimeProvider viewerProfileId={viewer}><div>Home</div></MessagingRealtimeProvider>)
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    act(() => FakeWebSocket.instances[0]?.open())
    await waitFor(() => expect(callsTo('/api/realtime/messaging-state')).toBe(1))

    // Learn, in the (public) layout: the (app) provider unmounts and another one mounts.
    app.unmount()
    const learn = render(<MessagingRealtimeProvider viewerProfileId={viewer}><div>Learn</div></MessagingRealtimeProvider>)
    // And back to Events in the (app) layout.
    learn.unmount()
    render(<MessagingRealtimeProvider viewerProfileId={viewer}><div>Events</div></MessagingRealtimeProvider>)
    await act(async () => { await Promise.resolve() })

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0]?.close).not.toHaveBeenCalled()
    expect(callsTo('/api/realtime/ticket')).toBe(1)
    expect(callsTo('/api/realtime/messaging-state')).toBe(1)
  })

  it('closes the shared socket once no page has used it for the grace period', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { MessagingRealtimeProvider, REALTIME_RELEASE_GRACE_MS, resetSharedRealtimeForTests } = await import('./provider')
      resetSharedRealtimeForTests(REALTIME_RELEASE_GRACE_MS)
      const view = render(<MessagingRealtimeProvider viewerProfileId="22222222-2222-4222-8222-222222222222"><div>Home</div></MessagingRealtimeProvider>)
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
      act(() => FakeWebSocket.instances[0]?.open())
      view.unmount()
      act(() => { vi.advanceTimersByTime(REALTIME_RELEASE_GRACE_MS - 1) })
      expect(FakeWebSocket.instances[0]?.close).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(1) })
      expect(FakeWebSocket.instances[0]?.close).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never reuses a socket for a different member', async () => {
    const { MessagingRealtimeProvider, resetSharedRealtimeForTests } = await import('./provider')
    resetSharedRealtimeForTests(30_000)
    const first = render(<MessagingRealtimeProvider viewerProfileId="22222222-2222-4222-8222-222222222222"><div>A</div></MessagingRealtimeProvider>)
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    first.unmount()
    render(<MessagingRealtimeProvider viewerProfileId="44444444-4444-4444-8444-444444444444"><div>B</div></MessagingRealtimeProvider>)
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2))
    expect(FakeWebSocket.instances[0]?.close).toHaveBeenCalled()
  })

  it('updates the global unread badge and shows an in-app new-message alert even outside Messages', async () => {
    const providerPath = './provider'
    const { MessagingRealtimeProvider } = await import(providerPath) as typeof import('./provider')

    render(
      <MessagingRealtimeProvider viewerProfileId="22222222-2222-4222-8222-222222222222">
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

  it('does not show a new-message alert or increment unread state for the viewer own sent message', async () => {
    const providerPath = './provider'
    const { MessagingRealtimeProvider } = await import(providerPath) as typeof import('./provider')

    render(
      <MessagingRealtimeProvider viewerProfileId="22222222-2222-4222-8222-222222222222">
        <div>Home content</div>
      </MessagingRealtimeProvider>,
    )

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    act(() => FakeWebSocket.instances[0]?.open())
    await waitFor(() => expect(unread.publishMessagingUnreadCount).toHaveBeenCalledWith(4))
    unread.publishMessagingUnreadCount.mockClear()
    vi.mocked(fetch).mockClear()

    act(() => FakeWebSocket.instances[0]?.message(JSON.stringify({
      eventId: 'event-self-1',
      eventType: 'message.created',
      schemaVersion: 1,
      occurredAt: '2026-09-13T10:00:02.000Z',
      aggregateId: '66666666-6666-4666-8666-666666666666',
      payload: {
        eventType: 'message.created',
        conversationId: '33333333-3333-4333-8333-333333333333',
        messageId: '66666666-6666-4666-8666-666666666666',
        senderId: '22222222-2222-4222-8222-222222222222',
        recipientProfileIds: ['11111111-1111-4111-8111-111111111111'],
      },
    })))

    await act(async () => {
      await Promise.resolve()
    })

    expect(unread.publishMessagingUnreadCount).not.toHaveBeenCalled()
    expect(screen.queryByText('New message from Capt. Anita Singh')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalledWith('/api/realtime/messaging-state', expect.anything())
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it('does not show a duplicate new-message alert while already inside that conversation', async () => {
    navigation.pathname = '/messages/33333333-3333-4333-8333-333333333333'
    const providerPath = './provider'
    const { MessagingRealtimeProvider } = await import(providerPath) as typeof import('./provider')

    render(
      <MessagingRealtimeProvider viewerProfileId="22222222-2222-4222-8222-222222222222">
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
