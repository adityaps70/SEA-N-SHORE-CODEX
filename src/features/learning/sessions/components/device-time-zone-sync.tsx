'use client'

import { useEffect } from 'react'
import { syncDeviceTimeZoneAction } from '../time-zone-actions'
import { isValidTimeZone } from '../session-time'

const KEY = 'sns-device-time-zone-synced'

/**
 * Round D (D2): keeps an "Automatic" member's email time zone in step with the device they are using, at most once per
 * browser session and only when it changed. Sends only the zone name.
 */
export function DeviceTimeZoneSync() {
  useEffect(() => {
    let zone: string
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return
    }
    if (!isValidTimeZone(zone)) return
    try {
      if (window.sessionStorage.getItem(KEY) === zone) return
      window.sessionStorage.setItem(KEY, zone)
    } catch {
      // Storage may be blocked; syncing once per page view is still fine.
    }
    void syncDeviceTimeZoneAction(zone).catch(() => undefined)
  }, [])
  return null
}
