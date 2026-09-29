'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { useDismissibleLayer } from '@/hooks/use-dismissible-layer'
import { MobileSheetBackdrop, MobileSheetCancel, MobileSheetGrab, SHEET_MENU_ITEM_CLASS, SHEET_MENU_PANEL_CLASS } from './mobile-sheet'

/**
 * The one "…" menu. The panel is rendered in a portal at the end of <body> and positioned
 * against its trigger with `position: fixed`, so it is never clipped by an `overflow-hidden`
 * card or list and never trapped in an ancestor's stacking context. It opens below the
 * trigger, flips above when there is no room below, and is kept inside the viewport
 * horizontally. On phones (below md) the same panel becomes the bottom sheet from
 * mobile-sheet.tsx, with a backdrop, grab handle and Cancel row.
 *
 * Dismissal (outside press, Escape with focus back on the trigger, focus leaving, route
 * change, another layer opening) comes from useDismissibleLayer; arrow keys move between items.
 */
export type ActionMenuAlign = 'start' | 'center' | 'end'
export type ActionMenuSide = 'bottom' | 'top'

export type MenuPosition = {
  side: ActionMenuSide
  /** Distance from the viewport's top edge when the menu opens below the trigger. */
  top?: number
  /** Distance from the viewport's bottom edge when the menu is flipped above the trigger. */
  bottom?: number
  left: number
  /** Room the panel may use before it would leave the viewport; a tall menu scrolls inside it. */
  maxHeight: number
}

export const MENU_VIEWPORT_MARGIN = 8
export const MENU_GAP = 6

type Rect = { top: number; bottom: number; left: number; right: number; width: number; height: number }

/**
 * Where to put a panel of `panel` size next to `anchor` inside a `viewport` (both in viewport
 * coordinates). Pure, so the flip and clamp rules are unit-tested without a browser.
 */
export function computeMenuPosition({
  anchor,
  panel,
  viewport,
  align = 'end',
  preferredSide = 'bottom',
  gap = MENU_GAP,
  margin = MENU_VIEWPORT_MARGIN,
}: {
  anchor: Rect
  panel: { width: number; height: number }
  viewport: { width: number; height: number }
  align?: ActionMenuAlign
  preferredSide?: ActionMenuSide
  gap?: number
  margin?: number
}): MenuPosition {
  const roomBelow = viewport.height - anchor.bottom - gap - margin
  const roomAbove = anchor.top - gap - margin
  const fitsBelow = panel.height <= roomBelow
  const fitsAbove = panel.height <= roomAbove
  let side: ActionMenuSide
  if (preferredSide === 'bottom') side = fitsBelow || (!fitsAbove && roomBelow >= roomAbove) ? 'bottom' : 'top'
  else side = fitsAbove || (!fitsBelow && roomAbove >= roomBelow) ? 'top' : 'bottom'

  const rawLeft = align === 'end' ? anchor.right - panel.width : align === 'center' ? anchor.left + anchor.width / 2 - panel.width / 2 : anchor.left
  const maxLeft = Math.max(margin, viewport.width - margin - panel.width)
  const left = Math.min(Math.max(margin, rawLeft), maxLeft)

  if (side === 'bottom') {
    return { side, top: anchor.bottom + gap, left, maxHeight: Math.max(0, roomBelow) }
  }
  return { side, bottom: viewport.height - anchor.top + gap, left, maxHeight: Math.max(0, roomAbove) }
}

function subscribeNever() {
  return () => {}
}

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])'

/** Enabled items that are shown at this screen size (phone-only rows are display:none on desktop). */
export function visibleMenuItems(menu: HTMLElement | null) {
  return Array.from(menu?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])
    .filter((item) => typeof window === 'undefined' || window.getComputedStyle(item).display !== 'none')
}

export function ActionMenu({
  open,
  onClose,
  anchorRef,
  label,
  id,
  align = 'end',
  side = 'bottom',
  initialFocus = 'first',
  cancelLabel = 'Cancel',
  className,
  children,
  onKeyDown,
}: {
  open: boolean
  onClose(): void
  /** The trigger button (or the element the panel should hang from). */
  anchorRef: RefObject<HTMLElement | null>
  /** Accessible name of the menu. */
  label: string
  id?: string
  /** Which edge of the trigger the panel lines up with on desktop (or centred under it). */
  align?: ActionMenuAlign
  /** Preferred side; the panel flips when there is no room. */
  side?: ActionMenuSide
  /** Which item receives focus when the menu opens. */
  initialFocus?: 'first' | 'last' | 'none'
  cancelLabel?: string
  /** Extra classes for the panel, e.g. a width (`w-56`). */
  className?: string
  children: ReactNode
  onKeyDown?(event: KeyboardEvent<HTMLDivElement>): void
}) {
  const generatedId = useId()
  const menuId = id ?? generatedId
  const panelRef = useDismissibleLayer<HTMLDivElement>(open, onClose, { triggerRef: anchorRef, within: [anchorRef] })
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false)

  const place = useCallback(() => {
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (!anchor || !panel) return
    const rect = anchor.getBoundingClientRect()
    setPosition(computeMenuPosition({
      anchor: rect,
      panel: { width: panel.offsetWidth, height: panel.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      align,
      preferredSide: side,
    }))
  }, [align, anchorRef, panelRef, side])

  // Measure and place before the first paint, then follow scrolling and resizing.
  useLayoutEffect(() => {
    if (!open) return
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  useEffect(() => {
    if (!open || initialFocus === 'none') return
    const items = visibleMenuItems(panelRef.current)
    items[initialFocus === 'first' ? 0 : items.length - 1]?.focus()
  }, [open, initialFocus, panelRef])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    const items = visibleMenuItems(panelRef.current)
    if (!items.length) return
    const index = items.indexOf(document.activeElement as HTMLElement)
    let next: HTMLElement | undefined
    if (event.key === 'ArrowDown') next = items[index < 0 ? 0 : (index + 1) % items.length]
    else if (event.key === 'ArrowUp') next = items[index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length]
    else if (event.key === 'Home') next = items[0]
    else if (event.key === 'End') next = items[items.length - 1]
    else if (event.key === 'Tab') {
      onClose()
      return
    }
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  if (!open || !mounted) return null

  // Until the layout effect has measured this opening, keep the panel out of sight (it is placed before paint).
  const style: CSSProperties = position
    ? { top: position.top, bottom: position.bottom, left: position.left, maxHeight: position.maxHeight }
    : { top: 0, left: 0, visibility: 'hidden' }

  const panel = (
    <>
      <MobileSheetBackdrop onClose={onClose} />
      <div
        ref={panelRef}
        id={menuId}
        role="menu"
        aria-label={label}
        data-side={position?.side ?? side}
        data-action-menu=""
        style={style}
        onKeyDown={handleKeyDown}
        className={cn(
          'fixed z-[70] min-w-48 overflow-y-auto rounded-xl border border-mist-100 bg-white p-1.5 shadow-xl md:motion-safe:animate-[menu-in_120ms_ease-out]',
          className,
          SHEET_MENU_PANEL_CLASS,
        )}
      >
        <MobileSheetGrab />
        {children}
        <MobileSheetCancel
          onClick={() => {
            onClose()
            anchorRef.current?.focus()
          }}
          label={cancelLabel}
        />
      </div>
    </>
  )
  return createPortal(panel, document.body)
}

/** A menu row: icon + label. `tone="danger"` for Block, Delete, Report. */
export function ActionMenuItem({
  icon,
  tone = 'default',
  className,
  children,
  ...props
}: {
  icon?: ReactNode
  tone?: 'default' | 'danger'
  children: ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      role="menuitem"
      {...props}
      className={cn(
        'flex min-h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
        tone === 'danger' ? 'text-red-700 hover:bg-red-50 focus-visible:bg-red-50' : 'text-navy-950 hover:bg-mist-50 focus-visible:bg-mist-50',
        SHEET_MENU_ITEM_CLASS,
        className,
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  )
}

/** A hairline between groups of rows; hidden on phones where rows are tall enough already. */
export function ActionMenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-mist-100 max-md:hidden" />
}
