'use client'

import { useSyncExternalStore } from 'react'
import { formatZonedRange, formatZonedTime, isValidTimeZone } from '../session-time'

function subscribe() {
  return () => undefined
}

function deviceZone() {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isValidTimeZone(resolved) ? resolved : null
  } catch {
    return null
  }
}

/** The device's own time zone in the browser; null on the server (so the first render matches the server's). */
export function useDeviceTimeZone() {
  return useSyncExternalStore(subscribe, deviceZone, () => null)
}

/**
 * Round D (D2): a session time in the viewer's own time zone, with the zone named ("Mon 13 Oct, 19:00–20:30 IST
 * (Asia/Kolkata)"). The server renders it in `fallbackZone` (the batch's zone); the browser switches to its own.
 */
export function LocalSessionTime({ startsAt, durationMinutes, fallbackZone, withYear = false }: { startsAt: string; durationMinutes?: number; fallbackZone: string; withYear?: boolean }) {
  const device = useDeviceTimeZone()
  const zone = device ?? fallbackZone
  const label = durationMinutes ? formatZonedRange(startsAt, durationMinutes, zone, { withYear }) : formatZonedTime(startsAt, zone, { withYear })
  return <time dateTime={startsAt}>{label}</time>
}
