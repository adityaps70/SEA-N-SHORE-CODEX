import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BottomSheet } from './mobile-sheet'

describe('BottomSheet focus trap (learning round E)', () => {
  afterEach(() => cleanup())

  it('keeps Tab and Shift+Tab inside the open sheet and closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <>
        <button type="button">Outside</button>
        <BottomSheet open onClose={onClose} title="Course curriculum" portal={false}>
          <a href="/lesson-1">Lesson 1</a>
          <a href="/lesson-2">Lesson 2</a>
        </BottomSheet>
      </>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Course curriculum' })
    expect(dialog).toHaveFocus()

    const close = screen.getByRole('button', { name: 'Close' })
    const last = screen.getByRole('link', { name: 'Lesson 2' })
    last.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(close).toHaveFocus()

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
