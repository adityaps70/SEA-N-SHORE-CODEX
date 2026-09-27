'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useDismissibleLayer } from '@/hooks/use-dismissible-layer'

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])'

/**
 * Popover-menu state shared by the post overflow menu and the share menu.
 * Closes on outside pointer, Escape (returning focus to the trigger) and route change,
 * and supports arrow-key navigation between menu items.
 */
export function useFeedMenu(externalTriggerRef?: RefObject<HTMLButtonElement | null>) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const [openedPath, setOpenedPath] = useState(pathname)
  const internalTriggerRef = useRef<HTMLButtonElement | null>(null)
  const triggerRef = externalTriggerRef ?? internalTriggerRef
  const menuRef = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => setOpen(false), [])
  const rootRef = useDismissibleLayer<HTMLDivElement>(open, close)

  if (openedPath !== pathname) {
    setOpenedPath(pathname)
    if (open) setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const first = menuRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)
    first?.focus()
  }, [open])

  const toggle = useCallback(() => setOpen((current) => !current), [])

  const closeAndFocusTrigger = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [triggerRef])

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])]
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAndFocusTrigger()
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (!items.length) return
    const index = items.indexOf(document.activeElement as HTMLElement)
    let next: HTMLElement | undefined
    if (event.key === 'ArrowDown') next = items[(index + 1) % items.length]
    else if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length]
    else if (event.key === 'Home') next = items[0]
    else if (event.key === 'End') next = items[items.length - 1]
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  return { open, setOpen, toggle, close, closeAndFocusTrigger, rootRef, triggerRef, menuRef, onMenuKeyDown }
}
