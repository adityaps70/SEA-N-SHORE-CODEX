'use client'

import { Smile } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const EMOJI = ['😀', '😊', '👏', '🙏', '👍', '❤️', '🫡', '⚓', '🌊', '🚢', '🎉', '💡', '✅'] as const

export function EmojiPicker({ onSelect }: { onSelect(emoji: string): void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button type="button" aria-label="Emoji" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-navy-900 hover:bg-mist-50">
        <Smile aria-hidden="true" className="size-5 text-ocean-700" />
        Emoji
      </button>
      {open ? (
        <div role="menu" aria-label="Choose emoji" className="absolute bottom-full left-0 z-40 mb-2 grid grid-cols-5 gap-1 rounded-2xl border border-mist-100 bg-white p-2 shadow-xl">
          {EMOJI.map((emoji) => (
            <button key={emoji} type="button" role="menuitem" aria-label={`Insert ${emoji}`} onClick={() => { onSelect(emoji); setOpen(false) }} className="grid size-10 place-items-center rounded-xl text-xl hover:bg-mist-50">
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
