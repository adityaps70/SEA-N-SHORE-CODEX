import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessagingInboxItem } from '../queries'

vi.mock('../actions', () => ({ deleteConversationAction: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/messages',
}))

import { ConversationList } from './conversation-list'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const NOW = Date.parse('2026-10-17T12:00:00.000Z')

let sequence = 0
function item(overrides: Partial<MessagingInboxItem> = {}): MessagingInboxItem {
  sequence += 1
  const suffix = String(sequence).padStart(12, '0')
  return {
    conversationId: `33333333-3333-4333-8333-${suffix}`,
    otherProfileId: OTHER_ID,
    otherName: `Member ${sequence}`,
    otherHeadline: null,
    otherAvatarUrl: null,
    otherSlug: null,
    lastMessageId: `44444444-4444-4444-8444-${suffix}`,
    lastMessageBody: 'Crew change confirmed',
    lastMessageSenderId: OTHER_ID,
    lastMessageAt: new Date(NOW - 60 * 60_000).toISOString(),
    otherLastReadMessageId: null,
    otherLastReadAt: null,
    unread: false,
    ...overrides,
  }
}

describe('ConversationList (Round H, H2)', () => {
  beforeEach(() => {
    sequence = 0
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('previews the message alone, with “You: ” only when the viewer sent it', () => {
    render(
      <ConversationList
        viewerId={VIEWER_ID}
        inbox={[
          item({ otherName: 'Member A', lastMessageBody: 'Sharing the voyage plan', lastMessageSenderId: VIEWER_ID }),
          item({ otherName: 'Member B', lastMessageBody: 'Received, thank you', lastMessageSenderId: OTHER_ID }),
          item({ otherName: 'Member C', lastMessageBody: null, lastMessageSenderId: null, lastMessageAt: null }),
        ]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Open conversation with Member A' })).toHaveTextContent('You: Sharing the voyage plan')
    const other = screen.getByRole('link', { name: 'Open conversation with Member B' })
    expect(other).toHaveTextContent('Received, thank you')
    expect(other).not.toHaveTextContent('You:')
    expect(screen.getByRole('link', { name: 'Open conversation with Member C' })).toHaveTextContent('Start the conversation')
    expect(screen.queryByText(/Last:/)).not.toBeInTheDocument()
  })

  it('uses one date style: relative under 7 days, then “1 Oct”, with the year only for earlier years', () => {
    const ages: Array<[string, string]> = [
      ['2026-10-17T11:59:30.000Z', 'just now'],
      ['2026-10-17T11:55:00.000Z', '5m'],
      ['2026-10-17T09:00:00.000Z', '3h'],
      ['2026-10-11T12:00:00.000Z', '6d'],
      ['2026-10-10T12:00:00.000Z', '10 Oct'],
      ['2026-10-01T09:00:00.000Z', '1 Oct'],
      ['2025-12-31T23:00:00.000Z', '31 Dec 2025'],
    ]
    render(
      <ConversationList
        viewerId={VIEWER_ID}
        inbox={ages.map(([lastMessageAt], index) => item({ otherName: `Member ${index + 1}`, lastMessageAt }))}
      />,
    )

    ages.forEach(([, label], index) => {
      expect(screen.getByRole('link', { name: `Open conversation with Member ${index + 1}` })).toHaveTextContent(label)
    })
    expect(screen.queryByText('Now')).not.toBeInTheDocument()
  })
})
