import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessagingMessageDto } from '../queries'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const RECRUITER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'

vi.mock('../actions', () => ({ markConversationReadAction: vi.fn(async () => ({ ok: true, advanced: true, unreadCount: 0 })) }))
vi.mock('../unread-client', () => ({ publishMessagingUnreadCount: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { MessageThread } from './message-thread'

function message(id: string, senderProfileId: string, minute: number, body: string): MessagingMessageDto {
  return {
    id, conversationId: CONVERSATION_ID, senderProfileId, clientMessageId: `client-${id}`, body,
    createdAt: `2026-10-19T10:0${minute}:00.000Z`, editedAt: null, deletedAt: null,
  }
}

const messages = [
  message('m1', RECRUITER_ID, 1, 'Placeholder first note from the recruiter'),
  message('m2', VIEWER_ID, 2, 'Placeholder reply'),
  message('m3', RECRUITER_ID, 3, 'Placeholder second note'),
]
const recruiterContact = { recruiterProfileId: RECRUITER_ID, line: 'Sent because you applied to Placeholder Chief Officer' }

function renderThread(props: Partial<Parameters<typeof MessageThread>[0]> = {}) {
  return render(
    <MessageThread
      viewerId={VIEWER_ID}
      conversationId={CONVERSATION_ID}
      otherName="Placeholder Recruiter"
      otherHeadline={null}
      otherAvatarUrl={null}
      messages={messages}
      nextCursor={null}
      peerReadCursor={null}
      {...props}
    />,
  )
}

afterEach(() => cleanup())

// Recruiter messaging exception (Oct 2026): the reason line sits above the recruiter's first message only.
describe('MessageThread: recruiter reason line', () => {
  it('shows the line once, directly above the recruiter\'s first message', () => {
    renderThread({ recruiterContact })
    const lines = screen.getAllByTestId('recruiter-contact-line')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toHaveTextContent('Sent because you applied to Placeholder Chief Officer')
    const firstNote = screen.getByText('Placeholder first note from the recruiter')
    expect(lines[0]!.compareDocumentPosition(firstNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(lines[0]!.compareDocumentPosition(screen.getByText('Placeholder reply')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows nothing in other conversations, or while older messages (the start) are not loaded', () => {
    renderThread()
    expect(screen.queryByTestId('recruiter-contact-line')).not.toBeInTheDocument()
    cleanup()
    renderThread({ recruiterContact, nextCursor: { createdAt: '2026-10-19T09:00:00.000Z', id: 'older' } })
    expect(screen.queryByTestId('recruiter-contact-line')).not.toBeInTheDocument()
  })
})
