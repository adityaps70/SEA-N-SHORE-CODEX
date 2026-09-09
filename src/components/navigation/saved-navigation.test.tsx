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

  it('centers the navigation between the logo and right-side controls', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    const primaryNav = screen.getByRole('navigation', { name: 'Primary' })
    expect(primaryNav).toHaveClass('justify-self-center')
    expect(primaryNav.parentElement).toHaveClass('grid', 'grid-cols-[auto_minmax(0,1fr)_auto]')
  })

  it('doubles the desktop search width without increasing its height', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    expect(screen.getByRole('searchbox', { name: 'Search maritime professionals' })).toHaveClass(
      'min-h-10',
      'w-64',
      '2xl:w-[22rem]',
    )
  })
})
