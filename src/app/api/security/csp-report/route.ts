import { siteOrigin } from '@/lib/site-url'
import { trustedClientIp } from '@/lib/http/client-ip'
import { cspReportOverRateLimit } from '@/lib/security/csp-report-rate-limit'
import { cspBlockedHost, cspDirectiveName, cspSection, cspSource, recordCspRateLimited, recordCspViolation } from '@/lib/security/csp-report-summary'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 16 * 1024
const MAX_REPORTS_PER_REQUEST = 5
/** Round P3: the page reporter (csp-reporter-script.ts) sends unique violations in batches of this size. */
const MAX_BEACON_VIOLATIONS = 20

type Violation = { directive: string; blocked: string; source: string; section: string }

function violation(directive: unknown, blocked: unknown, source: unknown, section: unknown): Violation[] {
  if (typeof directive !== 'string' || !directive.trim()) return []
  return [{ directive: cspDirectiveName(directive), blocked: cspBlockedHost(blocked), source: cspSource(source), section: cspSection(section) }]
}

/**
 * Accepts the page reporter's batch ({"violations": [{directive, blocked, source, section}]}), the
 * legacy report-uri body ({"csp-report": …}, only API responses still name report-uri) and
 * Reporting API arrays.
 */
function violations(payload: unknown): Violation[] {
  const beacon = (payload as { violations?: unknown })?.violations
  if (Array.isArray(beacon)) {
    return beacon.slice(0, MAX_BEACON_VIOLATIONS).flatMap((item) => {
      const entry = item as { directive?: unknown; blocked?: unknown; source?: unknown; section?: unknown } | null
      return entry && typeof entry === 'object' ? violation(entry.directive, entry.blocked, entry.source, entry.section) : []
    })
  }
  const items = Array.isArray(payload) ? payload.map((entry) => (entry as { body?: unknown })?.body) : [(payload as { 'csp-report'?: unknown })?.['csp-report']]
  return items.slice(0, MAX_REPORTS_PER_REQUEST).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const report = item as Record<string, unknown>
    return violation(
      report['effective-directive'] ?? report.effectiveDirective ?? report['violated-directive'],
      report['blocked-uri'] ?? report.blockedURL,
      report['source-file'] ?? report.sourceFile,
      'api',
    )
  })
}

/**
 * Round 14 (2.4): CSP violation reports, so the policy can be tuned before it is enforced.
 * Round H (H4): counted per directive and blocked host and logged as one summary line at most once
 * a minute (csp-report-summary.ts): no document paths, query strings or script samples.
 * Round P3: pages report each unique violation once per page load (csp-reporter-script.ts), and
 * each visitor gets a fixed number of requests a minute (csp-report-rate-limit.ts); the rest are counted unread.
 */
export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  if (origin && origin !== siteOrigin() && origin !== 'null') return new Response(null, { status: 204 })
  if (cspReportOverRateLimit(trustedClientIp(request.headers))) {
    recordCspRateLimited()
    return new Response(null, { status: 204 })
  }
  const text = await request.text().catch(() => '')
  if (!text || text.length > MAX_BODY_BYTES) return new Response(null, { status: 204 })
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return new Response(null, { status: 204 })
  }
  for (const entry of violations(payload)) recordCspViolation(entry.directive, entry.blocked, Date.now(), entry.source, entry.section)
  return new Response(null, { status: 204 })
}
