import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  MESSAGING_UNREAD_COUNT_EVENT,
  MessagingUnreadBadge,
} from './messaging-unread-badge'

describe('MessagingUnreadBadge', () => {
  it('renders the exact initial unread message count', () => {
    render(<MessagingUnreadBadge initialCount={27} className="badge" />)

    expect(screen.getByLabelText('27 unread messages')).toHaveTextContent('27')
  })

  it('updates immediately from an exact unread-count event and disappears at zero', () => {
    render(<MessagingUnreadBadge initialCount={3} className="badge" />)

    act(() => {
      window.dispatchEvent(new CustomEvent(MESSAGING_UNREAD_COUNT_EVENT, {
        detail: { count: 1 },
      }))
    })
    expect(screen.getByLabelText('1 unread messages')).toHaveTextContent('1')

    act(() => {
      window.dispatchEvent(new CustomEvent(MESSAGING_UNREAD_COUNT_EVENT, {
        detail: { count: 0 },
      }))
    })
    expect(screen.queryByLabelText(/unread messages/)).not.toBeInTheDocument()
  })
})
