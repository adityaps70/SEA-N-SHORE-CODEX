'use client'

import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Centered modal used by the feed share and confirmation flows.
 * Escape and the backdrop close it; focus moves inside on open, is kept inside while
 * tabbing, and returns to the element that opened it.
 */
export function FeedDialog({
  title,
  description,
  onClose,
  children,
  role = 'dialog',
  closeLabel = 'Close',
  size = 'md',
  initialFocusSelector,
  returnFocusRef,
}: {
  title: string
  description?: ReactNode
  onClose(): void
  children: ReactNode
  role?: 'dialog' | 'alertdialog'
  closeLabel?: string
  size?: 'sm' | 'md'
  /** CSS selector (inside the dialog) for the element that should receive focus first. */
  initialFocusSelector?: string
  /** Where focus goes on close when the opener (e.g. a menu item) no longer exists. */
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null
    const fallbackFocus = returnFocusRef
    const panel = panelRef.current
    const preferred = initialFocusSelector ? panel?.querySelector<HTMLElement>(initialFocusSelector) : null
    const target = preferred ?? panel?.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // A nested popover (emoji or mention list) already handled this Escape.
        if (event.defaultPrevented) return
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
      else fallbackFocus?.current?.focus()
    }
  }, [initialFocusSelector, returnFocusRef])

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-navy-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-[1.5rem] border border-mist-100 bg-white p-5 shadow-2xl sm:rounded-[1.5rem] sm:p-6 ${size === 'sm' ? 'sm:max-w-sm' : 'sm:max-w-lg'}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-navy-950">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-sm leading-6 text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-mist-50 hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
