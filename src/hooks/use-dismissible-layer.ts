'use client'

import { useEffect, useRef } from 'react'

export function useDismissibleLayer<T extends HTMLElement>(
  open: boolean,
  onDismiss: () => void,
) {
  const rootRef = useRef<T | null>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      const root = rootRef.current
      if (root && !root.contains(event.target as Node)) onDismiss()
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onDismiss, open])

  return rootRef
}
