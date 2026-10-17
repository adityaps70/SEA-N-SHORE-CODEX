/**
 * Round H (H4): CSP violation reports are counted in memory per (directive, blocked host) and
 * written as one summary line at most once a minute. Only a directive name and a bare host (or a
 * keyword such as `inline`) are kept: never full URLs, query strings, document paths or samples.
 */
export const CSP_REPORT_FLUSH_INTERVAL_MS = 60_000

// Bounds memory when a page (or someone posting junk) produces many distinct hosts in one window.
const MAX_DISTINCT_KEYS = 100
const OVERFLOW_KEY = 'other\nother'

let counts = new Map<string, number>()
let windowStartedAt = 0
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** A CSP directive name such as `script-src-elem`, or `other`. */
export function cspDirectiveName(value: unknown): string {
  const directive = typeof value === 'string' ? value.trim().split(/\s+/)[0]?.toLowerCase() ?? '' : ''
  return /^[a-z][a-z-]{0,39}$/.test(directive) ? directive : 'other'
}

/**
 * What was blocked, reduced to a host (`evil.example.com`, port kept), a scheme for non-network
 * URLs (`data`, `blob`) or a short keyword (`inline`, `eval`). Anything else is `other`.
 */
export function cspBlockedHost(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'none'
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ws:' || url.protocol === 'wss:') return url.host.slice(0, 100) || 'other'
    const scheme = url.protocol.slice(0, -1)
    return /^[a-z][a-z0-9+.-]{0,19}$/.test(scheme) ? scheme : 'other'
  } catch {
    const keyword = value.trim().toLowerCase()
    return /^[a-z][a-z-]{0,19}$/.test(keyword) ? keyword : 'other'
  }
}

export function recordCspViolation(directive: string, blocked: string, now = Date.now()): void {
  let key = `${directive}\n${blocked}`
  if (!counts.has(key) && counts.size >= MAX_DISTINCT_KEYS) key = OVERFLOW_KEY
  if (counts.size === 0) {
    windowStartedAt = now
    const timer = setTimeout(() => flushCspViolationSummary(), CSP_REPORT_FLUSH_INTERVAL_MS)
    // Never keep the process alive just to write a summary.
    if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()
    flushTimer = timer
  }
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

/** Writes the window's counts as one JSON line (nothing when empty) and starts a new window. */
export function flushCspViolationSummary(now = Date.now()): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  if (counts.size === 0) return
  const violations = [...counts]
    .map(([key, count]) => {
      const [directive, blocked] = key.split('\n')
      return { directive, blocked, count }
    })
    .sort((a, b) => b.count - a.count)
  const total = violations.reduce((sum, entry) => sum + entry.count, 0)
  const windowSeconds = Math.max(1, Math.round((now - windowStartedAt) / 1000))
  counts = new Map()
  console.log(JSON.stringify({ event: 'csp_violation_summary', windowSeconds, total, violations }))
}
