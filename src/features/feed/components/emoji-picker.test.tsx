import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmojiPicker, emojiMenuOffset, insertEmojiAt } from './emoji-picker'

afterEach(() => cleanup())

describe('insertEmojiAt', () => {
  it('appends with a separating space, or inserts at the caret and replaces a selection', () => {
    expect(insertEmojiAt('', '⚓')).toEqual({ value: '⚓', caret: 1 })
    expect(insertEmojiAt('Fair winds', '⚓')).toEqual({ value: 'Fair winds ⚓', caret: 12 })
    expect(insertEmojiAt('Fair winds ', '⚓')).toEqual({ value: 'Fair winds ⚓', caret: 12 })
    expect(insertEmojiAt('Fair winds crew', '⚓', 4, 4).value).toBe('Fair ⚓ winds crew')
    expect(insertEmojiAt('Fair winds crew', '🌊', 5, 10).value).toBe('Fair 🌊 crew')
  })
})

describe('emojiMenuOffset', () => {
  it('keeps the 232px menu inside a 360px phone screen', () => {
    // Trigger near the right edge, preferring right alignment.
    expect(emojiMenuOffset({ left: 300, right: 340 }, 360, 'right')).toBe(108 - 300)
    // Trigger near the left edge, preferring right alignment: clamp to the left margin.
    expect(emojiMenuOffset({ left: 20, right: 60 }, 360, 'right')).toBe(8 - 20)
    // Left alignment that would run off the right edge is pulled back.
    expect(emojiMenuOffset({ left: 250, right: 290 }, 360, 'left')).toBe(120 - 250)
    // Plenty of room: line up with the trigger.
    expect(emojiMenuOffset({ left: 100, right: 140 }, 1280, 'left')).toBe(0)
  })
})

describe('EmojiPicker', () => {
  it('opens a labelled menu, inserts the chosen emoji and closes on outside click or Escape', () => {
    const onSelect = vi.fn()
    render(<><EmojiPicker onSelect={onSelect} label="Add emoji to comment" /><p>Outside</p></>)
    const trigger = screen.getByRole('button', { name: 'Add emoji to comment' })

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert 🎉' }))
    expect(onSelect).toHaveBeenCalledWith('🎉')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByText('Outside'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
