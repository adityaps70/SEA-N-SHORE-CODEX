'use client'

import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

/**
 * Phones only: keeps the past events section behind a "Show past events" button so upcoming
 * events come first. From `md` up the section is always shown and the button is hidden.
 */
export function PastEventsToggle({ children, label = 'Show past events' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <>
      {open ? null : (
        <button
          type="button"
          aria-expanded={false}
          aria-controls={panelId}
          onClick={() => setOpen(true)}
          className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full text-[15px] font-semibold text-navy-700 hover:bg-mist-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 md:hidden"
        >
          {label}
          <ChevronDown aria-hidden="true" className="size-4" />
        </button>
      )}
      <div id={panelId} className={open ? '' : 'max-md:hidden'}>
        {children}
      </div>
    </>
  )
}
