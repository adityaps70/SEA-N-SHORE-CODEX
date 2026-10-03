'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

export type ActivityTabLink = { id: string; label: string; href: string }

/**
 * One underline tab bar for My Activities. Labels stay on one line; on narrow screens the bar
 * scrolls sideways (inside itself, never the page) and the current tab is scrolled into view.
 * Phones (round 8) show the same links as a chip row: selected = navy-950 filled.
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
    <nav aria-label="Activity sections" className="mt-4 rounded-2xl border border-mist-100 bg-white px-1.5 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:mt-0 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:shadow-none sm:px-2">
      <ul ref={listRef} className="flex overflow-x-auto [scrollbar-width:none] max-md:gap-2 max-md:px-4 max-md:py-1 [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = tab.id === activeId
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-12 cursor-pointer items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-ocean-600 max-md:min-h-9 max-md:rounded-full max-md:border max-md:px-3.5 max-md:focus-visible:outline-offset-2 ${active ? 'border-navy-950 text-navy-950 max-md:bg-navy-950 max-md:text-white' : 'border-transparent text-muted hover:border-mist-200 hover:text-navy-950 max-md:border-mist-300 max-md:bg-white max-md:text-navy-900'}`}
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
