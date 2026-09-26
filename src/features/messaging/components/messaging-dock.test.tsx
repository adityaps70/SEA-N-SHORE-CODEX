import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ pathname: '/home' }))
const realtime = vi.hoisted(() => {
  let listener: ((signal: unknown) => void) | null = null

  return {
    subscribe: vi.fn((next: (signal: unknown) => void) => {
      listener = next
      return () => {
        if (listener === next) listener = null
      }
    }),
    sendTyping: vi.fn(() => true),
    emit: (signal: unknown) => listener?.(signal),
    reset: () => {
      listener = null
    },
  }
})
const unread = vi.hoisted(() => ({
  publishMessagingUnreadCount: vi.fn(),
  subscribeMessagingUnreadCount: vi.fn(() => () => {}),
}))
const actions = vi.hoisted(() => ({
  sendMessageAction: vi.fn(),
  markConversationReadAction: vi.fn(async () => ({ ok: true, unreadCount: 0 })),
  createMessageAttachmentUploadAction: vi.fn(),
  discardMessageAttachmentAction: vi.fn(),
  startDirectConversationAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}))

vi.mock('@/features/realtime/provider', () => ({
  useMessagingRealtime: () => ({
    status: 'connected',
    subscribe: realtime.subscribe,
    sendTyping: realtime.sendTyping,
  }),
}))

vi.mock('../actions', () => actions)
vi.mock('../unread-client', () => unread)

import { MessagingDock, isMessagingDockHiddenPath } from './messaging-dock'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'

describe('MessagingDock', () => {
  beforeEach(() => {
    navigation.pathname = '/home'
    realtime.reset()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/realtime/messaging-state') {
        return new Response(JSON.stringify({
          unreadCount: 1,
          inbox: [{
            conversationId: CONVERSATION_ID,
            otherProfileId: OTHER_ID,
            otherName: 'Capt. Anita Singh',
            otherHeadline: 'Master Mariner',
            otherAvatarUrl: 'https://media.example.test/anita.webp',
            lastMessageId: '44444444-4444-4444-8444-444444444444',
            lastMessageBody: 'Hello',
            lastMessageSenderId: OTHER_ID,
            lastMessageAt: '2026-09-21T05:00:00.000Z',
            otherLastReadMessageId: null,
            otherLastReadAt: null,
            unread: true,
          }],
        }), { status: 200 })
      }
      if (url === `/api/messages/${CONVERSATION_ID}`) {
        return new Response(JSON.stringify({
          messages: [{
            id: '44444444-4444-4444-8444-444444444444',
            conversationId: CONVERSATION_ID,
            senderProfileId: OTHER_ID,
            clientMessageId: '55555555-5555-4555-8555-555555555555',
            body: 'Hello',
            createdAt: '2026-09-21T05:00:00.000Z',
            editedAt: null,
            deletedAt: null,
            replyTo: null,
            attachment: null,
            reactions: [],
          }],
          nextCursor: null,
        }), { status: 200 })
      }
      throw new Error(`Unexpected fetch ${url}`)
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('hides on full messaging and focused editor routes', () => {
    expect(isMessagingDockHiddenPath('/messages')).toBe(true)
    expect(isMessagingDockHiddenPath('/messages/' + CONVERSATION_ID)).toBe(true)
    expect(isMessagingDockHiddenPath('/profile/edit')).toBe(true)
    expect(isMessagingDockHiddenPath('/learn/courses/sire-20/learn')).toBe(true)
    expect(isMessagingDockHiddenPath('/home')).toBe(false)
    expect(isMessagingDockHiddenPath('/jobs')).toBe(false)
  })

  it('opens from the bottom of normal app pages and loads a compact conversation with the peer avatar', async () => {
    const user = userEvent.setup()
    render(<MessagingDock viewerId={VIEWER_ID} initialUnreadCount={1} />)

    await user.click(screen.getByRole('button', { name: 'Open messaging dock' }))
    expect(await screen.findByText('Capt. Anita Singh')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Open compact chat with Capt. Anita Singh' }))
    await waitFor(() => expect(screen.getByText('Hello')).toBeVisible())
    expect(screen.getByTestId('dock-peer-avatar')).toHaveAttribute(
      'src',
      'https://media.example.test/anita.webp',
    )
    expect(screen.getByRole('textbox', { name: 'Write a message' })).toBeInTheDocument()
  })


  it('aligns peer avatars with message bubbles and shows durable Sent/Seen status in the dock', async () => {
    const user = userEvent.setup()
    const seenId = '88888888-8888-4888-8888-888888888888'
    const sentId = '99999999-9999-4999-8999-999999999999'
    const seenAt = '2026-09-21T05:02:00.000Z'
    const sentAt = '2026-09-21T05:03:00.000Z'

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/realtime/messaging-state') {
        return new Response(JSON.stringify({
          unreadCount: 0,
          inbox: [{
            conversationId: CONVERSATION_ID,
            otherProfileId: OTHER_ID,
            otherName: 'Capt. Anita Singh',
            otherHeadline: 'Master Mariner',
            otherAvatarUrl: 'https://media.example.test/anita.webp',
            lastMessageId: sentId,
            lastMessageBody: 'Awaiting read',
            lastMessageSenderId: VIEWER_ID,
            lastMessageAt: sentAt,
            otherLastReadMessageId: seenId,
            otherLastReadAt: seenAt,
            unread: false,
          }],
        }), { status: 200 })
      }
      if (url === `/api/messages/${CONVERSATION_ID}`) {
        return new Response(JSON.stringify({
          messages: [
            {
              id: seenId,
              conversationId: CONVERSATION_ID,
              senderProfileId: VIEWER_ID,
              clientMessageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              body: 'Already seen',
              createdAt: seenAt,
              editedAt: null,
              deletedAt: null,
              replyTo: null,
              attachment: null,
              reactions: [],
            },
            {
              id: sentId,
              conversationId: CONVERSATION_ID,
              senderProfileId: VIEWER_ID,
              clientMessageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              body: 'Awaiting read',
              createdAt: sentAt,
              editedAt: null,
              deletedAt: null,
              replyTo: null,
              attachment: null,
              reactions: [],
            },
            {
              id: 'aaaaaaaa-1111-4111-8111-111111111111',
              conversationId: CONVERSATION_ID,
              senderProfileId: OTHER_ID,
              clientMessageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              body: 'Peer message',
              createdAt: '2026-09-21T05:04:00.000Z',
              editedAt: null,
              deletedAt: null,
              replyTo: null,
              attachment: null,
              reactions: [],
            },
          ],
          nextCursor: null,
        }), { status: 200 })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })

    render(<MessagingDock viewerId={VIEWER_ID} initialUnreadCount={0} />)
    await user.click(screen.getByRole('button', { name: 'Open messaging dock' }))
    await user.click(await screen.findByRole('button', { name: 'Open compact chat with Capt. Anita Singh' }))

    expect(await screen.findByText('Already seen')).toBeVisible()
    expect(screen.getByText('Already seen').parentElement?.parentElement).toHaveTextContent('Seen')
    expect(screen.getByText('Awaiting read').parentElement?.parentElement).toHaveTextContent('Sent')

    const avatar = screen.getByTestId('dock-message-avatar-aaaaaaaa-1111-4111-8111-111111111111')
    expect(avatar.parentElement).toHaveClass('mb-4')

    act(() => {
      realtime.emit({
        eventType: 'conversation.read_cursor_advanced',
        payload: {
          conversationId: CONVERSATION_ID,
          readerProfileId: OTHER_ID,
          lastReadMessageId: sentId,
          lastReadAt: sentAt,
          participantProfileIds: [VIEWER_ID, OTHER_ID],
        },
      })
    })

    await waitFor(() => expect(screen.getByText('Awaiting read').parentElement?.parentElement).toHaveTextContent('Seen'))
  })

  it('publishes the exact remaining unread count as soon as a compact conversation is opened', async () => {
    const user = userEvent.setup()
    render(<MessagingDock viewerId={VIEWER_ID} initialUnreadCount={1} />)

    await user.click(screen.getByRole('button', { name: 'Open messaging dock' }))
    await user.click(await screen.findByRole('button', { name: 'Open compact chat with Capt. Anita Singh' }))

    await waitFor(() => expect(actions.markConversationReadAction).toHaveBeenCalledWith(
      CONVERSATION_ID,
      '44444444-4444-4444-8444-444444444444',
    ))
    await waitFor(() => expect(unread.publishMessagingUnreadCount).toHaveBeenCalledWith(0))
  })

  it('marks a new incoming message read immediately when that compact chat is already open', async () => {
    const user = userEvent.setup()
    const initialId = '44444444-4444-4444-8444-444444444444'
    const incomingId = '66666666-6666-4666-8666-666666666666'
    let threadLoads = 0

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/realtime/messaging-state') {
        return new Response(JSON.stringify({
          unreadCount: 1,
          inbox: [{
            conversationId: CONVERSATION_ID,
            otherProfileId: OTHER_ID,
            otherName: 'Capt. Anita Singh',
            otherHeadline: 'Master Mariner',
            otherAvatarUrl: 'https://media.example.test/anita.webp',
            lastMessageId: initialId,
            lastMessageBody: 'Hello',
            lastMessageSenderId: OTHER_ID,
            lastMessageAt: '2026-09-21T05:00:00.000Z',
            otherLastReadMessageId: null,
            otherLastReadAt: null,
            unread: true,
          }],
        }), { status: 200 })
      }

      if (url === `/api/messages/${CONVERSATION_ID}`) {
        threadLoads += 1
        const messages = [{
          id: initialId,
          conversationId: CONVERSATION_ID,
          senderProfileId: OTHER_ID,
          clientMessageId: '55555555-5555-4555-8555-555555555555',
          body: 'Hello',
          createdAt: '2026-09-21T05:00:00.000Z',
          editedAt: null,
          deletedAt: null,
          replyTo: null,
          attachment: null,
          reactions: [],
        }]

        if (threadLoads > 1) {
          messages.push({
            id: incomingId,
            conversationId: CONVERSATION_ID,
            senderProfileId: OTHER_ID,
            clientMessageId: '77777777-7777-4777-8777-777777777777',
            body: 'Incoming while open',
            createdAt: '2026-09-21T05:01:00.000Z',
            editedAt: null,
            deletedAt: null,
            replyTo: null,
            attachment: null,
            reactions: [],
          })
        }

        return new Response(JSON.stringify({ messages, nextCursor: null }), { status: 200 })
      }

      throw new Error(`Unexpected fetch ${url}`)
    })

    render(<MessagingDock viewerId={VIEWER_ID} initialUnreadCount={1} />)
    await user.click(screen.getByRole('button', { name: 'Open messaging dock' }))
    await user.click(await screen.findByRole('button', { name: 'Open compact chat with Capt. Anita Singh' }))
    await waitFor(() => expect(actions.markConversationReadAction).toHaveBeenCalledWith(CONVERSATION_ID, initialId))

    actions.markConversationReadAction.mockClear()
    unread.publishMessagingUnreadCount.mockClear()

    act(() => {
      realtime.emit({
        eventType: 'message.created',
        payload: {
          conversationId: CONVERSATION_ID,
          messageId: incomingId,
          senderId: OTHER_ID,
          recipientProfileIds: [VIEWER_ID],
        },
      })
    })

    expect(await screen.findByText('Incoming while open')).toBeVisible()
    await waitFor(() => expect(actions.markConversationReadAction).toHaveBeenCalledWith(
      CONVERSATION_ID,
      incomingId,
    ))
    await waitFor(() => expect(unread.publishMessagingUnreadCount).toHaveBeenCalledWith(0))
  })

  it('starts a new conversation from the dock and opens it in place', async () => {
    const user = userEvent.setup()
    const newPeerId = '77777777-7777-4777-8777-777777777777'
    const newConversationId = '88888888-8888-4888-8888-888888888888'
    actions.startDirectConversationAction.mockResolvedValueOnce({ ok: true, conversationId: newConversationId })
    const baseFetch = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/messages/recipients')) {
        return new Response(JSON.stringify({
          query: '',
          connectionCount: 2,
          recipients: [{
            profileId: newPeerId,
            name: 'Chief Engineer Ravi Kumar',
            subtitle: 'Chief Engineer',
            slug: 'ravi-kumar',
            avatarUrl: null,
            conversationId: null,
            status: 'available',
            unavailableReason: null,
          }],
        }), { status: 200 })
      }
      if (url === `/api/messages/${newConversationId}`) {
        return new Response(JSON.stringify({ messages: [], nextCursor: null }), { status: 200 })
      }
      return baseFetch(input, init)
    })

    render(<MessagingDock viewerId={VIEWER_ID} initialUnreadCount={0} newMessageDebounceMs={0} />)
    await user.click(screen.getByRole('button', { name: 'Open messaging dock' }))
    await user.click(await screen.findByRole('button', { name: 'New message' }))
    await user.click(await screen.findByRole('option', { name: /Chief Engineer Ravi Kumar/ }))

    await waitFor(() => expect(actions.startDirectConversationAction).toHaveBeenCalledWith(newPeerId))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const dock = screen.getByRole('region', { name: 'Messaging dock' })
    expect(within(dock).getByText('Chief Engineer Ravi Kumar')).toBeInTheDocument()
    expect(within(dock).getByRole('link', { name: 'Open full conversation' }))
      .toHaveAttribute('href', `/messages/${newConversationId}`)
    expect(within(dock).getByRole('textbox', { name: 'Write a message' })).toBeInTheDocument()
  })

  it('opens a photo in an overlay over the dock instead of a new browser page', async () => {
    const user = userEvent.setup()
    const photoId = '99999999-9999-4999-8999-999999999999'
    const baseFetch = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === `/api/messages/${CONVERSATION_ID}`) {
        return new Response(JSON.stringify({
          messages: [{
            id: photoId,
            conversationId: CONVERSATION_ID,
            senderProfileId: OTHER_ID,
            clientMessageId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            body: 'Deck photo',
            createdAt: '2026-09-21T05:00:00.000Z',
            editedAt: null,
            deletedAt: null,
            replyTo: null,
            attachment: {
              name: 'deck.jpg',
              mimeType: 'image/jpeg',
              size: 2048,
              kind: 'image',
              url: `/api/messages/attachments/${photoId}`,
            },
            reactions: [],
          }],
          nextCursor: null,
        }), { status: 200 })
      }
      return baseFetch(input, init)
    })

    render(<MessagingDock viewerId={VIEWER_ID} initialUnreadCount={1} />)
    await user.click(screen.getByRole('button', { name: 'Open messaging dock' }))
    await user.click(await screen.findByRole('button', { name: 'Open compact chat with Capt. Anita Singh' }))
    const thumbnail = await screen.findByRole('button', { name: 'Open photo deck.jpg' })
    expect(thumbnail.closest('a')).toBeNull()

    await user.click(thumbnail)
    const viewer = screen.getByRole('dialog', { name: /deck\.jpg/ })
    expect(within(viewer).getByRole('img', { name: 'deck.jpg' })).toHaveAttribute('src', `/api/messages/attachments/${photoId}`)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(thumbnail).toHaveFocus()
    // Still in the same compact conversation.
    expect(screen.getByText('Deck photo')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Write a message' })).toBeInTheDocument()
  })
})
