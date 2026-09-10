'use client'

import { useRef, useState } from 'react'
import { POST_REACTIONS, POST_REACTION_META, type PostReactionType } from '../types'

export function ReactionPicker({
  value,
  disabled = false,
  onChange,
}: {
  value: PostReactionType | null
  disabled?: boolean
  onChange(value: PostReactionType | null): void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  const current = value ? POST_REACTION_META[value] : POST_REACTION_META.like

  function cancelClose() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
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

  return (
    <div
      className="relative inline-flex min-w-0 items-center"
      onMouseEnter={openPicker}
      onMouseLeave={scheduleClose}
      onFocus={openPicker}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleClose()
      }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-pressed={Boolean(value)}
        aria-label={current.label}
        onClick={() => onChange(value ? null : 'like')}
        className={`inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold transition hover:bg-mist-50 disabled:opacity-50 ${value ? 'text-ocean-700' : 'text-navy-900'}`}
      >
        <span aria-hidden="true" className="text-base leading-none">{current.emoji}</span>
        <span data-reaction-label className="sr-only">{current.label}</span>
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
                className={`group relative inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-mist-50 ${value === reaction ? 'bg-ocean-50 text-ocean-700' : 'text-navy-900'}`}
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
