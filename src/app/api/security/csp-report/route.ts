import { siteOrigin } from '@/lib/site-url'
import { cspBlockedHost, cspDirectiveName, recordCspViolation } from '@/lib/security/csp-report-summary'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 16 * 1024
const MAX_REPORTS_PER_REQUEST = 5

type Violation = { directive: string; blocked: string }

/** Accepts the legacy report-uri body ({"csp-report": …}) and Reporting API arrays. */
function violations(payload: unknown): Violation[] {
  const items = Array.isArray(payload) ? payload.map((entry) => (entry as { body?: unknown })?.body) : [(payload as { 'csp-report'?: unknown })?.['csp-report']]
  return items.slice(0, MAX_REPORTS_PER_REQUEST).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const report = item as Record<string, unknown>
    const directive = report['effective-directive'] ?? report.effectiveDirective ?? report['violated-directive']
    if (typeof directive !== 'string' || !directive.trim()) return []
    return [{ directive: cspDirectiveName(directive), blocked: cspBlockedHost(report['blocked-uri'] ?? report.blockedURL) }]
  })
}

/**
 * Round 14 (2.4): CSP violation reports, so the policy can be tuned before it is enforced.
 * Round H (H4): counted per directive and blocked host and logged as one summary line at most once
 * a minute (csp-report-summary.ts): no document paths, query strings or script samples.
 */
export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  if (origin && origin !== siteOrigin() && origin !== 'null') return new Response(null, { status: 204 })
  const text = await request.text().catch(() => '')
  if (!text || text.length > MAX_BODY_BYTES) return new Response(null, { status: 204 })
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return new Response(null, { status: 204 })
  }
  for (const violation of violations(payload)) recordCspViolation(violation.directive, violation.blocked)
  return new Response(null, { status: 204 })
}
