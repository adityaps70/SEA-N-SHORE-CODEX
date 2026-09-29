import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ pathname: '/home' as string | null }))
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))

import { CREATE_SHEET_GROUPS } from './create-sheet'
import { MobileAppHeader } from './mobile-app-header'
import { MobileNav, isTypingTarget, tabBadgeText } from './mobile-nav'
import type { HeaderOrganization } from './account-menu'

beforeEach(() => {
  navigation.pathname = '/home'
})
afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

const organizations: HeaderOrganization[] = [
  { id: 'c1', slug: 'beaufort-marine', name: 'Beaufort Marine Services', logoUrl: null, canManage: true },
]

function openDrawer(props: Parameters<typeof MobileAppHeader>[0] = {}) {
  render(<MobileAppHeader {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
  return screen.getByRole('dialog', { name: props.viewer?.name ?? 'Member' })
}

describe('phone top bar', () => {
  it('shows the viewer photo button, a wide search link and Messages', () => {
    render(<MobileAppHeader viewer={{ name: 'Prakhar Pathak', avatarUrl: '/avatar.jpg' }} messagingUnreadCount={2} />)

    const banner = screen.getByRole('banner')
    expect(banner).toHaveClass('md:hidden', 'sticky', 'top-0')
    const photo = screen.getByRole('button', { name: 'Open menu' })
    expect(photo).toHaveAttribute('aria-haspopup', 'dialog')
    expect(photo).toHaveAttribute('aria-expanded', 'false')
    expect(photo.querySelector('img')).toHaveAttribute('src', '/avatar.jpg')
    expect(screen.getByRole('link', { name: 'Search jobs, people, courses' })).toHaveAttribute('href', '/search')
    expect(screen.getByRole('link', { name: 'Messages' })).toHaveAttribute('href', '/messages')
    // Notifications and Create moved to the bottom tabs.
    expect(within(banner).queryByRole('link', { name: /Notifications/ })).not.toBeInTheDocument()
    expect(within(banner).queryByRole('link', { name: 'Create' })).not.toBeInTheDocument()
  })

  it('is not rendered on detail routes, which show their own MobilePageBar', () => {
    navigation.pathname = '/jobs/0f6b7a52-4c3f-4f61-9d0e-1a2b3c4d5e6f'
    const { container } = render(<MobileAppHeader />)
    expect(container).toBeEmptyDOMElement()

    navigation.pathname = '/jobs'
    cleanup()
    render(<MobileAppHeader />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })
})

describe('phone side drawer', () => {
  it('opens from the photo with the viewer header and a Complete profile link while incomplete', () => {
    const drawer = openDrawer({
      viewer: {
        name: 'Prakhar Pathak',
        headline: 'Marine Engineer turned Entrepreneur',
        organization: 'Beaufort IT Solutions',
        location: 'Lucknow',
        profileCompletion: 80,
      },
    })

    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(within(drawer).getByRole('heading', { name: 'Prakhar Pathak' })).toBeInTheDocument()
    expect(within(drawer).getByText('Marine Engineer turned Entrepreneur')).toBeInTheDocument()
    expect(within(drawer).getByText('Beaufort IT Solutions · Lucknow')).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/profile')
    expect(within(drawer).getByRole('link', { name: 'Complete profile · 80%' })).toHaveAttribute('href', '/profile/edit')
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'true')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('omits Complete profile once the profile is complete or when completion is unknown', () => {
    openDrawer({ viewer: { name: 'Prakhar Pathak', profileCompletion: 100 } })
    expect(screen.queryByRole('link', { name: /Complete profile/ })).not.toBeInTheDocument()
    cleanup()
    openDrawer({ viewer: { name: 'Prakhar Pathak', profileCompletion: null } })
    expect(screen.queryByRole('link', { name: /Complete profile/ })).not.toBeInTheDocument()
  })

  it('gives a member without organizations the standard rows, work tools without Admin, and footer links', () => {
    const drawer = openDrawer()
    const hrefs = within(drawer).getAllByRole('link').map((link) => link.getAttribute('href'))
    for (const href of ['/learn', '/learn/my-learning', '/events', '/community', '/saved', '/activities', '/hiring', '/learn/teach', '/settings/billing', '/settings', '/help', '/about', '/pricing', '/contact', '/newsletter', '/accessibility', '/terms', '/privacy', '/refunds', '/shipping', '/copyright']) {
      expect(hrefs).toContain(href)
    }
    const tools = within(drawer).getByRole('region', { name: 'Work tools' })
    expect(within(tools).getAllByRole('link').map((link) => link.textContent)).toEqual(['Hiring', 'Teach on Sea N Shore'])
    expect(within(drawer).queryByRole('link', { name: /^Manage/ })).not.toBeInTheDocument()
    const social = within(drawer).getByRole('list', { name: 'Sea N Shore on social media' })
    expect(within(social).getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual(['Instagram (opens in a new tab)', 'Facebook (opens in a new tab)', 'X (opens in a new tab)'])
    const instagram = within(drawer).getByRole('link', { name: 'Instagram (opens in a new tab)' })
    expect(instagram).toHaveAttribute('href', 'https://www.instagram.com/seaandshore.in')
    expect(instagram).toHaveAttribute('target', '_blank')
    expect(instagram).toHaveAttribute('rel', 'noopener noreferrer')
    expect(instagram.querySelector('svg')).toBeInTheDocument()
    expect(within(drawer).getByText(`© ${new Date().getFullYear()} Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai, India`)).toBeInTheDocument()
    expect(within(drawer).queryByText(/all rights reserved/i)).not.toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('gives an administrator who manages an organization Manage and Admin', () => {
    const drawer = openDrawer({ canAccessAdmin: true, organizations })
    const orgs = within(drawer).getByRole('region', { name: 'Your organizations' })
    expect(within(orgs).getByRole('link', { name: 'Beaufort Marine Services' })).toHaveAttribute('href', '/organizations/beaufort-marine')
    expect(within(orgs).getByRole('link', { name: 'Manage Beaufort Marine Services' })).toHaveAttribute('href', '/organizations/beaufort-marine/manage')
    expect(within(orgs).getByRole('link', { name: 'See all organizations' })).toHaveAttribute('href', '/organizations#your-pages')
    const tools = within(drawer).getByRole('region', { name: 'Work tools' })
    expect(within(tools).getAllByRole('link').map((link) => link.textContent)).toEqual(['Hiring', 'Teach on Sea N Shore', 'Admin'])
  })

  it('moves focus into the drawer, closes on Escape and returns focus to the photo', () => {
    render(<MobileAppHeader />)
    const photo = screen.getByRole('button', { name: 'Open menu' })
    photo.focus()
    fireEvent.click(photo)
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(photo).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('closes from the close button, the backdrop and a chosen link', () => {
    render(<MobileAppHeader />)
    const photo = screen.getByRole('button', { name: 'Open menu' })
    fireEvent.click(photo)
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(photo)
    fireEvent.click(screen.getByRole('dialog').previousElementSibling as Element)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(photo)
    fireEvent.click(screen.getByRole('link', { name: 'Saved posts' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps Tab inside the drawer', () => {
    render(<MobileAppHeader />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const drawer = screen.getByRole('dialog')
    const focusable = drawer.querySelectorAll<HTMLElement>('a[href], button')
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  it('closes after a route change', () => {
    const { rerender } = render(<MobileAppHeader />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    navigation.pathname = '/network'
    rerender(<MobileAppHeader />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('phone bottom tabs', () => {
  it('shows Home, Network, Post, Notifications and Jobs with the active tab marked', () => {
    navigation.pathname = '/network'
    render(<MobileNav />)
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home')
    const network = within(nav).getByRole('link', { name: 'My Network' })
    expect(network).toHaveAttribute('href', '/network')
    expect(network).toHaveAttribute('aria-current', 'page')
    expect(network).toHaveClass('border-navy-950', 'text-navy-950', 'font-bold')
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    expect(within(nav).getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '/notifications')
    expect(within(nav).getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/jobs')
    expect(within(nav).getByRole('button', { name: 'Post' })).toBeInTheDocument()
    expect(nav).toHaveClass('pb-[env(safe-area-inset-bottom)]')
  })

  it('badges Network with pending requests and Notifications with unread, capped at 9+', () => {
    render(<MobileNav pendingConnectionRequestCount={3} notificationUnreadCount={12} />)
    expect(screen.getByRole('link', { name: 'My Network, 3 pending connection requests' })).toBeInTheDocument()
    expect(screen.getByTestId('network-tab-badge')).toHaveTextContent('3')
    expect(screen.getByRole('link', { name: 'Notifications, 12 unread' })).toBeInTheDocument()
    expect(screen.getByTestId('notifications-tab-badge')).toHaveTextContent('9+')
    cleanup()
    render(<MobileNav pendingConnectionRequestCount={1} notificationUnreadCount={0} />)
    expect(screen.getByRole('link', { name: 'My Network, 1 pending connection request' })).toBeInTheDocument()
    expect(screen.queryByTestId('notifications-tab-badge')).not.toBeInTheDocument()
    expect(tabBadgeText(9)).toBe('9')
    expect(tabBadgeText(10)).toBe('9+')
  })

  it('opens the Create sheet from Post with every create entry', () => {
    render(<MobileNav />)
    const post = screen.getByRole('button', { name: 'Post' })
    fireEvent.click(post)
    expect(post).toHaveAttribute('aria-expanded', 'true')
    const sheet = screen.getByRole('dialog', { name: 'Create' })
    // Phones only: hidden from md up.
    expect(sheet.parentElement).toHaveClass('md:hidden')
    expect(within(sheet).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Write a postUpdate · Question · Poll', '/home?compose=update'],
      ['Photo or video', '/home?compose=photo'],
      ['Document (PDF)', '/home?compose=document'],
      // Round 9B: group posts start from the Community directory (a group is chosen first).
      ['Post in a groupChoose a group first', '/community'],
      ['Post a job', '/hiring/jobs/new'],
      ['Create an event', '/events/create'],
      ['Create a course', '/learn/studio/courses/new'],
      // Round 9C: members create communities with Creator Pro / Organization Pro; the page explains otherwise.
      ['Create a communityCreator Pro · Organization Pro', '/community/new'],
      ['All creator tools', '/creator'],
    ])
    expect(CREATE_SHEET_GROUPS.flat()).toHaveLength(9)

    fireEvent.click(within(sheet).getByRole('link', { name: 'Post a job' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(post)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the Create sheet after a route change', () => {
    const { rerender } = render(<MobileNav />)
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(screen.getByRole('dialog', { name: 'Create' })).toBeInTheDocument()
    navigation.pathname = '/jobs'
    rerender(<MobileNav />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is hidden on full-screen routes and tells the shell to drop its bottom padding', () => {
    navigation.pathname = '/messages/0f6b7a52-4c3f-4f61-9d0e-1a2b3c4d5e6f'
    const { container } = render(<MobileNav />)
    const nav = container.querySelector('nav') as HTMLElement
    expect(nav).toHaveAttribute('hidden')
    expect(nav).toHaveAttribute('data-phone-tabbar', 'off')
  })

  it('hides while a text field has focus and comes back after', () => {
    const { container } = render(
      <>
        <input aria-label="Headline" />
        <input aria-label="Remember me" type="checkbox" />
        <MobileNav />
      </>,
    )
    const nav = container.querySelector('nav') as HTMLElement
    expect(nav).not.toHaveAttribute('hidden')

    act(() => screen.getByRole('textbox', { name: 'Headline' }).focus())
    expect(nav).toHaveAttribute('hidden')
    expect(nav).toHaveAttribute('data-phone-tabbar', 'typing')

    act(() => screen.getByRole('checkbox', { name: 'Remember me' }).focus())
    expect(nav).not.toHaveAttribute('hidden')
    expect(nav).toHaveAttribute('data-phone-tabbar', 'on')
  })

  it('recognises the fields that open the phone keyboard', () => {
    const textarea = document.createElement('textarea')
    const search = Object.assign(document.createElement('input'), { type: 'search' })
    const radio = Object.assign(document.createElement('input'), { type: 'radio' })
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    editable.append(inner)
    expect(isTypingTarget(textarea)).toBe(true)
    expect(isTypingTarget(search)).toBe(true)
    expect(isTypingTarget(radio)).toBe(false)
    expect(isTypingTarget(inner)).toBe(true)
    expect(isTypingTarget(document.createElement('button'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
