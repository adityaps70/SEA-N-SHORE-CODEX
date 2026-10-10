'use client'

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { BookOpen, Megaphone } from 'lucide-react'

/**
 * Learning round C (C5b): the player's "Lesson" and "Announcements" tabs (WAI-ARIA tabs, automatic activation).
 * Both panels are rendered on the server; switching keeps the URL in step (?tab=announcements) without reloading,
 * so the link in an announcement email opens the right tab. Leaving the lesson pauses its video or audio.
 */

export type PlayerTab = 'lesson' | 'announcements'

const TABS: Array<{ id: PlayerTab; label: string }> = [
  { id: 'lesson', label: 'Lesson' },
  { id: 'announcements', label: 'Announcements' },
]

export function PlayerTabs({
  initialTab = 'lesson',
  announcementCount,
  lesson,
  announcements,
}: {
  initialTab?: PlayerTab
  announcementCount: number
  lesson: ReactNode
  announcements: ReactNode
}) {
  const [active, setActive] = useState<PlayerTab>(initialTab)
  const baseId = useId()
  const tabRefs = useRef<Record<PlayerTab, HTMLButtonElement | null>>({ lesson: null, announcements: null })
  const lessonPanelRef = useRef<HTMLDivElement | null>(null)

  function select(tab: PlayerTab, focus = false) {
    if (tab !== active && active === 'lesson') {
      lessonPanelRef.current?.querySelectorAll('video, audio').forEach((media) => (media as HTMLMediaElement).pause?.())
    }
    setActive(tab)
    if (focus) tabRefs.current[tab]?.focus()
    try {
      const url = new URL(window.location.href)
      if (tab === 'announcements') url.searchParams.set('tab', 'announcements')
      else url.searchParams.delete('tab')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    } catch {
      // The tab still switches when the address cannot be updated.
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.findIndex((tab) => tab.id === active)
    let next: number | null = null
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = TABS.length - 1
    if (next === null) return
    event.preventDefault()
    select(TABS[next]!.id, true)
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Course player"
        className="mb-4 flex gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm max-md:-mx-4 max-md:mb-0 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:px-4 max-md:py-2 max-md:shadow-none"
      >
        {TABS.map((tab) => {
          const selected = tab.id === active
          const Icon = tab.id === 'lesson' ? BookOpen : Megaphone
          return (
            <button
              key={tab.id}
              ref={(element) => { tabRefs.current[tab.id] = element }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.id)}
              onKeyDown={onKeyDown}
              className={`inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 sm:flex-none ${selected ? 'bg-slate-950 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              <Icon aria-hidden="true" className="size-4" />
              {tab.label}
              {tab.id === 'announcements' && announcementCount > 0 ? (
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${selected ? 'bg-white/20 text-white' : 'bg-teal-50 text-teal-800'}`}>
                  <span className="sr-only">(</span>{announcementCount}<span className="sr-only">)</span>
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <div
        ref={lessonPanelRef}
        role="tabpanel"
        id={`${baseId}-panel-lesson`}
        aria-labelledby={`${baseId}-tab-lesson`}
        hidden={active !== 'lesson'}
      >
        {lesson}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-announcements`}
        aria-labelledby={`${baseId}-tab-announcements`}
        hidden={active !== 'announcements'}
        tabIndex={0}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 rounded-3xl"
      >
        {announcements}
      </div>
    </div>
  )
}
