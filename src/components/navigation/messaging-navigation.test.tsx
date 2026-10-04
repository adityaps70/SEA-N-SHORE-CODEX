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
        recentNotifications={[]}
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
        recentNotifications={[]}
        unreadCount={0}
        messagingUnreadCount={3}
      />,
    )

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

  it('keeps Messages in the phone top bar without capping its unread count', () => {
    render(<MobileAppHeader messagingUnreadCount={27} />)

    expect(screen.getByRole('link', { name: 'Messages' })).toHaveAttribute('href', '/messages')
    expect(screen.getByLabelText('27 unread messages')).toHaveTextContent('27')
  })

  it('updates the mobile Messages badge immediately from exact unread-count events', () => {
    render(<MobileAppHeader messagingUnreadCount={2} />)

    act(() => {
      window.dispatchEvent(new CustomEvent(MESSAGING_UNREAD_COUNT_EVENT, {
        detail: { count: 0 },
      }))
    })

    expect(screen.queryByLabelText(/unread messages/)).not.toBeInTheDocument()
  })

  it('keeps Messages out of the five phone bottom tabs (it is in the top bar)', () => {
    render(<MobileNav />)

    expect(screen.queryByRole('link', { name: 'Messages' })).not.toBeInTheDocument()
  })
})
