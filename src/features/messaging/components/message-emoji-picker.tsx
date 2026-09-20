'use client'

import { Smile, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const COMMON_EMOJI = [
  '😀', '😂', '😊', '😍', '🥰', '😎', '🤝', '👏',
  '🙏', '👍', '❤️', '🔥', '🎉', '💯', '✅', '🫡',
  '⚓', '🚢', '🌊', '💡', '👀', '😮', '😢', '😡',
] as const

function isSingleEmoji(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 32) return false
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)]
  if (segments.length !== 1) return false
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3/u.test(trimmed)
}

export function MessageEmojiPicker({
  mode = 'insert',
  currentEmoji = null,
  triggerLabel,
  onSelect,
}: {
  mode?: 'insert' | 'reaction'
  currentEmoji?: string | null
  triggerLabel?: string
  onSelect: (emoji: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function choose(emoji: string) {
    onSelect(mode === 'reaction' && currentEmoji === emoji ? null : emoji)
    setOpen(false)
    setCustom('')
  }

  function chooseCustom() {
    const emoji = custom.trim()
    if (!isSingleEmoji(emoji)) return
    choose(emoji)
  }

  const accessibleTriggerLabel = triggerLabel ?? (mode === 'reaction' ? 'React to message' : 'Add emoji')

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={accessibleTriggerLabel}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={mode === 'reaction'
          ? 'grid size-8 place-items-center rounded-full border border-mist-100 bg-white text-muted shadow-sm transition hover:text-ocean-700'
          : 'grid size-10 place-items-center rounded-full text-navy-900 transition hover:bg-white'}
      >
        <Smile aria-hidden="true" className={mode === 'reaction' ? 'size-4' : 'size-5 text-ocean-700'} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={mode === 'reaction' ? 'Choose reaction emoji' : 'Choose emoji'}
          className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-2xl border border-mist-100 bg-white p-2 shadow-xl"
        >
          <div className="grid grid-cols-8 gap-1">
            {COMMON_EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={mode === 'reaction' ? `React with ${emoji}` : `Insert ${emoji}`}
                onClick={() => choose(emoji)}
                className={`grid size-8 place-items-center rounded-lg text-lg transition hover:bg-mist-50 ${currentEmoji === emoji ? 'bg-ocean-50 ring-1 ring-ocean-200' : ''}`}
              >
                {emoji}
              </button>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2 border-t border-mist-100 pt-2">
            <label className="sr-only" htmlFor={`custom-emoji-${mode}`}>
              {mode === 'reaction' ? 'Custom emoji reaction' : 'Custom emoji'}
            </label>
            <input
              id={`custom-emoji-${mode}`}
              aria-label={mode === 'reaction' ? 'Custom emoji reaction' : 'Custom emoji'}
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="Any emoji"
              maxLength={32}
              className="min-h-9 min-w-0 flex-1 rounded-xl border border-mist-100 px-3 text-sm outline-none focus:border-ocean-400"
            />
            <button
              type="button"
              aria-label={mode === 'reaction' ? 'Use custom emoji' : 'Insert custom emoji'}
              disabled={!isSingleEmoji(custom)}
              onClick={chooseCustom}
              className="min-h-9 rounded-xl bg-navy-950 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Use
            </button>
          </div>

          {mode === 'reaction' && currentEmoji ? (
            <button
              type="button"
              onClick={() => { onSelect(null); setOpen(false) }}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              <X aria-hidden="true" className="size-3.5" />
              Remove your reaction
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
