'use client'

import { useEffect } from 'react'
import { DISPLAY_MODE_COOKIE, displayModeCookieLine, runningStandalone, STANDALONE_DISPLAY_MODE } from '@/lib/pwa/display-mode'

/** Round I (I3): keeps the Home Screen app marker cookie in step with how the page is running (see lib/pwa). */
export function DisplayModeMarker() {
  useEffect(() => {
    const standalone = runningStandalone(window)
    const marked = document.cookie.split(';').some((part) => part.trim() === `${DISPLAY_MODE_COOKIE}=${STANDALONE_DISPLAY_MODE}`)
    if (standalone === marked) return
    document.cookie = displayModeCookieLine(standalone, window.location.protocol === 'https:')
  }, [])
  return null
}
