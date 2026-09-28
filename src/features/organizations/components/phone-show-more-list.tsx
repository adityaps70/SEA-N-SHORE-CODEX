'use client'

import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

/**
 * A list that shows its first `initial` items on phones with a "See more" button for the rest.
 * From `md` up every item is always shown and the button is hidden, so desktop is unchanged.
 */
export function PhoneShowMoreList({
  items,
  initial = 3,
  className = '',
  itemClassName = 'min-w-0',
  moreLabel = 'See more',
}: {
  items: { key: string; node: ReactNode }[]
  initial?: number
  className?: string
  itemClassName?: string
  moreLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const hiddenCount = expanded ? 0 : Math.max(0, items.length - initial)
  return (
    <>
      <ul className={className}>
        {items.map((item, index) => (
          <li key={item.key} className={`${itemClassName} ${!expanded && index >= initial ? 'max-md:hidden' : ''}`}>
            {item.node}
          </li>
        ))}
      </ul>
      {hiddenCount ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-ocean-700 bg-white text-[15px] font-semibold text-ocean-700 hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 md:hidden"
        >
          {moreLabel} <span className="sr-only">({hiddenCount} more)</span>
          <ChevronDown aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </>
  )
}
