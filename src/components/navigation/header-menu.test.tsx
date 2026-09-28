import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ pathname: '/home' }))
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))

import { HeaderMenu } from './header-menu'
import { MobileAppHeader } from './mobile-app-header'

const items = [
  { href: '/activities', label: 'My Activities' },
  { href: '/saved', label: 'Saved posts' },
  { href: '/community', label: 'Community' },
]

function Menus() {
  return (
    <>
      <HeaderMenu label="More" trigger="More" items={items} />
      <HeaderMenu label="Create" trigger="Create" items={[{ href: '/events/create', label: 'Create an event' }]} />
    </>
  )
}

beforeEach(() => {
  navigation.pathname = '/home'
})
afterEach(() => cleanup())

describe('HeaderMenu', () => {
  it('opens one header menu at a time', () => {
    render(<Menus />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menu', { name: 'More' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.queryByRole('menu', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.getByRole('menu', { name: 'Create' })).toBeInTheDocument()
  })

  it('opens from the keyboard, moves with arrow keys and closes on Escape back to the trigger', () => {
    render(<Menus />)
    const trigger = screen.getByRole('button', { name: 'More' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    const [first, second, third] = screen.getAllByRole('menuitem')
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(second).toHaveFocus()
    fireEvent.keyDown(second, { key: 'End' })
    expect(third).toHaveFocus()
    fireEvent.keyDown(third, { key: 'ArrowDown' })
    expect(first).toHaveFocus()

    fireEvent.keyDown(first, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes after navigating to another route', () => {
    const { rerender } = render(<Menus />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    navigation.pathname = '/saved'
    rerender(<Menus />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes when a menu item is chosen', () => {
    render(<Menus />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Saved posts' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps Messages out of the phone account menu (it is an icon in the phone header)', () => {
    render(<MobileAppHeader unreadCount={0} />)
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.queryByRole('menuitem', { name: /Messages/ })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Settings/ })).toHaveAttribute('href', '/settings')
  })
})
