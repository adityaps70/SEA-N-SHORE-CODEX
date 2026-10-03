'use client'

import * as navigation from 'next/navigation'
import { useEffect, useId, useRef, type RefObject } from 'react'

/**
 * usePathname, or a no-op when it is unavailable (component tests that mock
 * next/navigation with only useRouter). In the app it is always the real hook.
 */
const usePathnameIfAvailable: () => string | null = (() => {
  try {
    return typeof navigation.usePathname === 'function' ? navigation.usePathname : () => null
  } catch {
    return () => null
  }
})()

/**
 * Broadcast when any dismissible layer opens so every other open layer closes.
 * This keeps a single header menu, popover or dropdown open at a time, including
 * when the second one is opened from the keyboard (no outside pointer event).
 */
export const LAYER_OPEN_EVENT = 'sns:dismissible-layer-open'

export type DismissReason = 'outside' | 'escape' | 'route' | 'focus' | 'other-layer'

type DismissibleLayerOptions = {
  /** Element that opened the layer; focus returns here after Escape. Defaults to the first `[aria-expanded]` element inside the root. */
  triggerRef?: RefObject<HTMLElement | null>
  /** Close when keyboard focus moves outside the layer (Tab away). Default true. */
  closeOnFocusOut?: boolean
  /**
   * Extra elements that count as inside the layer, for a panel rendered in a portal away from
   * its trigger: a press or focus inside any of them does not dismiss.
   */
  within?: RefObject<HTMLElement | null>[]
}

function findTrigger(root: HTMLElement | null, triggerRef?: RefObject<HTMLElement | null>) {
  return triggerRef?.current ?? root?.querySelector<HTMLElement>('[aria-expanded]') ?? null
}

/**
 * Shared behaviour for menus, popovers and dropdowns:
 * - closes on a pointer press outside the layer,
 * - closes on Escape and returns focus to the trigger,
 * - closes when keyboard focus leaves the layer,
 * - closes when the route (pathname) changes,
 * - closes when another dismissible layer opens.
 *
 * Attach the returned ref to the element that wraps both the trigger and the panel.
 */
export function useDismissibleLayer<T extends HTMLElement>(
  open: boolean,
  onDismiss: (reason?: DismissReason) => void,
  options: DismissibleLayerOptions = {},
) {
  const rootRef = useRef<T | null>(null)
  const layerId = useId()
  const pathname = usePathnameIfAvailable()
  const lastPathnameRef = useRef(pathname)
  const onDismissRef = useRef(onDismiss)
  const { triggerRef, closeOnFocusOut = true, within } = options
  const withinRef = useRef(within)

  useEffect(() => {
    onDismissRef.current = onDismiss
    withinRef.current = within
  })

  useEffect(() => {
    if (!open) return

    const dismiss = (reason: DismissReason) => onDismissRef.current(reason)

    document.dispatchEvent(new CustomEvent(LAYER_OPEN_EVENT, { detail: layerId }))

    function onOtherLayerOpened(event: Event) {
      if ((event as CustomEvent<string>).detail !== layerId) dismiss('other-layer')
    }

    function inside(target: EventTarget | null) {
      if (!(target instanceof Node)) return false
      const root = rootRef.current
      if (root?.contains(target)) return true
      return (withinRef.current ?? []).some((ref) => ref.current?.contains(target))
    }

    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !inside(event.target)) dismiss('outside')
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      dismiss('escape')
      findTrigger(rootRef.current, triggerRef)?.focus()
    }

    function onFocusOut(event: FocusEvent) {
      const root = rootRef.current
      const next = event.relatedTarget
      // relatedTarget is null when focus goes to a non-focusable area; the
      // pointerdown handler covers that case.
      if (root && next instanceof Node && !inside(next)) dismiss('focus')
    }

    const root = rootRef.current
    document.addEventListener(LAYER_OPEN_EVENT, onOtherLayerOpened)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    if (closeOnFocusOut) root?.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener(LAYER_OPEN_EVENT, onOtherLayerOpened)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      root?.removeEventListener('focusout', onFocusOut)
    }
  }, [closeOnFocusOut, layerId, open, triggerRef])

  useEffect(() => {
    if (lastPathnameRef.current === pathname) return
    lastPathnameRef.current = pathname
    if (open) onDismissRef.current('route')
  }, [open, pathname])

  return rootRef
}
