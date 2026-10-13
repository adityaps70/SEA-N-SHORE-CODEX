'use client'

import { useEffect } from 'react'

const SOURCES = new Set(['digest', 'job_alert'])

/**
 * Round G (MEASURE): when a page opens from a job alert or the digest (?src=digest|job_alert), count
 * the visit once and take the parameter out of the address (other parameters stay). No cookies,
 * no pixels.
 */
export function SourceVisitBeacon() {
  useEffect(() => {
    const url = new URL(window.location.href)
    const source = url.searchParams.get('src')
    if (!source || !SOURCES.has(source)) return
    void fetch(`/api/metrics/visit?src=${source}`, { method: 'POST', keepalive: true }).catch(() => undefined)
    url.searchParams.delete('src')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])
  return null
}
