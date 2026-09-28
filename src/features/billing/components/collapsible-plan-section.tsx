'use client'

import { Crown } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A plan shown as a one-line summary card until the member asks for it. Used on
 * Membership & billing so the personal Creator Pro checkout does not push Organization
 * Pro down the page. The full plan panel (children) is rendered only once opened.
 */
export function CollapsiblePlanSection({
  anchorId,
  eyebrow,
  title,
  statusLabel,
  summary,
  priceLine = null,
  openLabel,
  defaultOpen = false,
  children,
}: {
  /** The summary card's id; the opened panel carries its own. */
  anchorId: string
  eyebrow: string
  title: string
  statusLabel: string
  summary: string
  priceLine?: string | null
  /** Button text, e.g. "Get Creator Pro" or "Manage Creator Pro". */
  openLabel: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [focusPanel, setFocusPanel] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // The button disappears when the panel opens, so move focus to the panel itself.
  useLayoutEffect(() => {
    if (open && focusPanel) panelRef.current?.focus()
  }, [open, focusPanel])

  if (open) {
    return (
      <div ref={panelRef} tabIndex={-1} className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40">
        {children}
      </div>
    )
  }

  return (
    <section
      id={anchorId}
      aria-labelledby={titleId}
      className="scroll-mt-24 rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
            <Crown aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{eyebrow}</p>
            <h2 id={titleId} className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold text-navy-950">
              {title}
              <span className="inline-flex items-center rounded-full bg-mist-100 px-2.5 py-0.5 text-xs font-bold text-navy-800">{statusLabel}</span>
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">{summary}</p>
            {priceLine ? <p className="mt-0.5 text-sm font-semibold text-navy-900">{priceLine}</p> : null}
          </div>
        </div>
        <button
          type="button"
          aria-expanded={false}
          onClick={() => {
            setFocusPanel(true)
            setOpen(true)
          }}
          className="inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center rounded-xl border border-teal-200 bg-white px-4 text-sm font-bold text-teal-800 transition hover:border-teal-300 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 sm:w-auto"
        >
          {openLabel}
        </button>
      </div>
    </section>
  )
}
