'use client'

import Link from 'next/link'
import { useRef, type KeyboardEvent } from 'react'

export type OrganizationTabLink = { id: string; label: string; href: string }

/**
 * Section tabs of the organization page. Each tab is a real link (?tab=…) so it
 * can be shared and opened in a new tab; Left/Right/Home/End move between tabs.
 */
export function OrganizationPageTabs({
  tabs,
  active,
  label,
}: {
  tabs: OrganizationTabLink[]
  active: string
  label: string
}) {
  const listRef = useRef<HTMLUListElement | null>(null)

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const links = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])
    const index = links.indexOf(document.activeElement as HTMLAnchorElement)
    if (index < 0) return
    let next: number | null = null
    if (event.key === 'ArrowRight') next = (index + 1) % links.length
    if (event.key === 'ArrowLeft') next = (index - 1 + links.length) % links.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = links.length - 1
    if (next === null) return
    event.preventDefault()
    links[next]?.focus()
    links[next]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }

  return (
    <nav aria-label={label} className="min-w-0">
      <ul ref={listRef} onKeyDown={onKeyDown} className="-mb-px flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => {
          const current = tab.id === active
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                href={tab.href}
                scroll={false}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex min-h-11 cursor-pointer items-center border-b-2 px-3 text-sm font-semibold transition focus-visible:rounded-t-lg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500 ${current
                  ? 'border-ocean-700 text-ocean-800'
                  : 'border-transparent text-muted hover:border-mist-200 hover:bg-mist-50 hover:text-navy-950'}`}
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
