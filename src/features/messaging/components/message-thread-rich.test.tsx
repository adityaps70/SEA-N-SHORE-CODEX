import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessagingMessageDto } from '../queries'

const actions = vi.hoisted(() => ({
  markConversationReadAction: vi.fn(async () => ({ ok: true, advanced: true, unreadCount: 0 })),
  setMessageReactionAction: vi.fn(async () => ({ ok: true })),
  deleteMessageAction: vi.fn(async () => ({ ok: true, messageId: 'unused' })),
}))
const navigation = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('../actions', () => ({
  markConversationReadAction: actions.markConversationReadAction,
  setMessageReactionAction: actions.setMessageReactionAction,
  deleteMessageAction: actions.deleteMessageAction,
}))
vi.mock('../unread-client', () => ({
  publishMessagingUnreadCount: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}))

import { MessageThread } from './message-thread'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444'

function message(overrides: Partial<MessagingMessageDto> = {}): MessagingMessageDto {
  return {
    id: MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    senderProfileId: OTHER_ID,
    clientMessageId: '55555555-5555-4555-8555-555555555555',
    body: 'Please review this.',
    createdAt: '2026-09-20T10:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    replyTo: null,
    attachment: null,
    reactions: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})

afterEach(() => cleanup())

describe('MessageThread rich interactions', () => {
  it('lets the viewer react with a common or custom emoji and toggles their current reaction off', async () => {
    const user = userEvent.setup()
    const reacted = message({
      reactions: [
        { profileId: VIEWER_ID, emoji: '🔥' },
        { profileId: OTHER_ID, emoji: '🔥' },
      ],
    })

    render(
      <MessageThread
        viewerId={VIEWER_ID}
        conversationId={CONVERSATION_ID}
        otherName="Capt. Anita"
        otherHeadline={null}
        otherAvatarUrl={null}
        messages={[reacted]}
        nextCursor={null}
        peerReadCursor={null}
      />,
    )

    expect(screen.getByRole('button', { name: '🔥 2 reactions' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: `React to message ${MESSAGE_ID}` }))
    await user.click(screen.getByRole('button', { name: 'React with ❤️' }))
    await waitFor(() => expect(actions.setMessageReactionAction).toHaveBeenCalledWith(MESSAGE_ID, '❤️'))

    await user.click(screen.getByRole('button', { name: `React to message ${MESSAGE_ID}` }))
    const custom = screen.getByRole('textbox', { name: 'Custom emoji reaction' })
    await user.clear(custom)
    await user.type(custom, '🫡')
    await user.click(screen.getByRole('button', { name: 'Use custom emoji' }))
    await waitFor(() => expect(actions.setMessageReactionAction).toHaveBeenCalledWith(MESSAGE_ID, '🫡'))

    await user.click(screen.getByRole('button', { name: '🔥 2 reactions' }))
    await waitFor(() => expect(actions.setMessageReactionAction).toHaveBeenCalledWith(MESSAGE_ID, null))
  })

  it('exposes reply action and renders a quoted reply preview', async () => {
    const user = userEvent.setup()
    const onReply = vi.fn()
    const reply = message({
      id: '66666666-6666-4666-8666-666666666666',
      senderProfileId: VIEWER_ID,
      body: 'Acknowledged.',
      replyTo: {
        messageId: MESSAGE_ID,
        senderProfileId: OTHER_ID,
        body: 'Please review this.',
        attachmentName: null,
        deleted: false,
      },
    })

    render(
      <MessageThread
        viewerId={VIEWER_ID}
        conversationId={CONVERSATION_ID}
        otherName="Capt. Anita"
        otherHeadline={null}
        otherAvatarUrl={null}
        messages={[reply]}
        nextCursor={null}
        peerReadCursor={null}
        onReply={onReply}
      />,
    )

    expect(screen.getByText('Please review this.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reply to message/ }))
    expect(onReply).toHaveBeenCalledWith(reply)
  })

  it('renders photos and files, and only allows the sender to unsend their own message', async () => {
    const user = userEvent.setup()
    actions.deleteMessageAction.mockResolvedValueOnce({ ok: true, messageId: MESSAGE_ID })
    const mine = message({
      senderProfileId: VIEWER_ID,
      attachment: {
        name: 'bridge.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        kind: 'image',
        url: 'https://read.example.test/bridge.jpg',
      },
    })

    render(
      <MessageThread
        viewerId={VIEWER_ID}
        conversationId={CONVERSATION_ID}
        otherName="Capt. Anita"
        otherHeadline={null}
        otherAvatarUrl={null}
        messages={[mine]}
        nextCursor={null}
        peerReadCursor={null}
      />,
    )

    expect(screen.getByRole('img', { name: 'bridge.jpg' })).toHaveAttribute('src', 'https://read.example.test/bridge.jpg')
    await user.click(screen.getByRole('button', { name: `More actions for message ${MESSAGE_ID}` }))
    await user.click(screen.getByRole('button', { name: 'Unsend message' }))
    await waitFor(() => expect(actions.deleteMessageAction).toHaveBeenCalledWith(MESSAGE_ID))
    expect(navigation.refresh).toHaveBeenCalled()
  })
})
