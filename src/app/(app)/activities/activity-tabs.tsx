'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

export type ActivityTabLink = { id: string; label: string; href: string }

/**
 * One underline tab bar for My Activities. Labels stay on one line; on narrow screens the bar
 * scrolls sideways (inside itself, never the page) and the current tab is scrolled into view.
 */
export function ActivityTabs({ tabs, activeId }: { tabs: readonly ActivityTabLink[]; activeId: string }) {
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!list || !active) return
    const overflowRight = active.offsetLeft + active.offsetWidth - (list.scrollLeft + list.clientWidth)
    const overflowLeft = list.scrollLeft - active.offsetLeft
    if (overflowRight > 0) list.scrollLeft += overflowRight + 16
    else if (overflowLeft > 0) list.scrollLeft -= overflowLeft + 16
  }, [activeId])

  return (
    <nav aria-label="Activity sections" className="mt-4 rounded-2xl border border-mist-100 bg-white px-1.5 shadow-[var(--shadow-card)] sm:px-2">
      <ul ref={listRef} className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = tab.id === activeId
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-12 cursor-pointer items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-ocean-600 ${active ? 'border-navy-950 text-navy-950' : 'border-transparent text-muted hover:border-mist-200 hover:text-navy-950'}`}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
