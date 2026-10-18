'use client'

import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

/**
 * The course player's layout preferences (learning round A7, reworked in round E):
 * - Focus mode hides the site's top navigation and the curriculum sidebar so the lesson uses the screen;
 *   the sidebar can be brought back while staying in focus mode.
 * - The sidebar can be collapsed into a slim rail on desktop.
 * Both are remembered in this browser only. While the player is open the site footer is hidden
 * (`html[data-learn-player]`, globals.css); focus mode also hides the top navigation (`html[data-learn-focus]`).
 */

const KEYS = {
  focus: 'sea-n-shore.learn.focus-mode',
  rail: 'sea-n-shore.learn.sidebar-rail',
  focusSidebar: 'sea-n-shore.learn.focus-sidebar',
} as const
type PrefKey = keyof typeof KEYS
const CHANGE_EVENT = 'sea-n-shore:player-prefs'

function read(key: PrefKey) {
  try {
    return window.localStorage.getItem(KEYS[key]) === 'on'
  } catch {
    // Storage can be unavailable (private windows); the preference then starts off.
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

export function usePlayerPref(key: PrefKey) {
  const value = useSyncExternalStore(subscribe, () => read(key), () => false)
  function set(next: boolean) {
    try {
      window.localStorage.setItem(KEYS[key], next ? 'on' : 'off')
    } catch {
      // Not remembered across visits; nothing else to do.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }
  return [value, set] as const
}

export function PlayerShell({ children, className = '', focusModeAvailable = true }: {
  children: ReactNode
  className?: string
  /**
   * S2: false on a full-height SCORM lesson, whose own Focus mode fills the whole window with the package.
   * The remembered page focus mode is then not applied there (it still applies on the other lessons).
   */
  focusModeAvailable?: boolean
}) {
  const [focusPref] = usePlayerPref('focus')
  const focus = focusModeAvailable && focusPref
  const [rail] = usePlayerPref('rail')
  const [focusSidebar] = usePlayerPref('focusSidebar')

  useEffect(() => {
    const root = document.documentElement
    root.dataset.learnPlayer = 'on'
    return () => {
      delete root.dataset.learnPlayer
      delete root.dataset.learnFocus
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (focus) root.dataset.learnFocus = 'on'
    else delete root.dataset.learnFocus
  }, [focus])

  // The sidebar shows unless focus mode hides it (and it was not brought back) or it is collapsed to the rail.
  const sidebar = focus && !focusSidebar ? 'hidden' : rail ? 'rail' : 'open'
  return (
    <div data-focus={focus ? 'on' : 'off'} data-sidebar={sidebar} className={`group/player ${className}`}>
      {children}
    </div>
  )
}

const toolbarButton = 'inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-semibold text-navy-800 transition hover:bg-mist-50'

export function FocusModeToggle() {
  const [focus, setFocus] = usePlayerPref('focus')
  return (
    <button type="button" aria-pressed={focus} onClick={() => setFocus(!focus)} className={toolbarButton}>
      {focus ? <Minimize2 aria-hidden="true" className="size-4" /> : <Maximize2 aria-hidden="true" className="size-4" />}
      {focus ? 'Exit focus mode' : 'Focus mode'}
    </button>
  )
}

/** In focus mode: show or hide the curriculum without leaving focus mode. */
export function FocusSidebarToggle() {
  const [focus] = usePlayerPref('focus')
  const [shown, setShown] = usePlayerPref('focusSidebar')
  if (!focus) return null
  return (
    <button type="button" aria-pressed={shown} onClick={() => setShown(!shown)} className={toolbarButton}>
      {shown ? <PanelLeftClose aria-hidden="true" className="size-4" /> : <PanelLeftOpen aria-hidden="true" className="size-4" />}
      {shown ? 'Hide curriculum' : 'Show curriculum'}
    </button>
  )
}

/** Desktop: collapse the curriculum sidebar into a slim rail, or expand it again. */
export function SidebarRailToggle({ collapsed, className = '' }: { collapsed: boolean; className?: string }) {
  const [, setRail] = usePlayerPref('rail')
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <button
      type="button"
      onClick={() => setRail(!collapsed)}
      aria-label={collapsed ? 'Expand the curriculum' : 'Collapse the curriculum'}
      title={collapsed ? 'Expand the curriculum' : 'Collapse the curriculum'}
      className={`grid size-10 cursor-pointer place-items-center rounded-xl text-navy-700 transition hover:bg-mist-100 ${className}`}
    >
      <Icon aria-hidden="true" className="size-5" />
    </button>
  )
}
