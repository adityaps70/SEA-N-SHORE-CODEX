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
import { adminMenuLink } from './account-menu'

afterEach(() => cleanup())

describe('authorized admin navigation entry', () => {
  it('shows the desktop Admin entry inside the account menu only to administrators', () => {
    const { rerender } = render(
      <AppHeader
       
        unreadCount={0}
        messagingUnreadCount={0}
        canAccessAdmin={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.queryByRole('menuitem', { name: /Admin/ })).not.toBeInTheDocument()

    rerender(
      <AppHeader
       
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

  it('gives a country admin an Admin entry to the organization review queue, naming their countries (Round GP)', () => {
    render(<AppHeader unreadCount={0} messagingUnreadCount={0} adminCountries={['PH']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    const entry = screen.getByRole('menuitem', { name: /Admin/ })
    expect(entry).toHaveAttribute('href', '/admin/organizations?view=queue')
    expect(entry).toHaveTextContent('Organization reviews · Philippines')
  })

  it('gives a country admin the same Admin row in the phone side drawer (Round GP)', () => {
    render(<MobileAppHeader adminCountries={['PH', 'SG']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const tools = screen.getByRole('region', { name: 'Work tools' })
    expect(within(tools).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin/organizations?view=queue')
  })

  it('keeps administrators on the whole console, and names at most three countries', () => {
    expect(adminMenuLink({ canAccessAdmin: true, adminCountries: ['PH'] })).toEqual({ href: '/admin', description: 'Platform administration' })
    expect(adminMenuLink({ adminCountries: ['PH', 'SG', 'IN', 'AE'] })?.description).toBe('Organization reviews · Philippines, Singapore, India and 1 more')
    expect(adminMenuLink({ adminCountries: [] })).toBeNull()
    expect(adminMenuLink({})).toBeNull()
  })
})
