import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessagingRealtimeSignal } from '@/features/realtime/client'
import type { MessagingMessageDto } from '../queries'

const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const INITIAL_ID = '44444444-4444-4444-8444-444444444444'
const INCOMING_ID = '55555555-5555-4555-8555-555555555555'

const unread = vi.hoisted(() => ({
  publishMessagingUnreadCount: vi.fn(),
}))

const realtime = vi.hoisted(() => {
  const listeners = new Set<(signal: MessagingRealtimeSignal) => void>()
  return {
    listeners,
    subscribe: vi.fn((listener: (signal: MessagingRealtimeSignal) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    emit: (signal: MessagingRealtimeSignal) => {
      for (const listener of listeners) listener(signal)
    },
  }
})

vi.mock('../unread-client', () => ({
  publishMessagingUnreadCount: unread.publishMessagingUnreadCount,
}))

vi.mock('@/features/realtime/provider', () => ({
  useMessagingRealtime: () => ({
    status: 'connected',
    subscribe: realtime.subscribe,
  }),
}))

vi.mock('./conversation-list', () => ({
  ConversationList: ({ inbox }: { inbox: Array<{ lastMessageBody: string | null; unread: boolean }> }) => (
    <div>
      <span data-testid="inbox-last-message">{inbox[0]?.lastMessageBody ?? 'none'}</span>
      <span data-testid="inbox-unread">{inbox[0]?.unread ? 'unread' : 'read'}</span>
    </div>
  ),
}))

vi.mock('./message-composer', () => ({
  MessageComposer: () => null,
}))

vi.mock('./message-thread', () => ({
  MessageThread: ({ messages, peerReadCursor }: {
    messages: MessagingMessageDto[]
    peerReadCursor: { createdAt: string; id: string } | null
  }) => (
    <div>
      <div data-testid="message-bodies">{messages.map((message) => message.body).join('|')}</div>
      <div data-testid="peer-cursor">{peerReadCursor?.id ?? 'none'}</div>
    </div>
  ),
}))

function message(input: Partial<MessagingMessageDto> & Pick<MessagingMessageDto, 'id' | 'createdAt' | 'body'>): MessagingMessageDto {
  return {
    id: input.id,
    conversationId: CONVERSATION_ID,
    senderProfileId: input.senderProfileId ?? OTHER_ID,
    clientMessageId: input.clientMessageId ?? crypto.randomUUID(),
    body: input.body,
    createdAt: input.createdAt,
    editedAt: null,
    deletedAt: null,
  }
}

const initialMessage = message({
  id: INITIAL_ID,
  createdAt: '2026-09-13T10:00:00.000Z',
  body: 'Initial',
})

function activeConversation(messages: MessagingMessageDto[] = [initialMessage]) {
  return {
    conversationId: CONVERSATION_ID,
    otherProfileId: OTHER_ID,
    otherName: 'Capt. Anita Singh',
    otherHeadline: 'Master Mariner',
    otherAvatarUrl: null,
    otherLastReadMessageId: INITIAL_ID,
    otherLastReadAt: initialMessage.createdAt,
    messages,
    nextCursor: null,
  }
}

describe('MessageShell active realtime reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    realtime.listeners.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => cleanup())


  it('reconciles the inbox and unread count immediately when a message-created signal arrives', async () => {
    const inboxItem = {
      conversationId: CONVERSATION_ID,
      otherProfileId: OTHER_ID,
      otherName: 'Capt. Anita Singh',
      otherHeadline: 'Master Mariner',
      otherAvatarUrl: null,
      lastMessageId: INITIAL_ID,
      lastMessageBody: 'Initial',
      lastMessageSenderId: OTHER_ID,
      lastMessageAt: initialMessage.createdAt,
      otherLastReadMessageId: null,
      otherLastReadAt: null,
      unread: false,
    }
    const liveInbox = [{
      ...inboxItem,
      lastMessageId: INCOMING_ID,
      lastMessageBody: 'Incoming live',
      lastMessageAt: '2026-09-13T10:01:00.000Z',
      unread: true,
    }]
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      inbox: liveInbox,
      unreadCount: 1,
    }), { status: 200 }))

    const modulePath = './message-shell'
    const { MessageShell } = await import(modulePath) as typeof import('./message-shell')
    render(
      <MessageShell
        viewerId={VIEWER_ID}
        inbox={[inboxItem]}
        activeConversation={null}
      />,
    )

    await waitFor(() => expect(realtime.subscribe).toHaveBeenCalled())
    act(() => realtime.emit({
      eventId: 'event-inbox-message',
      eventType: 'message.created',
      schemaVersion: 1,
      occurredAt: '2026-09-13T10:01:00.100Z',
      aggregateId: INCOMING_ID,
      payload: {
        eventType: 'message.created',
        conversationId: CONVERSATION_ID,
        messageId: INCOMING_ID,
        senderId: OTHER_ID,
        recipientProfileIds: [VIEWER_ID],
      },
    }))

    await waitFor(() => expect(screen.getByTestId('inbox-last-message')).toHaveTextContent('Incoming live'))
    expect(screen.getByTestId('inbox-unread')).toHaveTextContent('unread')
    expect(unread.publishMessagingUnreadCount).toHaveBeenCalledWith(1)
    expect(fetch).toHaveBeenCalledWith('/api/realtime/messaging-state', expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
    }))
  })

  it('shows the first incoming message live when the open conversation has no canonical cursor yet', async () => {
    const incoming = message({
      id: INCOMING_ID,
      createdAt: '2026-09-13T10:01:00.000Z',
      body: 'First live incoming',
    })
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === '/api/realtime/catch-up') {
        return new Response(JSON.stringify({
          messages: [incoming],
          nextCursor: null,
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        inbox: [],
        unreadCount: 0,
      }), { status: 200 })
    })

    const modulePath = './message-shell'
    const { MessageShell } = await import(modulePath) as typeof import('./message-shell')
    render(
      <MessageShell
        viewerId={VIEWER_ID}
        inbox={[]}
        activeConversation={activeConversation([])}
      />,
    )

    await waitFor(() => expect(realtime.subscribe).toHaveBeenCalled())
    act(() => realtime.emit({
      eventId: 'event-first-message',
      eventType: 'message.created',
      schemaVersion: 1,
      occurredAt: '2026-09-13T10:01:00.100Z',
      aggregateId: INCOMING_ID,
      payload: {
        eventType: 'message.created',
        conversationId: CONVERSATION_ID,
        messageId: INCOMING_ID,
        senderId: OTHER_ID,
        recipientProfileIds: [VIEWER_ID],
      },
    }))

    await waitFor(() => expect(screen.getByTestId('message-bodies')).toHaveTextContent('First live incoming'))
  })

  it('fetches and merges canonical newer messages for the active conversation', async () => {
    const incoming = message({
      id: INCOMING_ID,
      createdAt: '2026-09-13T10:01:00.000Z',
      body: 'Incoming',
    })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      messages: [incoming],
      nextCursor: null,
    }), { status: 200 }))

    const modulePath = './message-shell'
    const { MessageShell } = await import(modulePath) as typeof import('./message-shell')
    render(
      <MessageShell
        viewerId={VIEWER_ID}
        inbox={[]}
        activeConversation={activeConversation()}
      />,
    )

    await waitFor(() => expect(realtime.subscribe).toHaveBeenCalled())
    act(() => {
      realtime.emit({
        eventId: 'event-message',
        eventType: 'message.created',
        schemaVersion: 1,
        occurredAt: '2026-09-13T10:01:00.100Z',
        aggregateId: INCOMING_ID,
        payload: {
          eventType: 'message.created',
          conversationId: CONVERSATION_ID,
          messageId: INCOMING_ID,
          senderId: OTHER_ID,
          recipientProfileIds: [VIEWER_ID],
        },
      })
    })

    await waitFor(() => expect(screen.getByTestId('message-bodies')).toHaveTextContent('Initial|Incoming'))
    expect(fetch).toHaveBeenCalledWith('/api/realtime/catch-up', expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
    }))
  })

  it('advances the local peer read cursor from realtime without allowing an older event to regress it', async () => {
    const modulePath = './message-shell'
    const { MessageShell } = await import(modulePath) as typeof import('./message-shell')
    render(
      <MessageShell
        viewerId={VIEWER_ID}
        inbox={[]}
        activeConversation={activeConversation()}
      />,
    )

    const newerReadId = '99999999-9999-4999-8999-999999999999'
    act(() => realtime.emit({
      eventId: 'event-read-new',
      eventType: 'conversation.read_cursor_advanced',
      schemaVersion: 1,
      occurredAt: '2026-09-13T10:02:00.100Z',
      aggregateId: CONVERSATION_ID,
      payload: {
        eventType: 'conversation.read_cursor_advanced',
        conversationId: CONVERSATION_ID,
        readerProfileId: OTHER_ID,
        lastReadMessageId: newerReadId,
        lastReadAt: '2026-09-13T10:02:00.000Z',
        participantProfileIds: [VIEWER_ID, OTHER_ID],
      },
    }))
    await waitFor(() => expect(screen.getByTestId('peer-cursor')).toHaveTextContent(newerReadId))

    act(() => realtime.emit({
      eventId: 'event-read-old',
      eventType: 'conversation.read_cursor_advanced',
      schemaVersion: 1,
      occurredAt: '2026-09-13T10:03:00.100Z',
      aggregateId: CONVERSATION_ID,
      payload: {
        eventType: 'conversation.read_cursor_advanced',
        conversationId: CONVERSATION_ID,
        readerProfileId: OTHER_ID,
        lastReadMessageId: INITIAL_ID,
        lastReadAt: initialMessage.createdAt,
        participantProfileIds: [VIEWER_ID, OTHER_ID],
      },
    }))
    expect(screen.getByTestId('peer-cursor')).toHaveTextContent(newerReadId)
  })

  it('merges refreshed server props so the first incoming canonical message works without an after cursor', async () => {
    const incoming = message({
      id: INCOMING_ID,
      createdAt: '2026-09-13T10:01:00.000Z',
      body: 'First incoming',
    })
    const modulePath = './message-shell'
    const { MessageShell } = await import(modulePath) as typeof import('./message-shell')
    const rendered = render(
      <MessageShell
        viewerId={VIEWER_ID}
        inbox={[]}
        activeConversation={activeConversation([])}
      />,
    )

    rendered.rerender(
      <MessageShell
        viewerId={VIEWER_ID}
        inbox={[]}
        activeConversation={activeConversation([incoming])}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('message-bodies')).toHaveTextContent('First incoming'))
    expect(fetch).not.toHaveBeenCalled()
  })
})
