import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getConversationInbox: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/messaging/queries', () => ({
  getConversationInbox: mocks.getConversationInbox,
}))
vi.mock('@/features/messaging/components/message-shell', () => ({
  MessageShell: ({ viewerId, inbox, activeConversation }: {
    viewerId: string
    inbox: Array<{ otherName: string | null }>
    activeConversation: unknown
  }) => (
    <div>
      <span>Messaging shell</span>
      <span>{viewerId}</span>
      <span>{inbox[0]?.otherName}</span>
      <span>{activeConversation === null ? 'No active conversation' : 'Active conversation'}</span>
    </div>
  ),
}))

import MessagesPage from './page'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: VIEWER_ID, email: 'viewer@example.com' })
  mocks.getConversationInbox.mockResolvedValue([{
    conversationId: '33333333-3333-4333-8333-333333333333',
    otherProfileId: '22222222-2222-4222-8222-222222222222',
    otherName: 'Capt. Meera Nair',
    otherHeadline: 'Master Mariner',
    otherAvatarUrl: null,
    lastMessageId: null,
    lastMessageBody: null,
    lastMessageSenderId: null,
    lastMessageAt: null,
    unread: false,
  }])
})

afterEach(() => cleanup())

describe('Messages page', () => {
  it('loads the authenticated inbox into the messaging shell without selecting a thread', async () => {
    render(await MessagesPage())

    expect(screen.getByText('Messaging shell')).toBeInTheDocument()
    expect(screen.getByText(VIEWER_ID)).toBeInTheDocument()
    expect(screen.getByText('Capt. Meera Nair')).toBeInTheDocument()
    expect(screen.getByText('No active conversation')).toBeInTheDocument()
    expect(mocks.getConversationInbox).toHaveBeenCalledWith({ limit: 100 })
  })
})
