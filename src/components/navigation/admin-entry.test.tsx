import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/brand/wordmark', () => ({
  Wordmark: () => <div>Sea N Shore</div>,
}))
vi.mock('@/features/auth/actions', () => ({
  signOut: vi.fn(),
}))
vi.mock('@/features/messaging/components/messaging-unread-badge', () => ({
  MessagingUnreadBadge: () => null,
}))
vi.mock('@/features/notifications/components/notification-bell', () => ({
  NotificationBell: () => <button type="button">Notifications</button>,
}))
vi.mock('./active-nav-link', () => ({
  ActiveNavLink: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

import { AppHeader } from './app-header'
import { MobileAppHeader } from './mobile-app-header'

afterEach(() => cleanup())

describe('authorized admin navigation entry', () => {
  it('shows the desktop Admin entry only to administrators', () => {
    const { rerender } = render(
      <AppHeader
        recentNotifications={[]}
        unreadCount={0}
        messagingUnreadCount={0}
        canAccessAdmin={false}
      />,
    )

    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()

    rerender(
      <AppHeader
        recentNotifications={[]}
        unreadCount={0}
        messagingUnreadCount={0}
        canAccessAdmin
      />,
    )

    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin')
  })

  it('shows the mobile Admin entry only to administrators', () => {
    const { rerender } = render(
      <MobileAppHeader
        unreadCount={0}
        messagingUnreadCount={0}
        canAccessAdmin={false}
      />,
    )

    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()

    rerender(
      <MobileAppHeader
        unreadCount={0}
        messagingUnreadCount={0}
        canAccessAdmin
      />,
    )

    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin')
  })
})
