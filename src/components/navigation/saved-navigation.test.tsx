import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

  it('turns Create into a menu of the five things a member can publish', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('menuitem', { name: /Post a job/ })).toHaveAttribute('href', '/hiring/jobs/new')
    expect(screen.getByRole('menuitem', { name: /Create an event/ })).toHaveAttribute('href', '/events/create')
    expect(screen.getByRole('menuitem', { name: /Create a course/ })).toHaveAttribute('href', '/learn/studio/courses/new')
    // Round 9C: communities are created by members (Creator Pro / Organization Pro); the page explains otherwise.
    expect(screen.getByRole('menuitem', { name: /Create a community/ })).toHaveAttribute('href', '/community/new')
    expect(screen.getByRole('menuitem', { name: /All creator tools/ })).toHaveAttribute('href', '/creator')
    // Posting an update happens in the Home composer, not from the Create menu.
    expect(screen.queryByRole('menuitem', { name: /Post an update/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('href'))).toEqual([
      '/hiring/jobs/new',
      '/events/create',
      '/learn/studio/courses/new',
      '/community/new',
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

  it('gives tablets (md to lg), which have no search field, a search icon link instead', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    const icon = screen.getByRole('link', { name: 'Search' })
    expect(icon).toHaveAttribute('href', '/search')
    expect(icon).toHaveClass('lg:hidden')
    expect(screen.getByRole('search')).toHaveClass('hidden', 'lg:block')
  })

  it('keeps the desktop search narrow enough to never clip the navigation', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    expect(screen.getByRole('searchbox', { name: 'Search Sea N Shore' })).toHaveClass('min-h-10', 'w-44', 'xl:w-56', '2xl:w-[22rem]')
  })

  it('uses five phone tabs — Home, Network, Post, Notifications, Jobs — on an opaque bar', () => {
    render(<MobileNav />)

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(nav).toHaveClass('grid-cols-5', 'bg-white', 'md:hidden')
    expect(nav).not.toHaveClass('bg-white/95')
    expect(Array.from(nav.children).map((child) => child.getAttribute('href') ?? child.textContent)).toEqual([
      '/home', '/network', 'Post', '/notifications', '/jobs',
    ])
    expect(screen.getByRole('button', { name: 'Post' })).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
  })

  it('moves Learn, Events, Community, Saved posts and My Activities into the phone side drawer', () => {
    render(<MobileAppHeader viewer={{ name: 'Prakhar Pathak' }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const menu = screen.getByRole('navigation', { name: 'Side menu' })
    expect(within(menu).getByRole('link', { name: 'Learn' })).toHaveAttribute('href', '/learn')
    expect(within(menu).getByRole('link', { name: 'My learning' })).toHaveAttribute('href', '/learn/my-learning')
    expect(within(menu).getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/events')
    expect(within(menu).getByRole('link', { name: 'Community' })).toHaveAttribute('href', '/community')
    expect(within(menu).getByRole('link', { name: 'Saved posts' })).toHaveAttribute('href', '/saved')
    expect(within(menu).getByRole('link', { name: 'My Activities' })).toHaveAttribute('href', '/activities')
    expect(within(menu).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(within(menu).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Prakhar Pathak, view profile' })).toHaveAttribute('href', '/profile')
    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/profile')
  })
})
