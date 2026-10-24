/**
 * Round P3: CSP report requests per visitor IP per minute, per web task. A page load sends one or
 * two batches (csp-reporter-script.ts), so only a flood reaches the limit; the endpoint counts the
 * requests it turns away (recordCspRateLimited) instead of dropping them silently.
 */
export const CSP_REPORT_REQUESTS_PER_MINUTE = 30
const RATE_WINDOW_MS = 60_000
// Bounds memory: a window that sees this many visitors starts over.
const MAX_TRACKED_VISITORS = 10_000

let windowStartedAt = 0
let requestsByVisitor = new Map<string, number>()

/** Records one request; true when the visitor is over the limit. No IP (never behind the ALB) is never limited. */
export function cspReportOverRateLimit(visitor: string | null, now = Date.now()): boolean {
  if (!visitor) return false
  if (now - windowStartedAt >= RATE_WINDOW_MS || requestsByVisitor.size >= MAX_TRACKED_VISITORS) {
    windowStartedAt = now
    requestsByVisitor = new Map()
  }
  const seen = (requestsByVisitor.get(visitor) ?? 0) + 1
  requestsByVisitor.set(visitor, seen)
  return seen > CSP_REPORT_REQUESTS_PER_MINUTE
}

/** For tests: forget the current window. */
export function resetCspReportRateLimit() {
  windowStartedAt = 0
  requestsByVisitor = new Map()
}
