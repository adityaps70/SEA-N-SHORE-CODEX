import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppHeader } from './app-header'
import { MobileAppHeader } from './mobile-app-header'

vi.mock('@/features/notifications/components/notification-bell', () => ({
  NotificationBell: () => <span>Notifications</span>,
}))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))

afterEach(() => cleanup())

describe('saved posts navigation', () => {
  it('keeps Saved out of the desktop application header', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    expect(screen.queryByRole('link', { name: 'Saved' })).not.toBeInTheDocument()
  })

  it('exposes Saved posts from the mobile application header without expanding the bottom navigation', () => {
    render(<MobileAppHeader unreadCount={0} />)

    expect(screen.getByRole('link', { name: 'Saved posts' })).toHaveAttribute('href', '/saved')
  })

  it('pins the desktop header to the top of the viewport', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    expect(screen.getByRole('banner')).toHaveClass('fixed', 'top-0', 'z-50')
  })
})
