'use client'

import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'

/** Fired by in-page links (e.g. the "…" menu's "Request to join") so a collapsed phone row opens. */
export const ORGANIZATION_ANCHOR_EVENT = 'sns:organization-anchor'

/**
 * Phones only: shows `summary` as one tappable row and keeps `children` collapsed until it is
 * tapped (or the page is opened at `#anchorId`). From `md` up the row is hidden and the content
 * is always shown, so desktop renders exactly as before.
 */
export function PhoneDisclosure({
  summary,
  anchorId,
  children,
  panelClassName = '',
  defaultOpen = false,
}: {
  summary: ReactNode
  /** The id of the section this row stands for; opening the page at #anchorId expands it. */
  anchorId?: string
  children: ReactNode
  panelClassName?: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  useEffect(() => {
    if (!anchorId) return
    const target = `#${anchorId}`
    function check(hash: string | null | undefined) {
      if (hash === target) setOpen(true)
    }
    check(window.location.hash)
    const onHash = () => check(window.location.hash)
    const onAnchor = (event: Event) => check((event as CustomEvent<string>).detail)
    window.addEventListener('hashchange', onHash)
    window.addEventListener(ORGANIZATION_ANCHOR_EVENT, onAnchor)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener(ORGANIZATION_ANCHOR_EVENT, onAnchor)
    }
  }, [anchorId])

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 text-left text-[15px] text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500 md:hidden"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3 [&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-navy-700">{summary}</span>
        <ChevronRight aria-hidden="true" className={`size-5 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <div id={panelId} className={`${open ? '' : 'max-md:hidden'} ${panelClassName}`}>
        {children}
      </div>
    </>
  )
}
