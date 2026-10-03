import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionMenu, ActionMenuItem, computeMenuPosition } from './action-menu'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

afterEach(() => cleanup())

const viewport = { width: 1280, height: 800 }
const panel = { width: 200, height: 160 }

describe('computeMenuPosition', () => {
  it('opens below the trigger, lined up with its right edge, when there is room', () => {
    const anchor = { top: 100, bottom: 136, left: 900, right: 936, width: 36, height: 36 }
    expect(computeMenuPosition({ anchor, panel, viewport })).toEqual({ side: 'bottom', top: 142, left: 736, maxHeight: 650 })
  })

  it('flips above the trigger when the panel would run off the bottom of the viewport', () => {
    const anchor = { top: 700, bottom: 736, left: 900, right: 936, width: 36, height: 36 }
    const position = computeMenuPosition({ anchor, panel, viewport })
    expect(position.side).toBe('top')
    expect(position.top).toBeUndefined()
    // 800 - 700 + 6px gap: the panel's bottom edge sits just above the trigger.
    expect(position.bottom).toBe(106)
    expect(position.maxHeight).toBe(686)
  })

  it('stays inside the viewport horizontally on both sides', () => {
    const nearLeft = { top: 100, bottom: 136, left: 20, right: 56, width: 36, height: 36 }
    expect(computeMenuPosition({ anchor: nearLeft, panel, viewport }).left).toBe(8)
    const nearRight = { top: 100, bottom: 136, left: 1240, right: 1276, width: 36, height: 36 }
    expect(computeMenuPosition({ anchor: nearRight, panel, viewport, align: 'start' }).left).toBe(1072)
  })

  it('picks the side with more room when the panel fits nowhere, and reports that room', () => {
    const anchor = { top: 300, bottom: 336, left: 0, right: 36, width: 36, height: 36 }
    const tall = { width: 200, height: 900 }
    const position = computeMenuPosition({ anchor, panel: tall, viewport })
    expect(position.side).toBe('bottom')
    expect(position.maxHeight).toBe(450)
  })

  it('honours a preferred top side when it fits', () => {
    const anchor = { top: 400, bottom: 436, left: 0, right: 36, width: 36, height: 36 }
    expect(computeMenuPosition({ anchor, panel, viewport, preferredSide: 'top' }).side).toBe('top')
  })
})

function Harness({ anchorTop = 100 }: { anchorTop?: number }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  return (
    <div style={{ overflow: 'hidden', height: 40 }} data-testid="clipping-card">
      <button
        ref={(node) => {
          triggerRef.current = node
          if (node) {
            node.getBoundingClientRect = () => ({ top: anchorTop, bottom: anchorTop + 36, left: 900, right: 936, width: 36, height: 36, x: 900, y: anchorTop, toJSON() {} })
          }
        }}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        More
      </button>
      <ActionMenu open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} label="Card actions" className="w-56">
        <ActionMenuItem onClick={() => setOpen(false)}>Follow</ActionMenuItem>
        <ActionMenuItem tone="danger" onClick={() => setOpen(false)}>Block</ActionMenuItem>
      </ActionMenu>
    </div>
  )
}

describe('ActionMenu', () => {
  function mockPanelSize() {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return (this as HTMLElement).getAttribute('role') === 'menu' ? 160 : 0 } })
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return (this as HTMLElement).getAttribute('role') === 'menu' ? 200 : 0 } })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  }

  it('renders the panel in a portal on <body>, outside the clipping card, positioned below the trigger', () => {
    mockPanelSize()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const menu = screen.getByRole('menu', { name: 'Card actions' })
    expect(menu.parentElement).toBe(document.body)
    expect(screen.getByTestId('clipping-card').contains(menu)).toBe(false)
    expect(menu).toHaveClass('fixed')
    expect(menu).toHaveAttribute('data-side', 'bottom')
    expect(menu.style.top).toBe('142px')
    expect(menu.style.left).toBe('736px')
    expect(menu.style.visibility).not.toBe('hidden')
    expect(screen.getByRole('menuitem', { name: 'Follow' })).toHaveFocus()
  })

  it('flips upward for a trigger near the bottom of the viewport', () => {
    mockPanelSize()
    render(<Harness anchorTop={720} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const menu = screen.getByRole('menu')
    expect(menu).toHaveAttribute('data-side', 'top')
    expect(menu.style.bottom).toBe('86px')
    expect(menu.style.top).toBe('')
  })

  it('closes on an outside press and on Escape, returning focus to the trigger', () => {
    mockPanelSize()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'More' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    act(() => { fireEvent.pointerDown(document.body) })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('does not close when the trigger itself is pressed again (the toggle closes it)', () => {
    mockPanelSize()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'More' })
    fireEvent.click(trigger)
    act(() => { fireEvent.pointerDown(trigger) })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('moves between items with the arrow keys and wraps', () => {
    mockPanelSize()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Block' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Follow' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(screen.getByRole('menuitem', { name: 'Block' })).toHaveFocus()
  })

  it('is the phone bottom sheet below md: backdrop, grab handle and Cancel row', () => {
    mockPanelSize()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('max-md:!fixed')
    expect(menu.className).toContain('max-md:!bottom-0')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('md:hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
