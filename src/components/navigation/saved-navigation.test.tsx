import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppHeader } from './app-header'
import { MobileAppHeader } from './mobile-app-header'

vi.mock('@/features/notifications/components/notification-bell', () => ({
  NotificationBell: () => <span>Notifications</span>,
}))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))

describe('saved posts navigation', () => {
  it('exposes Saved posts from the desktop application header', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    expect(screen.getByRole('link', { name: 'Saved' })).toHaveAttribute('href', '/saved')
  })

  it('exposes Saved posts from the mobile application header without expanding the bottom navigation', () => {
    render(<MobileAppHeader unreadCount={0} />)

    expect(screen.getByRole('link', { name: 'Saved posts' })).toHaveAttribute('href', '/saved')
  })
})
