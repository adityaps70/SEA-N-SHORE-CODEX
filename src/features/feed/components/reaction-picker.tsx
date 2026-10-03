'use client'

import { ThumbsUp } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useDismissibleLayer } from '@/hooks/use-dismissible-layer'
import { POST_REACTIONS, POST_REACTION_META, type PostReactionType } from '../types'
import { POST_ACTION_LABEL_CLASS, POST_ACTION_PHONE_CLASS } from './post-action-styles'

/** How long a finger has to rest on the Like button before the reaction choices open. */
export const LONG_PRESS_MS = 450
/** Browsers fire emulated mouse events right after a touch; ignore those for hover-to-open. */
const TOUCH_MOUSE_GRACE_MS = 800

const TRIGGER_STYLES = {
  post: `min-h-9 gap-1.5 px-2 text-sm @min-[26rem]:px-2.5 ${POST_ACTION_PHONE_CLASS}`,
  comment: 'min-h-8 gap-1 px-2 text-xs',
} as const

/**
 * The Like button of the post and comment action rows.
 * - Not reacted: outline thumbs-up + "Like". Reacted: the chosen emoji + its label in the accent colour.
 * - The total reaction count sits inside the button, after the label.
 * - Click toggles Like (or removes the current reaction). Hover (mouse), long-press (touch) or
 *   keyboard focus opens the reaction choices.
 * On posts the label hides when the action row is narrow (phones); icon and count stay.
 */
export function ReactionPicker({
  value,
  disabled = false,
  onChange,
  count = 0,
  variant = 'post',
}: {
  value: PostReactionType | null
  disabled?: boolean
  onChange(value: PostReactionType | null): void
  /** Total reactions of every type, shown next to the label. Hidden when zero. */
  count?: number
  variant?: 'post' | 'comment'
  /** Retained for older call sites; the layout is chosen by `variant`. */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressOpenedRef = useRef(false)
  const lastTouchRef = useRef(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  /** Focus goes back to Like after Escape; that focus must not reopen the choices. */
  const skipFocusOpenRef = useRef(false)
  const close = useCallback(() => {
    // The shared layer returns focus to Like after Escape; do not let that reopen the choices.
    skipFocusOpenRef.current = true
    setOpen(false)
    window.setTimeout(() => { skipFocusOpenRef.current = false }, 0)
  }, [])
  const rootRef = useDismissibleLayer<HTMLDivElement>(open, close, { triggerRef, closeOnFocusOut: false })
  const current = value ? POST_REACTION_META[value] : POST_REACTION_META.like

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current)
  }, [])

  function cancelClose() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  function cancelLongPress() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  function recentlyTouched() {
    return Date.now() - lastTouchRef.current < TOUCH_MOUSE_GRACE_MS
  }

  function openPicker() {
    if (disabled) return
    cancelClose()
    setOpen(true)
  }

  function scheduleClose() {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120)
  }

  function startLongPress() {
    lastTouchRef.current = Date.now()
    longPressOpenedRef.current = false
    cancelLongPress()
    if (disabled) return
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      longPressOpenedRef.current = true
      openPicker()
    }, LONG_PRESS_MS)
  }

  function endTouch() {
    lastTouchRef.current = Date.now()
    cancelLongPress()
  }

  function onTriggerClick() {
    // A long-press already opened the choices; lifting the finger must not also toggle Like.
    if (longPressOpenedRef.current) {
      longPressOpenedRef.current = false
      return
    }
    onChange(value ? null : 'like')
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      skipFocusOpenRef.current = true
      triggerRef.current?.focus()
      skipFocusOpenRef.current = false
    }
  }

  const reactedStyles = value
    ? `border-ocean-200 bg-ocean-50 text-ocean-700 hover:border-ocean-300 hover:bg-ocean-100 ${variant === 'post' ? 'max-md:bg-white' : ''}`
    : 'border-mist-200 bg-white text-navy-900 hover:border-ocean-300 hover:bg-mist-50 hover:text-navy-950'

  return (
    <div
      ref={rootRef}
      className={`relative inline-flex min-w-0 shrink-0 items-center ${variant === 'post' ? 'max-md:flex' : ''}`}
      onMouseEnter={() => { if (!recentlyTouched()) openPicker() }}
      onMouseLeave={() => { if (!recentlyTouched()) scheduleClose() }}
      onFocus={() => { if (!recentlyTouched() && !skipFocusOpenRef.current) openPicker() }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleClose()
      }}
      onKeyDown={onKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-pressed={Boolean(value)}
        aria-label={current.label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={value ? `${current.label} · click to remove, hold for more reactions` : 'Like · hold or hover for more reactions'}
        onClick={onTriggerClick}
        onTouchStart={startLongPress}
        onTouchEnd={endTouch}
        onTouchMove={endTouch}
        onTouchCancel={endTouch}
        onContextMenu={(event) => { if (recentlyTouched()) event.preventDefault() }}
        className={`inline-flex min-w-0 cursor-pointer select-none items-center justify-center rounded-full border font-semibold transition [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${TRIGGER_STYLES[variant]} ${reactedStyles}`}
      >
        {value ? (
          <span aria-hidden="true" className={variant === 'post' ? 'text-base leading-none' : 'text-sm leading-none'}>{current.emoji}</span>
        ) : (
          <ThumbsUp aria-hidden="true" className={variant === 'post' ? 'size-5' : 'size-4'} />
        )}
        <span data-reaction-label className={variant === 'post' ? POST_ACTION_LABEL_CLASS : undefined}>{current.label}</span>
        {count > 0 ? (
          // Phones show the total in the post's counts line instead.
          <span data-testid="reaction-count" aria-hidden="true" className={variant === 'post' ? 'tabular-nums max-md:hidden' : 'tabular-nums'}>{count}</span>
        ) : null}
      </button>
      {open ? (
        <div role="menu" aria-label="Reactions" className="absolute bottom-full left-0 z-40 mb-2 flex min-w-max gap-1 rounded-full border border-mist-100 bg-white p-1.5 shadow-xl">
          {POST_REACTIONS.map((reaction) => {
            const meta = POST_REACTION_META[reaction]
            return (
              <button
                key={reaction}
                type="button"
                role="menuitemradio"
                aria-checked={value === reaction}
                aria-label={meta.label}
                onClick={() => {
                  onChange(value === reaction ? null : reaction)
                  setOpen(false)
                }}
                className={`group relative inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40 ${value === reaction ? 'bg-ocean-50 text-ocean-700' : 'text-navy-900'}`}
              >
                <span aria-hidden="true" className="text-xl">{meta.emoji}</span>
                <span data-reaction-label className="sr-only">{meta.label}</span>
                <span
                  role="tooltip"
                  aria-label={meta.label}
                  data-placement="top"
                  className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-navy-950 px-2.5 py-1.5 text-xs font-semibold leading-none text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {meta.label}
                  <span aria-hidden="true" className="absolute left-1/2 top-full size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-navy-950" />
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
