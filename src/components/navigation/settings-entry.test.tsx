import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/brand/wordmark', () => ({ Wordmark: () => <div>Sea N Shore</div> }))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))
vi.mock('@/features/messaging/components/messaging-unread-badge', () => ({ MessagingUnreadBadge: () => null }))
vi.mock('@/features/notifications/components/notification-bell', () => ({ NotificationBell: () => <button type="button">Notifications</button> }))
vi.mock('./active-nav-link', () => ({
  ActiveNavLink: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}))

import { AppHeader } from './app-header'
import { MobileAppHeader } from './mobile-app-header'

afterEach(() => cleanup())

describe('Settings navigation', () => {
  it('offers a clear desktop Settings entry for every signed-in user', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} messagingUnreadCount={0} />)
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })

  it('offers a clear mobile Settings entry for every signed-in user', () => {
    render(<MobileAppHeader unreadCount={0} messagingUnreadCount={0} />)
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })
})
