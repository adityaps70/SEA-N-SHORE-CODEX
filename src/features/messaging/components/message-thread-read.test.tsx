import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessagingMessageDto } from '../queries'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const SEEN_ID = '44444444-4444-4444-8444-444444444444'
const SENT_ID = '55555555-5555-4555-8555-555555555555'
const RECEIVED_ID = '66666666-6666-4666-8666-666666666666'

const actions = vi.hoisted(() => ({
  markConversationReadAction: vi.fn(async () => ({ ok: true, advanced: true })),
}))

vi.mock('../actions', () => ({
  markConversationReadAction: actions.markConversationReadAction,
}))

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []

  readonly callback: ObserverCallback
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()
  readonly unobserve = vi.fn()
  readonly takeRecords = vi.fn(() => [])
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0.9]

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback as ObserverCallback
    FakeIntersectionObserver.instances.push(this)
  }

  trigger(isIntersecting: boolean) {
    const target = this.observe.mock.calls[0]?.[0] as Element | undefined
    if (!target) throw new Error('observer target missing')
    this.callback([{
      isIntersecting,
      target,
      intersectionRatio: isIntersecting ? 1 : 0,
    } as IntersectionObserverEntry])
  }
}

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

describe('MessageThread durable Sent/Seen and actual-view read behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    FakeIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
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

  it('does not mark read on mount or while scrolled up, then advances only when the bottom is actually visible and focused', async () => {
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

    await waitFor(() => expect(FakeIntersectionObserver.instances).toHaveLength(1))
    expect(actions.markConversationReadAction).not.toHaveBeenCalled()

    act(() => FakeIntersectionObserver.instances[0]?.trigger(false))
    expect(actions.markConversationReadAction).not.toHaveBeenCalled()

    act(() => FakeIntersectionObserver.instances[0]?.trigger(true))
    await waitFor(() => expect(actions.markConversationReadAction).toHaveBeenCalledWith(
      CONVERSATION_ID,
      RECEIVED_ID,
    ))
    expect(actions.markConversationReadAction).toHaveBeenCalledTimes(1)

    act(() => FakeIntersectionObserver.instances[0]?.trigger(true))
    expect(actions.markConversationReadAction).toHaveBeenCalledTimes(1)
  })

  it('waits for focus before marking a visible bottom message as read', async () => {
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

    await waitFor(() => expect(FakeIntersectionObserver.instances).toHaveLength(1))
    act(() => FakeIntersectionObserver.instances[0]?.trigger(true))
    expect(actions.markConversationReadAction).not.toHaveBeenCalled()

    vi.mocked(document.hasFocus).mockReturnValue(true)
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(actions.markConversationReadAction).toHaveBeenCalledWith(
      CONVERSATION_ID,
      RECEIVED_ID,
    ))
  })
})
