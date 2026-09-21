import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ pathname: '/home' }))
const realtime = vi.hoisted(() => ({
  subscribe: vi.fn(() => () => {}),
  sendTyping: vi.fn(() => true),
}))
const actions = vi.hoisted(() => ({
  sendMessageAction: vi.fn(),
  markConversationReadAction: vi.fn(async () => ({ ok: true, unreadCount: 0 })),
  createMessageAttachmentUploadAction: vi.fn(),
  discardMessageAttachmentAction: vi.fn(),
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

import { MessagingDock, isMessagingDockHiddenPath } from './messaging-dock'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'

describe('MessagingDock', () => {
  beforeEach(() => {
    navigation.pathname = '/home'
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
})
