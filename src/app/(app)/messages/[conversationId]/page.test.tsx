import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getConversationInbox: vi.fn(),
  getConversationThread: vi.fn(),
  getUnreadMessageCount: vi.fn(),
  markConversationRead: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/messaging/queries', () => ({
  getConversationInbox: mocks.getConversationInbox,
  getConversationThread: mocks.getConversationThread,
  getUnreadMessageCount: mocks.getUnreadMessageCount,
}))
vi.mock('@/features/messaging/service', () => ({
  createProductionMessagingService: () => ({
    markConversationRead: mocks.markConversationRead,
  }),
}))
vi.mock('@/features/messaging/components/message-shell', () => ({
  MessageShell: ({ activeConversation, authoritativeUnreadCount }: {
    activeConversation: null | {
      otherName: string | null
      messages: Array<{ body: string }>
    }
    authoritativeUnreadCount?: number
  }) => (
    <div>
      <span>Messaging shell</span>
      <span>{activeConversation?.otherName}</span>
      <span>{activeConversation?.messages[0]?.body}</span>
      <span data-testid="authoritative-unread-count">{authoritativeUnreadCount ?? 'unset'}</span>
    </div>
  ),
}))

import MessageConversationPage from './page'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: VIEWER_ID, email: 'viewer@example.com' })
  mocks.getConversationInbox.mockResolvedValue([{
    conversationId: CONVERSATION_ID,
    otherProfileId: OTHER_ID,
    otherName: 'Capt. Meera Nair',
    otherHeadline: 'Master Mariner',
    otherAvatarUrl: null,
    lastMessageId: '44444444-4444-4444-8444-444444444444',
    lastMessageBody: 'Good day.',
    lastMessageSenderId: OTHER_ID,
    lastMessageAt: '2026-09-13T02:00:00.000Z',
    unread: true,
  }])
  mocks.getConversationThread.mockResolvedValue({
    messages: [{
      id: '44444444-4444-4444-8444-444444444444',
      conversationId: CONVERSATION_ID,
      senderProfileId: OTHER_ID,
      clientMessageId: '55555555-5555-4555-8555-555555555555',
      body: 'Good day.',
      createdAt: '2026-09-13T02:00:00.000Z',
      editedAt: null,
      deletedAt: null,
    }],
    nextCursor: null,
  })
  mocks.markConversationRead.mockResolvedValue(true)
  mocks.getUnreadMessageCount.mockResolvedValue(0)
})

afterEach(() => cleanup())

describe('Message conversation page', () => {
  it('loads an authorized thread with professional peer context', async () => {
    render(await MessageConversationPage({
      params: Promise.resolve({ conversationId: CONVERSATION_ID }),
    }))

    expect(screen.getByText('Messaging shell')).toBeInTheDocument()
    expect(screen.getByText('Capt. Meera Nair')).toBeInTheDocument()
    expect(screen.getByText('Good day.')).toBeInTheDocument()
    expect(mocks.getConversationInbox).toHaveBeenCalledWith({ limit: 100 })
    expect(mocks.getConversationThread).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      limit: 50,
    })
    expect(mocks.markConversationRead).toHaveBeenCalledWith(
      VIEWER_ID,
      CONVERSATION_ID,
      '44444444-4444-4444-8444-444444444444',
    )
    expect(mocks.markConversationRead.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getConversationInbox.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    )
    expect(mocks.getUnreadMessageCount).toHaveBeenCalledTimes(1)
    expect(mocks.markConversationRead.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getUnreadMessageCount.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    )
    expect(screen.getByTestId('authoritative-unread-count')).toHaveTextContent('0')
  })

  it('advances the cursor to the latest visible message even when the viewer sent it, clearing older incoming unread messages', async () => {
    const latestOwnMessageId = '66666666-6666-4666-8666-666666666666'
    mocks.getConversationThread.mockResolvedValueOnce({
      messages: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          conversationId: CONVERSATION_ID,
          senderProfileId: OTHER_ID,
          clientMessageId: '55555555-5555-4555-8555-555555555555',
          body: 'Incoming before my reply.',
          createdAt: '2026-09-13T02:00:00.000Z',
          editedAt: null,
          deletedAt: null,
        },
        {
          id: latestOwnMessageId,
          conversationId: CONVERSATION_ID,
          senderProfileId: VIEWER_ID,
          clientMessageId: '77777777-7777-4777-8777-777777777777',
          body: 'My reply.',
          createdAt: '2026-09-13T02:05:00.000Z',
          editedAt: null,
          deletedAt: null,
        },
      ],
      nextCursor: null,
    })

    render(await MessageConversationPage({
      params: Promise.resolve({ conversationId: CONVERSATION_ID }),
    }))

    expect(mocks.markConversationRead).toHaveBeenCalledWith(
      VIEWER_ID,
      CONVERSATION_ID,
      latestOwnMessageId,
    )
  })

  it('returns not found for a conversation the viewer cannot access', async () => {
    mocks.getConversationThread.mockRejectedValueOnce(new Error('messaging_not_participant'))

    await expect(MessageConversationPage({
      params: Promise.resolve({ conversationId: CONVERSATION_ID }),
    })).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })
})
