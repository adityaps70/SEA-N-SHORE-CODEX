import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppUpdateBar } from './app-update-bar'
import { APP_UPDATED_EVENT, setUnsavedInput } from './stale-deployment'

afterEach(() => {
  cleanup()
  setUnsavedInput('composer', false)
  window.sessionStorage.clear()
})

describe('AppUpdateBar', () => {
  it('shows nothing until the update event, then a bar that refreshes on tap', () => {
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } })
    try {
      render(<AppUpdateBar />)
      expect(screen.queryByText('Sea N Shore has been updated, tap to refresh')).toBeNull()
      act(() => { window.dispatchEvent(new Event(APP_UPDATED_EVENT)) })
      fireEvent.click(screen.getByRole('button', { name: 'Sea N Shore has been updated, tap to refresh' }))
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it('an uncaught stale Server Action error with unsaved input shows the bar and does not reload', () => {
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } })
    try {
      setUnsavedInput('composer', true)
      render(<AppUpdateBar />)
      const event = new Event('unhandledrejection', { cancelable: true }) as PromiseRejectionEvent
      Object.defineProperty(event, 'reason', { value: new Error('Server Action "7f3a" was not found on the server.') })
      act(() => { window.dispatchEvent(event) })
      expect(event.defaultPrevented).toBe(true)
      expect(reload).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Sea N Shore has been updated, tap to refresh' })).toBeTruthy()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it('leaves other unhandled errors alone', () => {
    render(<AppUpdateBar />)
    const event = new Event('unhandledrejection', { cancelable: true }) as PromiseRejectionEvent
    Object.defineProperty(event, 'reason', { value: new Error('network down') })
    act(() => { window.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)
    expect(screen.queryByRole('button', { name: 'Sea N Shore has been updated, tap to refresh' })).toBeNull()
  })
})
