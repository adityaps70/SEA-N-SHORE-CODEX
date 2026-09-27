import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ pathname: '/home' }))
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))

import { useDismissibleLayer } from './use-dismissible-layer'

function Popover({ name, onDismiss }: { name: string; onDismiss?: (reason?: string) => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const close = useCallback((reason?: string) => {
    setOpen(false)
    onDismiss?.(reason)
  }, [onDismiss])
  const rootRef = useDismissibleLayer<HTMLDivElement>(open, close, { triggerRef })
  return (
    <div ref={rootRef}>
      <button ref={triggerRef} type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {name}
      </button>
      {open ? (
        <div role="dialog" aria-label={`${name} panel`}>
          <button type="button">Inside {name}</button>
        </div>
      ) : null}
    </div>
  )
}

beforeEach(() => {
  navigation.pathname = '/home'
})
afterEach(() => cleanup())

describe('useDismissibleLayer', () => {
  it('closes on a pointer press outside, but not inside', () => {
    const onDismiss = vi.fn()
    render(<><Popover name="Menu" onDismiss={onDismiss} /><p>Outside</p></>)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Inside Menu' }))
    expect(screen.getByRole('dialog', { name: 'Menu panel' })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByText('Outside'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onDismiss).toHaveBeenCalledWith('outside')
  })

  it('closes on Escape and returns focus to the trigger', () => {
    render(<Popover name="Menu" />)
    const trigger = screen.getByRole('button', { name: 'Menu' })
    fireEvent.click(trigger)
    const inside = screen.getByRole('button', { name: 'Inside Menu' })
    inside.focus()

    fireEvent.keyDown(inside, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes when the route changes', () => {
    const { rerender } = render(<Popover name="Menu" />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    navigation.pathname = '/jobs'
    rerender(<Popover name="Menu" />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not reopen or close anything when the route changes while closed', () => {
    const onDismiss = vi.fn()
    const { rerender } = render(<Popover name="Menu" onDismiss={onDismiss} />)
    navigation.pathname = '/learn'
    rerender(<Popover name="Menu" onDismiss={onDismiss} />)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('keeps only one layer open at a time, even when opened from the keyboard', () => {
    render(<><Popover name="First" /><Popover name="Second" /></>)
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    expect(screen.getByRole('dialog', { name: 'First panel' })).toBeInTheDocument()

    // A keyboard activation fires click without any pointer event.
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Second' })) })

    expect(screen.queryByRole('dialog', { name: 'First panel' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Second panel' })).toBeInTheDocument()
  })

  it('closes when keyboard focus leaves the layer', () => {
    render(<><Popover name="Menu" /><button type="button">Next control</button></>)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const inside = screen.getByRole('button', { name: 'Inside Menu' })

    fireEvent.focusOut(inside, { relatedTarget: screen.getByRole('button', { name: 'Next control' }) })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
