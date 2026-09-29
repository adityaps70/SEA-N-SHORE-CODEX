'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const noopSubscribe = () => () => {}

/**
 * Renders a sheet or dialog at the end of <body>. Sheets opened from inside a sticky bar
 * (MobilePageBar is sticky z-30, the decision bars are sticky z-20) would otherwise be trapped in
 * that bar's stacking context and sit underneath the phone tab bar (z-40).
 */
export function SheetPortal({ children }: { children: ReactNode }) {
  // True on the client, false during server rendering (no document there).
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)
  return mounted ? createPortal(children, document.body) : null
}
