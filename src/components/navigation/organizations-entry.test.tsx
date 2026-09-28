import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/home' }))
vi.mock('@/components/brand/wordmark', () => ({ Wordmark: () => <div>Sea N Shore</div> }))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))
vi.mock('@/features/messaging/components/messaging-unread-badge', () => ({ MessagingUnreadBadge: () => null }))
vi.mock('@/features/notifications/components/notification-bell', () => ({ NotificationBell: () => <button type="button">Notifications</button> }))
vi.mock('./active-nav-link', () => ({
  ActiveNavLink: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}))

import { AppHeader, type HeaderOrganization } from './app-header'
import { MobileAppHeader } from './mobile-app-header'

afterEach(() => cleanup())

const organizations: HeaderOrganization[] = [
  { id: 'c1', slug: 'oceanic-ship-management', name: 'Oceanic Ship Management', logoUrl: '/api/company-logo/c1', canManage: true },
  { id: 'c2', slug: 'harbour-crew', name: 'Harbour Crew Services', logoUrl: null, canManage: false },
]

function openAccountMenu(props: Partial<Parameters<typeof AppHeader>[0]> = {}) {
  render(<AppHeader recentNotifications={[]} unreadCount={0} viewer={{ name: 'Prakhar Pathak' }} {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
  return screen.getByRole('menu', { name: 'Account menu' })
}

describe('Organizations in the navigation', () => {
  it('adds Organizations to the account menu for every member', () => {
    const menu = openAccountMenu()
    expect(within(menu).getByRole('menuitem', { name: /^Organizations/ })).toHaveAttribute('href', '/organizations')
    expect(within(menu).queryByRole('group', { name: 'Your organizations' })).not.toBeInTheDocument()
  })

  it('lists the member’s organizations with logo, page link and Manage for managing roles', () => {
    const menu = openAccountMenu({ organizations })
    const group = within(menu).getByRole('group', { name: 'Your organizations' })

    expect(within(group).getByRole('menuitem', { name: 'Oceanic Ship Management' })).toHaveAttribute('href', '/organizations/oceanic-ship-management')
    expect(within(group).getByRole('menuitem', { name: 'Manage Oceanic Ship Management' })).toHaveAttribute('href', '/organizations/oceanic-ship-management/manage')
    expect(group.querySelector('img')).toHaveAttribute('src', '/api/company-logo/c1')
    expect(within(group).getByRole('menuitem', { name: 'Harbour Crew Services' })).toHaveAttribute('href', '/organizations/harbour-crew')
    expect(within(group).queryByRole('menuitem', { name: 'Manage Harbour Crew Services' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /Settings/ })).toHaveAttribute('href', '/settings')
  })

  it('links to all organizations when there are more than the menu shows', () => {
    const menu = openAccountMenu({ organizations, organizationCount: 5 })
    expect(within(menu).getByRole('menuitem', { name: 'See all 5 organizations' })).toHaveAttribute('href', '/organizations#your-pages')
  })

  it('moves through organization rows, including Manage, with the arrow keys', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} viewer={{ name: 'Prakhar Pathak' }} organizations={organizations} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Account menu' }), { key: 'ArrowDown' })
    const labels = screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label') ?? item.textContent)
    expect(labels.slice(0, 5)).toEqual([
      'ProfileView and edit your Maritime Passport',
      'OrganizationsYour pages, access requests and discovery',
      'Oceanic Ship Management',
      'Manage Oceanic Ship Management',
      'Harbour Crew Services',
    ])
    const [profile, orgs, oceanic, manage] = screen.getAllByRole('menuitem')
    expect(profile).toHaveFocus()
    fireEvent.keyDown(profile!, { key: 'ArrowDown' })
    expect(orgs).toHaveFocus()
    fireEvent.keyDown(orgs!, { key: 'ArrowDown' })
    expect(oceanic).toHaveFocus()
    fireEvent.keyDown(oceanic!, { key: 'ArrowDown' })
    expect(manage).toHaveFocus()
    fireEvent.keyDown(manage!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('no longer has a desktop More menu; Organizations keeps its description in the account menu', () => {
    const menu = openAccountMenu()
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /^Organizations/ })).toHaveTextContent('Your pages, access requests and discovery')
  })

  it('lists Organizations and the member’s organizations in the phone account menu', () => {
    render(<MobileAppHeader unreadCount={0} organizations={organizations} />)
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    const menu = screen.getByRole('menu', { name: 'Account menu' })
    expect(within(menu).getByRole('menuitem', { name: /^Organizations/ })).toHaveAttribute('href', '/organizations')
    expect(within(menu).getByRole('menuitem', { name: 'Manage Oceanic Ship Management' })).toHaveAttribute('href', '/organizations/oceanic-ship-management/manage')
  })
})
