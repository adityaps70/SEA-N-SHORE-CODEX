import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppHeader } from './app-header'
import { MobileAppHeader } from './mobile-app-header'
import { MobileNav } from './mobile-nav'

vi.mock('@/features/notifications/components/notification-bell', () => ({
  NotificationBell: () => <span>Notifications</span>,
}))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))

afterEach(() => cleanup())

describe('primary navigation layout', () => {
  it('shows seven desktop destinations with Community in place of the old More menu', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    const primaryNav = screen.getByRole('navigation', { name: 'Primary' })
    const links = primaryNav.querySelectorAll('a')
    expect(Array.from(links).map((link) => link.getAttribute('href'))).toEqual([
      '/home', '/network', '/jobs', '/messages', '/learn', '/events', '/community',
    ])
    expect(screen.getByRole('link', { name: 'Community' })).toHaveAttribute('href', '/community')
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Saved/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My Activities' })).not.toBeInTheDocument()
  })

  it('keeps My Activities and Saved posts out of the account menu (they live in Settings and on Home)', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))

    expect(screen.queryByRole('menuitem', { name: /My Activities/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Saved posts/ })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Organizations/ })).toHaveAttribute('href', '/organizations')
  })

  it('turns Create into a menu of the four things a member can publish', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('menuitem', { name: /Post a job/ })).toHaveAttribute('href', '/hiring/jobs/new')
    expect(screen.getByRole('menuitem', { name: /Create an event/ })).toHaveAttribute('href', '/events/create')
    expect(screen.getByRole('menuitem', { name: /Create a course/ })).toHaveAttribute('href', '/learn/studio/courses/new')
    expect(screen.getByRole('menuitem', { name: /All creator tools/ })).toHaveAttribute('href', '/creator')
    // Posting an update happens in the Home composer, not from the Create menu.
    expect(screen.queryByRole('menuitem', { name: /Post an update/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('href'))).toEqual([
      '/hiring/jobs/new',
      '/events/create',
      '/learn/studio/courses/new',
      '/creator',
    ])
  })

  it('pins the desktop header to the top of the viewport and centres the navigation', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    expect(screen.getByRole('banner')).toHaveClass('fixed', 'top-0', 'z-50')
    const primaryNav = screen.getByRole('navigation', { name: 'Primary' })
    expect(primaryNav).toHaveClass('justify-self-center', 'min-w-0')
    expect(primaryNav.parentElement).toHaveClass('grid', 'grid-cols-[auto_minmax(0,1fr)_auto]')
  })

  it('keeps the desktop search narrow enough to never clip the navigation', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    expect(screen.getByRole('searchbox', { name: 'Search Sea N Shore' })).toHaveClass('min-h-10', 'w-44', 'xl:w-56', '2xl:w-[22rem]')
  })

  it('uses a five-link mobile bottom bar with Community and an opaque background', () => {
    render(<MobileNav />)

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(nav).toHaveClass('grid-cols-5', 'bg-white')
    expect(nav).not.toHaveClass('bg-white/95')
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/home', '/network', '/jobs', '/learn', '/community',
    ])
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
  })

  it('moves Events and Organizations into the phone account menu', () => {
    render(<MobileAppHeader unreadCount={0} />)

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByRole('menuitem', { name: /Profile/ })).toHaveAttribute('href', '/profile')
    expect(screen.getByRole('menuitem', { name: /Events/ })).toHaveAttribute('href', '/events')
    expect(screen.getByRole('menuitem', { name: /^Organizations/ })).toHaveAttribute('href', '/organizations')
    expect(screen.getByRole('menuitem', { name: /Settings/ })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  })
})
