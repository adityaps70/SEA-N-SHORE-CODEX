'use client'

import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableWithin(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => !element.hasAttribute('inert') && element.getAttribute('aria-hidden') !== 'true')
}

/**
 * Shared behaviour for the messaging overlays (new-message dialog and photo
 * viewer): moves focus inside, keeps Tab inside, closes on Escape, locks page
 * scrolling without changing the scroll position, and returns focus to the
 * element that opened it without scrolling anything. The element marked with
 * `data-autofocus` receives focus first; otherwise the first focusable one.
 * Mount the component using this hook only while the layer is open.
 */
export function useModalLayer<T extends HTMLElement>(input: { onClose: () => void }) {
  const containerRef = useRef<T | null>(null)
  const onCloseRef = useRef(input.onClose)

  useEffect(() => {
    onCloseRef.current = input.onClose
  }, [input.onClose])

  useEffect(() => {
    const container = containerRef.current
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = document.documentElement
    const previousOverflow = root.style.overflow
    root.style.overflow = 'hidden'

    const initial = container?.querySelector<HTMLElement>('[data-autofocus]')
      ?? (container ? focusableWithin(container)[0] : null)
      ?? container
    initial?.focus({ preventScroll: true })

    function onKeyDown(event: KeyboardEvent) {
      const current = containerRef.current
      if (!current) return

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab') return
      const focusable = focusableWithin(current)
      if (!focusable.length) {
        event.preventDefault()
        current.focus({ preventScroll: true })
        return
      }
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const active = document.activeElement
      const outside = !active || !current.contains(active)
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      root.style.overflow = previousOverflow
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [])

  return containerRef
}
