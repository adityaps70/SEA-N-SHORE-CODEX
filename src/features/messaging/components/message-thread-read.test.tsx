import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessagingMessageDto } from '../queries'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const SEEN_ID = '44444444-4444-4444-8444-444444444444'
const SENT_ID = '55555555-5555-4555-8555-555555555555'
const RECEIVED_ID = '66666666-6666-4666-8666-666666666666'

const actions = vi.hoisted(() => ({
  markConversationReadAction: vi.fn(async () => ({ ok: true, advanced: true, unreadCount: 0 })),
}))
const unread = vi.hoisted(() => ({
  publishMessagingUnreadCount: vi.fn(),
}))
const navigation = vi.hoisted(() => ({
  refresh: vi.fn(),
}))

vi.mock('../actions', () => ({
  markConversationReadAction: actions.markConversationReadAction,
}))
vi.mock('../unread-client', () => ({
  publishMessagingUnreadCount: unread.publishMessagingUnreadCount,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}))

function message(input: {
  id: string
  senderProfileId: string
  createdAt: string
  body: string
}): MessagingMessageDto {
  return {
    id: input.id,
    conversationId: CONVERSATION_ID,
    senderProfileId: input.senderProfileId,
    clientMessageId: crypto.randomUUID(),
    body: input.body,
    createdAt: input.createdAt,
    editedAt: null,
    deletedAt: null,
  }
}

const messages = [
  message({
    id: SEEN_ID,
    senderProfileId: VIEWER_ID,
    createdAt: '2026-09-13T10:00:00.000Z',
    body: 'Already read by peer',
  }),
  message({
    id: SENT_ID,
    senderProfileId: VIEWER_ID,
    createdAt: '2026-09-13T10:02:00.000Z',
    body: 'Not read yet',
  }),
  message({
    id: RECEIVED_ID,
    senderProfileId: OTHER_ID,
    createdAt: '2026-09-13T10:03:00.000Z',
    body: 'Incoming message',
  }),
]

afterEach(() => cleanup())

describe('MessageThread durable Sent/Seen and active-conversation read behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  })

  it('scrolls to the latest message when a conversation opens and when newer messages arrive', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    const modulePath = './message-thread'
    const { MessageThread } = await import(modulePath) as typeof import('./message-thread')

    const rendered = render(
      <MessageThread
        viewerId={VIEWER_ID}
        conversationId={CONVERSATION_ID}
        otherName="Capt. Anita"
        otherHeadline={null}
        otherAvatarUrl={null}
        messages={messages}
        nextCursor={null}
        peerReadCursor={null}
      />,
    )

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    const callsAfterOpen = scrollIntoView.mock.calls.length

    rendered.rerender(
      <MessageThread
        viewerId={VIEWER_ID}
        conversationId={CONVERSATION_ID}
        otherName="Capt. Anita"
        otherHeadline={null}
        otherAvatarUrl={null}
        messages={[
          ...messages,
          message({
            id: '77777777-7777-4777-8777-777777777777',
            senderProfileId: OTHER_ID,
            createdAt: '2026-09-13T10:04:00.000Z',
            body: 'Newest message',
          }),
        ]}
        nextCursor={null}
        peerReadCursor={null}
      />,
    )

    await waitFor(() => expect(scrollIntoView.mock.calls.length).toBeGreaterThan(callsAfterOpen))
  })

  it('renders Sent or Seen only from the peer durable cursor and never invents Delivered', async () => {
    const modulePath = './message-thread'
    const { MessageThread } = await import(modulePath) as typeof import('./message-thread')

    render(
      <MessageThread
        viewerId={VIEWER_ID}
        conversationId={CONVERSATION_ID}
        otherName="Capt. Anita"
        otherHeadline={null}
        otherAvatarUrl={null}
        messages={messages}
        nextCursor={null}
        peerReadCursor={{
          createdAt: '2026-09-13T10:01:00.000Z',
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        }}
      />,
    )

    expect(screen.getByText('Already read by peer').parentElement?.parentElement).toHaveTextContent('Seen')
    expect(screen.getByText('Not read yet').parentElement?.parentElement).toHaveTextContent('Sent')
    expect(screen.queryByText('Delivered')).not.toBeInTheDocument()
  })

  it('marks the latest received message read as soon as the active conversation opens while visible', async () => {
    const modulePath = './message-thread'
    const { MessageThread } = await import(modulePath) as typeof import('./message-thread')

    render(
      <MessageThread
        viewerId={VIEWER_ID}
        conversationId={CONVERSATION_ID}
        otherName="Capt. Anita"
        otherHeadline={null}
        otherAvatarUrl={null}
        messages={messages}
        nextCursor={null}
        peerReadCursor={null}
      />,
    )

    await waitFor(() => expect(actions.markConversationReadAction).toHaveBeenCalledWith(
      CONVERSATION_ID,
      RECEIVED_ID,
    ))
    expect(actions.markConversationReadAction).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(unread.publishMessagingUnreadCount).toHaveBeenCalledWith(0))
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1))
  })

  it('publishes the exact remaining unread message count returned by the read action', async () => {
    actions.markConversationReadAction.mockResolvedValueOnce({
      ok: true,
      advanced: true,
      unreadCount: 6,
    })
    const modulePath = './message-thread'
    const { MessageThread } = await import(modulePath) as typeof import('./message-thread')

    render(
      <MessageThread
        viewerId={VIEWER_ID}
        conversationId={CONVERSATION_ID}
        otherName="Capt. Anita"
        otherHeadline={null}
        otherAvatarUrl={null}
        messages={messages}
        nextCursor={null}
        peerReadCursor={null}
      />,
    )

    await waitFor(() => expect(unread.publishMessagingUnreadCount).toHaveBeenCalledWith(6))
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1))
  })

  it('does not depend on document.hasFocus when the conversation is visible on mobile browsers', async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false)
    const modulePath = './message-thread'
    const { MessageThread } = await import(modulePath) as typeof import('./message-thread')

    render(
      <MessageThread
        viewerId={VIEWER_ID}
        conversationId={CONVERSATION_ID}
        otherName="Capt. Anita"
        otherHeadline={null}
        otherAvatarUrl={null}
        messages={messages}
        nextCursor={null}
        peerReadCursor={null}
      />,
    )

    await waitFor(() => expect(actions.markConversationReadAction).toHaveBeenCalledWith(
      CONVERSATION_ID,
      RECEIVED_ID,
    ))
  })
})
