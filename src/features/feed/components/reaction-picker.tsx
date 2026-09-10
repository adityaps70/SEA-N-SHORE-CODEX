'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { POST_REACTIONS, POST_REACTION_META, type PostReactionType } from '../types'

export function ReactionPicker({
  value,
  disabled = false,
  onChange,
  compact = false,
}: {
  value: PostReactionType | null
  disabled?: boolean
  onChange(value: PostReactionType | null): void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = value ? POST_REACTION_META[value] : POST_REACTION_META.like

  useEffect(() => {
    if (!open) return
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={rootRef} className="relative inline-flex min-w-0 items-center">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={Boolean(value)}
        onClick={() => onChange(value ? null : 'like')}
        className={`inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold transition hover:bg-mist-50 disabled:opacity-50 ${value ? 'text-ocean-700' : 'text-navy-900'}`}
      >
        <span aria-hidden="true" className="text-base leading-none">{current.emoji}</span>
        <span className={compact ? 'sr-only sm:not-sr-only' : ''}>{current.label}</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-label="Choose reaction"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((visible) => !visible)}
        className="inline-flex min-h-9 w-6 items-center justify-center rounded-lg text-muted hover:bg-mist-50 disabled:opacity-50"
      >
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </button>
      {open ? (
        <div role="menu" aria-label="Reactions" className="absolute bottom-full left-0 z-30 mb-2 flex min-w-max gap-1 rounded-2xl border border-mist-100 bg-white p-1.5 shadow-xl">
          {POST_REACTIONS.map((reaction) => {
            const meta = POST_REACTION_META[reaction]
            return (
              <button
                key={reaction}
                type="button"
                role="menuitemradio"
                aria-checked={value === reaction}
                title={meta.label}
                onClick={() => {
                  onChange(value === reaction ? null : reaction)
                  setOpen(false)
                }}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold hover:bg-mist-50 ${value === reaction ? 'bg-ocean-50 text-ocean-700' : 'text-navy-900'}`}
              >
                <span aria-hidden="true" className="text-xl">{meta.emoji}</span>
                <span>{meta.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
