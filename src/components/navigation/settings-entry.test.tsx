import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/brand/wordmark', () => ({ Wordmark: () => <div>Sea N Shore</div> }))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))
vi.mock('@/features/messaging/components/messaging-unread-badge', () => ({ MessagingUnreadBadge: () => null }))
vi.mock('@/features/notifications/components/notification-bell', () => ({ NotificationBell: () => <button type="button">Notifications</button> }))
vi.mock('./active-nav-link', () => ({
  ActiveNavLink: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}))

import { AppHeader } from './app-header'
import { MobileNav } from './mobile-nav'

afterEach(() => cleanup())

describe('Settings navigation', () => {
  it('offers Settings, Profile and Sign out from the desktop account menu for every signed-in user', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} messagingUnreadCount={0} viewer={{ name: 'Aditya Pratap Singh' }} />)

    const trigger = screen.getByRole('button', { name: 'Account menu' })
    expect(trigger).toHaveTextContent('AS')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(trigger)

    expect(screen.getByRole('menuitem', { name: /Profile/ })).toHaveAttribute('href', '/profile')
    expect(screen.getByRole('menuitem', { name: /Settings/ })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('offers Settings from the mobile More menu for every signed-in user', () => {
    render(<MobileNav />)

    fireEvent.click(screen.getByRole('button', { name: 'More' }))

    expect(screen.getByRole('menuitem', { name: /Settings/ })).toHaveAttribute('href', '/settings')
  })
})
