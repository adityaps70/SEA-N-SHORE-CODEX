import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MESSAGING_UNREAD_COUNT_EVENT,
  MessagingUnreadBadge,
} from './messaging-unread-badge'

afterEach(() => cleanup())

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

  it('replaces client event state when a new authoritative server count is rendered', () => {
    const { rerender } = render(
      <MessagingUnreadBadge initialCount={5} className="badge" />,
    )

    act(() => {
      window.dispatchEvent(new CustomEvent(MESSAGING_UNREAD_COUNT_EVENT, {
        detail: { count: 2 },
      }))
    })
    expect(screen.getByLabelText('2 unread messages')).toHaveTextContent('2')

    rerender(<MessagingUnreadBadge initialCount={4} className="badge" />)

    expect(screen.getByLabelText('4 unread messages')).toHaveTextContent('4')
  })
})
