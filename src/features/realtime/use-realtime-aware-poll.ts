'use client'

import { useEffect, useRef } from 'react'
import { startVisibleInterval } from '@/lib/browser/visible-interval'
import { useOptionalMessagingRealtime } from './provider'

/** A burst of realtime hints asks the server once per this window. */
export const REALTIME_HINT_DEBOUNCE_MS = 2_000

/**
 * Round ARCH (Phase 5): a check that runs on realtime hints and, as a fallback, on a timer.
 *
 * - A hint of one of `hintEventTypes` runs the check within 2 s (one check per burst, only while the tab is visible).
 * - While the realtime socket is connected and `pauseWhileConnected` is set, the timer is off: the hints carry it.
 *   Coming back from a dropped socket, the check runs once at once (anything missed while it was down).
 * - Otherwise (no socket, socket down, or a check hints cannot fully cover) the timer runs every `intervalMs` while
 *   the tab is visible, as before.
 */
export function useRealtimeAwarePoll(check: () => void, options: {
  intervalMs: number
  hintEventTypes: readonly string[]
  pauseWhileConnected: boolean
  enabled?: boolean
}) {
  const realtime = useOptionalMessagingRealtime()
  const subscribe = realtime?.subscribe
  const connected = realtime?.status === 'connected'
  const enabled = options.enabled ?? true
  const paused = enabled && options.pauseWhileConnected && connected
  const checkRef = useRef(check)
  const wasPausedRef = useRef<boolean | null>(null)
  const everPausedRef = useRef(false)
  const hintTypes = options.hintEventTypes.join('|')

  useEffect(() => {
    checkRef.current = check
  }, [check])

  // The fallback timer, off while the hints carry the check. Each switch runs one catch-up check: when the socket
  // drops (nothing will hint until it is back) and when it comes back after a drop (whatever it missed). A page's
  // first connect is not a catch-up: the page was just loaded.
  useEffect(() => {
    if (!enabled) return
    const previous = wasPausedRef.current
    wasPausedRef.current = paused
    const visible = document.visibilityState === 'visible'
    if (paused) {
      if (previous === false && everPausedRef.current && visible) checkRef.current()
      everPausedRef.current = true
      return
    }
    if (previous === true && visible) checkRef.current()
    return startVisibleInterval(() => checkRef.current(), options.intervalMs)
  }, [enabled, paused, options.intervalMs])

  // The hints.
  useEffect(() => {
    if (!enabled || !subscribe) return
    const wanted = new Set(hintTypes.split('|').filter(Boolean))
    let timer: number | null = null
    const unsubscribe = subscribe((signal) => {
      if (!wanted.has(signal.eventType) || timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        if (document.visibilityState === 'visible') checkRef.current()
      }, REALTIME_HINT_DEBOUNCE_MS)
    })
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      unsubscribe()
    }
  }, [enabled, subscribe, hintTypes])
}
