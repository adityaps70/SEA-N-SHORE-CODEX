import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FocusModeToggle, FocusSidebarToggle, PlayerShell, SidebarRailToggle } from './player-shell'

function shell() {
  return document.querySelector('[data-sidebar]') as HTMLElement
}

describe('PlayerShell (learning round E, E1/E4)', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('hides the site footer while open; focus mode hides the top navigation and the sidebar, which can come back', () => {
    render(<PlayerShell><FocusModeToggle /><FocusSidebarToggle /></PlayerShell>)
    expect(document.documentElement.dataset.learnPlayer).toBe('on')
    expect(shell().dataset.sidebar).toBe('open')

    fireEvent.click(screen.getByRole('button', { name: 'Focus mode' }))
    expect(document.documentElement.dataset.learnFocus).toBe('on')
    expect(shell().dataset.sidebar).toBe('hidden')

    fireEvent.click(screen.getByRole('button', { name: 'Show curriculum' }))
    expect(shell().dataset.sidebar).toBe('open')

    fireEvent.click(screen.getByRole('button', { name: 'Exit focus mode' }))
    expect(document.documentElement.dataset.learnFocus).toBeUndefined()
    cleanup()
    expect(document.documentElement.dataset.learnPlayer).toBeUndefined()
  })

  it('collapses the sidebar into a rail and remembers it', () => {
    render(<PlayerShell><SidebarRailToggle collapsed={false} /></PlayerShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse the curriculum' }))
    expect(shell().dataset.sidebar).toBe('rail')
    expect(window.localStorage.getItem('sea-n-shore.learn.sidebar-rail')).toBe('on')
  })

  it('still works when storage is unavailable (preferences start off)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    render(<PlayerShell><FocusModeToggle /></PlayerShell>)
    expect(shell().dataset.sidebar).toBe('open')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Focus mode' })) })
    expect(shell().dataset.sidebar).toBe('open')
  })
})
