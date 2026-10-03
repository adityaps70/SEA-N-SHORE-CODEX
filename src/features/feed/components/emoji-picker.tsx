'use client'

import { Smile } from 'lucide-react'
import { useCallback, useId, useRef, useState } from 'react'
import { useDismissibleLayer } from '@/hooks/use-dismissible-layer'

const EMOJI = ['😀', '😊', '👏', '🙏', '👍', '❤️', '🫡', '⚓', '🌊', '🚢', '🎉', '💡', '✅'] as const
/** Five 40px cells, four 4px gaps and 8px padding each side. */
const MENU_WIDTH = 232
const VIEWPORT_MARGIN = 8

/**
 * Horizontal offset (relative to the trigger's left edge) that keeps the emoji menu inside
 * the viewport, preferring to line up with the trigger's left or right edge.
 */
export function emojiMenuOffset(trigger: { left: number; right: number }, viewportWidth: number, align: 'left' | 'right') {
  const preferred = align === 'right' ? trigger.right - MENU_WIDTH : trigger.left
  const max = Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - MENU_WIDTH)
  const left = Math.min(Math.max(preferred, VIEWPORT_MARGIN), max)
  return Math.round(left - trigger.left)
}

/**
 * Inserts `emoji` into `value` at the textarea caret (or at the end), padding with a space
 * when it would otherwise touch a word. Returns the next value and caret position.
 */
export function insertEmojiAt(value: string, emoji: string, selectionStart?: number | null, selectionEnd?: number | null) {
  const start = selectionStart ?? value.length
  const end = selectionEnd ?? start
  const before = value.slice(0, start)
  const after = value.slice(end)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const inserted = `${lead}${emoji}`
  return { value: `${before}${inserted}${after}`, caret: before.length + inserted.length }
}

export function EmojiPicker({
  onSelect,
  label = 'Add emoji',
  align = 'left',
  size = 'md',
}: {
  onSelect(emoji: string): void
  label?: string
  align?: 'left' | 'right'
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const close = useCallback(() => setOpen(false), [])
  const rootRef = useDismissibleLayer<HTMLDivElement>(open, close)

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          setOpen(false)
          triggerRef.current?.focus()
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          if (!open) {
            const rect = event.currentTarget.getBoundingClientRect()
            setOffset(emojiMenuOffset(rect, window.innerWidth || document.documentElement.clientWidth, align))
          }
          setOpen((value) => !value)
        }}
        className={`grid place-items-center rounded-full text-navy-900 transition hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40 ${size === 'sm' ? 'size-9' : 'size-10'}`}
      >
        <Smile aria-hidden="true" className="size-5 text-ocean-700" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Choose emoji"
          style={{ left: offset, width: MENU_WIDTH }}
          className="absolute bottom-full z-50 mb-2 grid grid-cols-5 gap-1 rounded-2xl border border-mist-100 bg-white p-2 shadow-xl"
        >
          {EMOJI.map((emoji) => (
            <button key={emoji} type="button" role="menuitem" aria-label={`Insert ${emoji}`} onClick={() => { onSelect(emoji); setOpen(false) }} className="grid size-10 place-items-center rounded-xl text-xl hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40">
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
