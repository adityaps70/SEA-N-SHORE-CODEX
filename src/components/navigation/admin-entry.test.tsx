import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
import { MobileNav } from './mobile-nav'

afterEach(() => cleanup())

describe('authorized admin navigation entry', () => {
  it('shows the desktop Admin entry inside the account menu only to administrators', () => {
    const { rerender } = render(
      <AppHeader
        recentNotifications={[]}
        unreadCount={0}
        messagingUnreadCount={0}
        canAccessAdmin={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.queryByRole('menuitem', { name: /Admin/ })).not.toBeInTheDocument()

    rerender(
      <AppHeader
        recentNotifications={[]}
        unreadCount={0}
        messagingUnreadCount={0}
        canAccessAdmin
      />,
    )

    expect(screen.getByRole('menuitem', { name: /Admin/ })).toHaveAttribute('href', '/admin')
  })

  it('shows Admin under Work tools in the phone side drawer only to administrators', () => {
    const { rerender } = render(<MobileAppHeader canAccessAdmin={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()

    rerender(<MobileAppHeader canAccessAdmin />)

    const tools = screen.getByRole('region', { name: 'Work tools' })
    expect(within(tools).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin')
  })

  it('never lists Admin as a primary destination', () => {
    render(
      <AppHeader
        recentNotifications={[]}
        unreadCount={0}
        messagingUnreadCount={0}
        canAccessAdmin
      />,
    )

    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
    cleanup()
    render(<MobileNav />)
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
  })
})
