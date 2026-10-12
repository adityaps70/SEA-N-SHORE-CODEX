'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * The rail footer's "More" disclosure (round F, F4): a button with aria-expanded that opens the
 * full link list below itself, in the page flow, and closes on Escape (focus returns to the button).
 */
export function RailFooterMore({ className, children }: { className: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    // The list opens downward; bring it into view inside the rail (or the page) without jumping.
    panelRef.current?.scrollIntoView?.({ block: 'nearest' })
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <div className="mt-0.5">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`${className} cursor-pointer gap-0.5`}
      >
        More
        <ChevronDown size={12} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      <div ref={panelRef} id={panelId} hidden={!open} data-rail-footer-more="" className="mt-2 grid gap-3 text-left">
        {children}
      </div>
    </div>
  )
}
