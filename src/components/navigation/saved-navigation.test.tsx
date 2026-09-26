import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppHeader } from './app-header'
import { MobileNav } from './mobile-nav'

vi.mock('@/features/notifications/components/notification-bell', () => ({
  NotificationBell: () => <span>Notifications</span>,
}))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))

afterEach(() => cleanup())

describe('primary navigation layout', () => {
  it('keeps the desktop primary row to six destinations plus More', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    const primaryNav = screen.getByRole('navigation', { name: 'Primary' })
    const links = primaryNav.querySelectorAll('a')
    expect(Array.from(links).map((link) => link.getAttribute('href'))).toEqual([
      '/home', '/network', '/jobs', '/messages', '/learn', '/events',
    ])
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Saved' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My Activities' })).not.toBeInTheDocument()
  })

  it('moves Saved posts, My Activities and the Community preview into the More menu', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    fireEvent.click(screen.getByRole('button', { name: 'More' }))

    expect(screen.getByRole('menuitem', { name: /Saved posts/ })).toHaveAttribute('href', '/saved')
    expect(screen.getByRole('menuitem', { name: /My Activities/ })).toHaveAttribute('href', '/activities')
    expect(screen.getByRole('menuitem', { name: /Community/ })).toHaveTextContent('Preview')
  })

  it('turns Create into a menu of the four things a member can publish', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('menuitem', { name: /Post a job/ })).toHaveAttribute('href', '/hiring/jobs/new')
    expect(screen.getByRole('menuitem', { name: /Create an event/ })).toHaveAttribute('href', '/events/create')
    expect(screen.getByRole('menuitem', { name: /Create a course/ })).toHaveAttribute('href', '/learn/studio/courses/new')
    expect(screen.getByRole('menuitem', { name: /All creator tools/ })).toHaveAttribute('href', '/creator')
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

  it('uses a five-target mobile bottom bar with an opaque background', () => {
    render(<MobileNav />)

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(nav).toHaveClass('grid-cols-5', 'bg-white')
    expect(nav).not.toHaveClass('bg-white/95')
    expect(screen.getAllByRole('link')).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: /Saved posts/ })).toHaveAttribute('href', '/saved')
    expect(screen.getByRole('menuitem', { name: /Events/ })).toHaveAttribute('href', '/events')
  })
})
