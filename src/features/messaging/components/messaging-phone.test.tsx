import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessagingInboxItem, MessagingMessageDto } from '../queries'

const actions = vi.hoisted(() => ({
  markConversationReadAction: vi.fn(async () => ({ ok: true, advanced: true, unreadCount: 0 })),
  setMessageReactionAction: vi.fn(async () => ({ ok: true })),
  editMessageAction: vi.fn(async () => ({ ok: true, message: null })),
  deleteMessageAction: vi.fn(async () => ({ ok: true, messageId: 'unused' })),
  deleteConversationAction: vi.fn(),
}))
const network = vi.hoisted(() => ({
  blockProfile: vi.fn(async (): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true })),
}))
const navigation = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))

vi.mock('../actions', () => actions)
vi.mock('@/features/network/actions', () => network)
vi.mock('@/features/moderation/components/report-content-button', () => ({
  ReportContentButton: ({ targetType, targetId, label, onClose }: { targetType: string; targetId: string; label: string; onClose?: () => void }) => (
    <div role="dialog" aria-label={label} data-target-type={targetType} data-target-id={targetId}>
      <button type="button" onClick={onClose}>Close report</button>
    </div>
  ),
}))
vi.mock('../unread-client', () => ({ publishMessagingUnreadCount: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: navigation.refresh, push: navigation.push }),
  usePathname: () => '/messages',
}))

import { ConversationActionsMenu } from './conversation-actions'
import { ConversationList } from './conversation-list'
import { MessageThread } from './message-thread'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const THEIR_MESSAGE_ID = '44444444-4444-4444-8444-444444444444'
const MY_MESSAGE_ID = '66666666-6666-4666-8666-666666666666'

function message(overrides: Partial<MessagingMessageDto> = {}): MessagingMessageDto {
  return {
    id: THEIR_MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    senderProfileId: OTHER_ID,
    clientMessageId: '55555555-5555-4555-8555-555555555555',
    body: 'Are you joining the SIRE 2.0 workshop?',
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    replyTo: null,
    attachment: null,
    reactions: [],
    ...overrides,
  }
}

function mockPhone(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderThread(onReply = vi.fn()) {
  render(
    <MessageThread
      viewerId={VIEWER_ID}
      conversationId={CONVERSATION_ID}
      otherName="Rinki Mukharjee"
      otherHeadline={null}
      otherAvatarUrl={null}
      messages={[
        message(),
        message({ id: MY_MESSAGE_ID, senderProfileId: VIEWER_ID, clientMessageId: '77777777-7777-4777-8777-777777777777', body: 'Yes, registered.' }),
      ]}
      nextCursor={null}
      peerReadCursor={null}
      onReply={onReply}
      hideHeaderOnPhones
    />,
  )
  return onReply
}

describe('phone chat: long-press message sheet', () => {
  it('hides the hover action buttons and the thread header on phones and shows the long-press hint', () => {
    renderThread()
    const react = screen.getByRole('button', { name: `React to message ${THEIR_MESSAGE_ID}` })
    expect(react.closest('.max-md\\:hidden')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Back to messages' }).closest('header')).toHaveClass('max-md:hidden')
    expect(screen.getByTestId('message-long-press-hint')).toHaveTextContent('Long-press a message to react, reply, edit or unsend')
    expect(screen.getByTestId('message-long-press-hint')).toHaveClass('md:hidden')
  })

  it('opens React/Reply/Edit/Unsend for my message after a touch press-and-hold', async () => {
    renderThread()
    const bubble = screen.getByTestId(`message-bubble-${MY_MESSAGE_ID}`)
    fireEvent.pointerDown(bubble, { pointerType: 'touch', clientX: 10, clientY: 10 })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 520)) })

    const sheet = screen.getByRole('menu', { name: 'Message actions' })
    expect(within(sheet).getByRole('button', { name: 'React with 👍' })).toBeInTheDocument()
    expect(within(sheet).getByRole('menuitem', { name: 'Reply' })).toBeInTheDocument()
    expect(within(sheet).getByRole('menuitem', { name: 'Copy text' })).toBeInTheDocument()
    expect(within(sheet).getByRole('menuitem', { name: 'Edit message' })).toBeInTheDocument()
    expect(within(sheet).getByRole('menuitem', { name: 'Unsend message' })).toBeInTheDocument()

    fireEvent.click(within(sheet).getByRole('menuitem', { name: 'Unsend message' }))
    await waitFor(() => expect(actions.deleteMessageAction).toHaveBeenCalledWith(MY_MESSAGE_ID))
    expect(screen.queryByRole('menu', { name: 'Message actions' })).not.toBeInTheDocument()
  })

  it('does not open the sheet for a quick tap or a scroll gesture', async () => {
    renderThread()
    const bubble = screen.getByTestId(`message-bubble-${THEIR_MESSAGE_ID}`)
    fireEvent.pointerDown(bubble, { pointerType: 'touch', clientX: 10, clientY: 10 })
    fireEvent.pointerUp(bubble, { pointerType: 'touch' })
    fireEvent.pointerDown(bubble, { pointerType: 'touch', clientX: 10, clientY: 10 })
    fireEvent.pointerMove(bubble, { pointerType: 'touch', clientX: 10, clientY: 60 })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 520)) })
    expect(screen.queryByRole('menu', { name: 'Message actions' })).not.toBeInTheDocument()
  })

  it('reacts and replies to their message from the sheet (no Edit or Unsend on theirs)', async () => {
    mockPhone(true)
    const onReply = renderThread()
    fireEvent.contextMenu(screen.getByTestId(`message-bubble-${THEIR_MESSAGE_ID}`))

    const sheet = screen.getByRole('menu', { name: 'Message actions' })
    expect(within(sheet).queryByRole('menuitem', { name: 'Edit message' })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('menuitem', { name: 'Unsend message' })).not.toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'React with ❤️' }))
    await waitFor(() => expect(actions.setMessageReactionAction).toHaveBeenCalledWith(THEIR_MESSAGE_ID, '❤️'))

    fireEvent.contextMenu(screen.getByTestId(`message-bubble-${THEIR_MESSAGE_ID}`))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }))
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: THEIR_MESSAGE_ID }))
  })

  it('leaves the desktop right-click menu alone', () => {
    mockPhone(false)
    renderThread()
    const event = fireEvent.contextMenu(screen.getByTestId(`message-bubble-${THEIR_MESSAGE_ID}`))
    expect(event).toBe(true)
    expect(screen.queryByRole('menu', { name: 'Message actions' })).not.toBeInTheDocument()
  })

  it('offers a screen-reader button that opens the same sheet on phones', () => {
    renderThread()
    const options = screen.getByRole('button', { name: `Options for message ${MY_MESSAGE_ID}` })
    expect(options).toHaveClass('sr-only', 'md:hidden')
    fireEvent.click(options)
    expect(screen.getByRole('menuitem', { name: 'Unsend message' })).toBeInTheDocument()
  })
})

describe('phone chat "…": Report and Block', () => {
  it('adds Report and Block for the other participant alongside Delete conversation', async () => {
    const user = userEvent.setup()
    const onBlocked = vi.fn()
    render(
      <ConversationActionsMenu
        conversationId={CONVERSATION_ID}
        otherName="Rinki Mukharjee"
        onDeleted={vi.fn()}
        safety={{ otherProfileId: OTHER_ID, onBlocked }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Conversation options for Rinki Mukharjee' }))
    const menu = screen.getByRole('menu', { name: 'Conversation options for Rinki Mukharjee' })
    expect(menu.className).toContain('max-md:!fixed')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Report', 'Block', 'Delete conversation'])

    await user.click(screen.getByRole('menuitem', { name: 'Report' }))
    const report = screen.getByRole('dialog', { name: 'Report Rinki Mukharjee' })
    expect(report).toHaveAttribute('data-target-type', 'profile')
    expect(report).toHaveAttribute('data-target-id', OTHER_ID)
    await user.click(screen.getByRole('button', { name: 'Close report' }))

    await user.click(screen.getByRole('button', { name: 'Conversation options for Rinki Mukharjee' }))
    await user.click(screen.getByRole('menuitem', { name: 'Block' }))
    await waitFor(() => expect(network.blockProfile).toHaveBeenCalledWith(OTHER_ID))
    await waitFor(() => expect(onBlocked).toHaveBeenCalledTimes(1))
  })

  it('explains a failed block and stays on the conversation', async () => {
    network.blockProfile.mockResolvedValueOnce({ ok: false, error: 'This interaction is not available.' })
    const user = userEvent.setup()
    const onBlocked = vi.fn()
    render(<ConversationActionsMenu conversationId={CONVERSATION_ID} otherName="Rinki Mukharjee" onDeleted={vi.fn()} safety={{ otherProfileId: OTHER_ID, onBlocked }} />)
    await user.click(screen.getByRole('button', { name: /Conversation options/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Block' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This interaction is not available.')
    expect(onBlocked).not.toHaveBeenCalled()
  })

  it('keeps inbox rows and the desktop dock to Delete conversation only', async () => {
    const user = userEvent.setup()
    render(<ConversationActionsMenu conversationId={CONVERSATION_ID} otherName="Rinki Mukharjee" onDeleted={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Conversation options/ }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Delete conversation'])
  })
})

describe('phone inbox chips', () => {
  const inbox: MessagingInboxItem[] = [
    {
      conversationId: CONVERSATION_ID,
      otherProfileId: OTHER_ID,
      otherName: 'Rinki Mukharjee',
      otherHeadline: null,
      otherAvatarUrl: null,
      lastMessageId: THEIR_MESSAGE_ID,
      lastMessageBody: 'See you at the workshop',
      lastMessageSenderId: OTHER_ID,
      lastMessageAt: new Date().toISOString(),
      otherLastReadMessageId: null,
      otherLastReadAt: null,
      unread: true,
    },
    {
      conversationId: '88888888-8888-4888-8888-888888888888',
      otherProfileId: '99999999-9999-4999-8999-999999999999',
      otherName: 'Arjun Kapoor',
      otherHeadline: null,
      otherAvatarUrl: null,
      lastMessageId: null,
      lastMessageBody: 'Great talking to you',
      lastMessageSenderId: null,
      lastMessageAt: null,
      otherLastReadMessageId: null,
      otherLastReadAt: null,
      unread: false,
    },
  ]

  it('filters to unread conversations on phones with All · Unread chips', async () => {
    const user = userEvent.setup()
    render(<ConversationList inbox={inbox} />)
    const chips = screen.getByRole('group', { name: 'Filter conversations' })
    expect(chips).toHaveClass('md:hidden')
    expect(within(chips).getAllByRole('button').map((chip) => chip.textContent)).toEqual(['All', 'Unread'])

    await user.click(within(chips).getByRole('button', { name: 'Unread' }))
    expect(screen.getByRole('link', { name: 'Open conversation with Rinki Mukharjee' }).parentElement).not.toHaveClass('max-md:hidden')
    expect(screen.getByRole('link', { name: 'Open conversation with Arjun Kapoor' }).parentElement).toHaveClass('max-md:hidden')
  })

  it('shows an empty state when every conversation is read', async () => {
    const user = userEvent.setup()
    render(<ConversationList inbox={[inbox[1]!]} />)
    await user.click(screen.getByRole('button', { name: 'Unread' }))
    expect(screen.getByRole('status')).toHaveTextContent('You have read every conversation.')
    await user.click(screen.getByRole('button', { name: 'Show all conversations' }))
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  })
})
