import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageShell } from './message-shell'

vi.mock('../actions', () => ({
  sendMessageAction: vi.fn(async () => ({ ok: false, error: 'not-used' })),
  markConversationReadAction: vi.fn(async () => ({ ok: true, advanced: true })),
}))

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'

const inbox = [
  {
    conversationId: CONVERSATION_ID,
    otherProfileId: OTHER_ID,
    otherName: 'Capt. Meera Nair',
    otherHeadline: 'Master Mariner | Tanker Operations',
    otherAvatarUrl: null,
    lastMessageId: '44444444-4444-4444-8444-444444444444',
    lastMessageBody: 'Joining instructions received.',
    lastMessageSenderId: OTHER_ID,
    lastMessageAt: '2026-09-13T02:00:00.000Z',
    unread: true,
  },
  {
    conversationId: '55555555-5555-4555-8555-555555555555',
    otherProfileId: '66666666-6666-4666-8666-666666666666',
    otherName: 'Aarav Menon',
    otherHeadline: 'Marine Superintendent',
    otherAvatarUrl: null,
    lastMessageId: null,
    lastMessageBody: null,
    lastMessageSenderId: null,
    lastMessageAt: null,
    unread: false,
  },
]

const activeConversation = {
  conversationId: CONVERSATION_ID,
  otherProfileId: OTHER_ID,
  otherName: 'Capt. Meera Nair',
  otherHeadline: 'Master Mariner | Tanker Operations',
  otherAvatarUrl: null,
  messages: [
    {
      id: '77777777-7777-4777-8777-777777777777',
      conversationId: CONVERSATION_ID,
      senderProfileId: VIEWER_ID,
      clientMessageId: '88888888-8888-4888-8888-888888888888',
      body: 'Good day, Captain.',
      createdAt: '2026-09-13T01:55:00.000Z',
      editedAt: null,
      deletedAt: null,
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      conversationId: CONVERSATION_ID,
      senderProfileId: OTHER_ID,
      clientMessageId: '99999999-9999-4999-8999-999999999999',
      body: 'Joining instructions received.',
      createdAt: '2026-09-13T02:00:00.000Z',
      editedAt: null,
      deletedAt: null,
    },
  ],
  nextCursor: null,
}

afterEach(() => cleanup())

describe('MessageShell', () => {
  it('renders a premium inbox, unread state and active professional thread', () => {
    render(
      <MessageShell
        viewerId={VIEWER_ID}
        inbox={inbox}
        activeConversation={activeConversation}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Messages' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search conversations' })).toBeInTheDocument()
    expect(screen.getByText('Capt. Meera Nair')).toBeInTheDocument()
    expect(screen.getByLabelText('Unread conversation with Capt. Meera Nair')).toBeInTheDocument()
    expect(screen.getByText('Good day, Captain.')).toBeInTheDocument()
    expect(screen.getByText('Joining instructions received.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Write a message' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument()
  })

  it('filters conversations locally without hiding the active thread', async () => {
    const user = userEvent.setup()
    render(
      <MessageShell
        viewerId={VIEWER_ID}
        inbox={inbox}
        activeConversation={activeConversation}
      />,
    )

    await user.type(screen.getByRole('searchbox', { name: 'Search conversations' }), 'superintendent')

    expect(screen.queryByRole('link', { name: /Open conversation with Capt. Meera Nair/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open conversation with Aarav Menon/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Capt. Meera Nair' })).toBeInTheDocument()
  })

  it('shows an intentional empty thread state instead of a blank second pane', () => {
    render(<MessageShell viewerId={VIEWER_ID} inbox={inbox} activeConversation={null} />)

    expect(screen.getByText('Select a conversation')).toBeInTheDocument()
    expect(screen.getByText(/Choose a maritime professional from your inbox/i)).toBeInTheDocument()
  })
})
