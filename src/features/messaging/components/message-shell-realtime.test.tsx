import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessagingRealtimeSignal } from '@/features/realtime/client'
import type { MessagingMessageDto } from '../queries'

const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const INITIAL_ID = '44444444-4444-4444-8444-444444444444'
const INCOMING_ID = '55555555-5555-4555-8555-555555555555'

const realtime = vi.hoisted(() => ({
  listener: null as ((signal: MessagingRealtimeSignal) => void) | null,
  subscribe: vi.fn((listener: (signal: MessagingRealtimeSignal) => void) => {
    realtime.listener = listener
    return () => {
      if (realtime.listener === listener) realtime.listener = null
    }
  }),
}))

vi.mock('@/features/realtime/provider', () => ({
  useMessagingRealtime: () => ({
    status: 'connected',
    subscribe: realtime.subscribe,
  }),
}))

vi.mock('./conversation-list', () => ({
  ConversationList: () => null,
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
    realtime.listener = null
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => cleanup())

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

    await waitFor(() => expect(realtime.subscribe).toHaveBeenCalledTimes(1))
    act(() => {
      realtime.listener?.({
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
    act(() => realtime.listener?.({
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

    act(() => realtime.listener?.({
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
