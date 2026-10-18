import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MESSAGING_UNREAD_COUNT_EVENT, resetMessagingUnreadCountSnapshotForTests } from '@/features/messaging/unread-client'
import { AppHeader } from './app-header'
import { MobileAppHeader } from './mobile-app-header'
import { MobileNav } from './mobile-nav'

vi.mock('@/features/notifications/components/notification-bell', () => ({
  NotificationBell: () => <span>Notifications</span>,
}))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))

afterEach(() => {
  cleanup()
  resetMessagingUnreadCountSnapshotForTests()
})

describe('messaging navigation', () => {
  it('adds Messages to the desktop primary navigation with the exact unread count', () => {
    render(
      <AppHeader
       
        unreadCount={0}
        messagingUnreadCount={27}
      />,
    )

    expect(screen.getByRole('link', { name: 'Messages' })).toHaveAttribute('href', '/messages')
    expect(screen.getByLabelText('27 unread messages')).toHaveTextContent('27')
  })

  it('updates the desktop Messages badge immediately from exact unread-count events', () => {
    render(
      <AppHeader
       
        unreadCount={0}
        messagingUnreadCount={3}
      />,
    )

    act(() => {
      window.dispatchEvent(new CustomEvent(MESSAGING_UNREAD_COUNT_EVENT, {
        detail: { count: 1 },
      }))
    })

    expect(screen.getByLabelText('1 unread message')).toHaveTextContent('1')

    act(() => {
      window.dispatchEvent(new CustomEvent(MESSAGING_UNREAD_COUNT_EVENT, {
        detail: { count: 0 },
      }))
    })

    expect(screen.queryByLabelText(/unread messages/)).not.toBeInTheDocument()
  })

  // Round H (H7): Messages moved from the phone top bar to the bottom tabs (the bell took its place).
  it('keeps Messages in the phone bottom tabs without capping its unread count', () => {
    render(<MobileNav messagingUnreadCount={27} />)

    expect(screen.getByRole('link', { name: 'Messages' })).toHaveAttribute('href', '/messages')
    expect(screen.getByLabelText('27 unread messages')).toHaveTextContent('27')
  })

  it('updates the mobile Messages badge immediately from exact unread-count events', () => {
    render(<MobileNav messagingUnreadCount={2} />)

    act(() => {
      window.dispatchEvent(new CustomEvent(MESSAGING_UNREAD_COUNT_EVENT, {
        detail: { count: 0 },
      }))
    })

    expect(screen.queryByLabelText(/unread messages/)).not.toBeInTheDocument()
  })

  it('keeps Messages out of the phone top bar (it is a bottom tab), so it is never shown twice', () => {
    render(<MobileAppHeader />)

    expect(screen.queryByRole('link', { name: 'Messages' })).not.toBeInTheDocument()
  })
})
