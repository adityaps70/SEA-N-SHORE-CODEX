'use client'

import { X } from 'lucide-react'
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Phone bottom sheets (round 8 mobile redesign).
 *
 * Two ways to use this module:
 *
 * 1. `SHEET_MENU_PANEL_CLASS` + `MobileSheetBackdrop` / `MobileSheetGrab` / `MobileSheetCancel`
 *    turn an existing absolutely-positioned dropdown into a bottom sheet below the `md`
 *    breakpoint while leaving the desktop dropdown exactly as it was. Append the panel class to
 *    the dropdown's own classes, render the backdrop next to it and the grab/cancel inside it.
 *
 * 2. `<BottomSheet>` is a complete sheet for new phone surfaces (Create sheet, All filters,
 *    course curriculum). On `md` and wider it renders as a centred dialog unless
 *    `desktop="hidden"` is passed.
 */

/** Classes that re-shape a dropdown panel into a bottom sheet on phones only. */
export const SHEET_MENU_PANEL_CLASS =
  'max-md:!fixed max-md:!inset-x-0 max-md:!bottom-0 max-md:!top-auto max-md:!left-0 max-md:!right-0 max-md:!mt-0 max-md:!w-full max-md:!max-w-none max-md:max-h-[85dvh] max-md:overflow-y-auto max-md:!rounded-b-none max-md:!rounded-t-3xl max-md:!border-x-0 max-md:!border-b-0 max-md:!p-2 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-md:z-[70] max-md:shadow-[0_-12px_32px_rgb(7_27_45/0.18)]'

/** Row classes for sheet menu items: 52px tall touch rows on phones, unchanged on desktop. */
export const SHEET_MENU_ITEM_CLASS = 'max-md:min-h-13 max-md:gap-4 max-md:px-4 max-md:text-[15px] max-md:[&>svg]:size-5'

export function MobileSheetBackdrop({ onClose }: { onClose(): void }) {
  return <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-[65] bg-navy-950/50 md:hidden" />
}

export function MobileSheetGrab() {
  return <span aria-hidden="true" className="mx-auto mb-2 mt-1 block h-1 w-10 rounded-full bg-mist-300 md:hidden" />
}

export function MobileSheetCancel({ onClick, label = 'Cancel' }: { onClick(): void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 flex min-h-12 w-full cursor-pointer items-center justify-center rounded-full border border-mist-300 text-[15px] font-semibold text-navy-700 transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 md:hidden"
    >
      {label}
    </button>
  )
}

function subscribeNever() {
  return () => {}
}

/** Locks page scroll while a sheet is open (restores the previous value on close). */
export function useSheetScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  desktop = 'dialog',
  fullHeight = false,
  portal = true,
  className = '',
}: {
  open: boolean
  onClose(): void
  title?: ReactNode
  children: ReactNode
  /** Sticky footer (e.g. "Show 42 results"). */
  footer?: ReactNode
  /** How the sheet shows on md and wider screens. */
  desktop?: 'dialog' | 'hidden'
  /** Full-screen sheet on phones (All filters). */
  fullHeight?: boolean
  /** false keeps the sheet in place, e.g. when its buttons must submit a surrounding <form>. */
  portal?: boolean
  className?: string
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  useSheetScrollLock(open)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [open, onClose])

  // true only after hydration, so the first client render matches the server markup
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false)
  if (!open) return null
  const hiddenOnDesktop = desktop === 'hidden' ? 'md:hidden' : ''
  const phoneShape = fullHeight
    ? 'inset-0 rounded-none'
    : 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-3xl'
  const sheet = (
    <div className={`fixed inset-0 z-[70] ${hiddenOnDesktop}`}>
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-navy-950/50 motion-safe:animate-[sheet-fade_200ms_ease-out]" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`absolute flex flex-col bg-white shadow-[0_-12px_32px_rgb(7_27_45/0.18)] outline-none motion-safe:animate-[sheet-up_250ms_cubic-bezier(0.22,1,0.36,1)] ${phoneShape} md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[85vh] md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:motion-safe:animate-none ${className}`}
      >
        {fullHeight ? null : <MobileSheetGrab />}
        {title ? (
          <div className={`flex min-h-12 items-center justify-between gap-3 px-5 ${fullHeight ? 'min-h-14 border-b border-mist-100 pt-[env(safe-area-inset-top)]' : 'pt-1'}`}>
            <h2 id={titleId} className="text-[17px] font-bold text-navy-950">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-10 cursor-pointer place-items-center rounded-full text-navy-700 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">{children}</div>
        {footer ? (
          <div className="border-t border-mist-100 bg-white px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_18px_rgb(7_27_45/0.08)]">{footer}</div>
        ) : (
          <div className="pb-[env(safe-area-inset-bottom)]" />
        )}
      </div>
    </div>
  )
  // Rendered at the end of <body> so a sheet opened from a sticky bar is never trapped under the tab bar.
  return portal && mounted ? createPortal(sheet, document.body) : sheet
}

/** A 56px sheet row: icon + label (+ optional hint on the right). */
export function SheetRow({
  icon,
  label,
  hint,
  tone = 'default',
  ...props
}: {
  icon: ReactNode
  label: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'danger'
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const toneClass = tone === 'danger' ? 'text-red-700 hover:bg-red-50' : 'text-navy-950 hover:bg-mist-50'
  return (
    <button
      type="button"
      {...props}
      className={`flex min-h-14 w-full cursor-pointer items-center gap-4 rounded-2xl px-4 text-left text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 disabled:opacity-50 [&>svg]:size-5 [&>svg]:shrink-0 ${toneClass} ${props.className ?? ''}`}
    >
      {icon}
      <span className="min-w-0 flex-1">{label}</span>
      {hint ? <span className="text-xs font-medium text-muted">{hint}</span> : null}
    </button>
  )
}
