import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppHeader } from './app-header'
import { MobileAppHeader } from './mobile-app-header'
import { MobileNav } from './mobile-nav'

vi.mock('@/features/notifications/components/notification-bell', () => ({
  NotificationBell: () => <span>Notifications</span>,
}))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))

afterEach(() => cleanup())

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

  it('adds Messages to the mobile header without capping its unread count', () => {
    render(<MobileAppHeader unreadCount={0} messagingUnreadCount={27} />)

    expect(screen.getByRole('link', { name: 'Messages' })).toHaveAttribute('href', '/messages')
    expect(screen.getByLabelText('27 unread messages')).toHaveTextContent('27')
  })

  it('does not squeeze Messages into the existing eight-item mobile bottom navigation', () => {
    render(<MobileNav />)

    expect(screen.queryByRole('link', { name: 'Messages' })).not.toBeInTheDocument()
  })
})
