'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'

const STORAGE_KEY = 'sea-n-shore.learn.focus-mode'
const CHANGE_EVENT = 'sea-n-shore:focus-mode'

function readFocus() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    // Storage can be unavailable (private windows); focus mode then simply starts off.
    return false
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

/**
 * Focus mode for the course player (learning round A, A7): hides the course card and the
 * curriculum column so the material takes the full width. Desktop only (phones already show one
 * thing at a time). Remembered in this browser only.
 */
export function PlayerFocusShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  const focus = useSyncExternalStore(subscribe, readFocus, () => false)

  function toggle() {
    try {
      window.localStorage.setItem(STORAGE_KEY, focus ? 'off' : 'on')
    } catch {
      // Not remembered across visits; nothing else to do.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }

  return (
    <div data-focus={focus ? 'on' : 'off'} className={`group/player ${className}`}>
      <div className="mb-3 flex justify-end max-md:hidden">
        <button
          type="button"
          aria-pressed={focus}
          onClick={toggle}
          className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
        >
          {focus ? <Minimize2 aria-hidden="true" className="size-4" /> : <Maximize2 aria-hidden="true" className="size-4" />}
          {focus ? 'Exit focus mode' : 'Focus mode'}
        </button>
      </div>
      {children}
    </div>
  )
}
