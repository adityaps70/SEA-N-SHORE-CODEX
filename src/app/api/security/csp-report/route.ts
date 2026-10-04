import { siteOrigin } from '@/lib/site-url'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 16 * 1024
const MAX_REPORTS_PER_REQUEST = 5

type Violation = { directive: string; blocked: string; page: string }

function originOrKeyword(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  try {
    return new URL(value).origin
  } catch {
    return value.slice(0, 40)
  }
}

function pathOf(value: unknown): string {
  if (typeof value !== 'string') return ''
  try {
    return new URL(value).pathname.slice(0, 200)
  } catch {
    return ''
  }
}

/** Accepts the legacy report-uri body ({"csp-report": …}) and Reporting API arrays. */
function violations(payload: unknown): Violation[] {
  const items = Array.isArray(payload) ? payload.map((entry) => (entry as { body?: unknown })?.body) : [(payload as { 'csp-report'?: unknown })?.['csp-report']]
  return items.slice(0, MAX_REPORTS_PER_REQUEST).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const report = item as Record<string, unknown>
    const directive = String(report['effective-directive'] ?? report.effectiveDirective ?? report['violated-directive'] ?? '').slice(0, 60)
    if (!directive) return []
    return [{
      directive,
      blocked: originOrKeyword(report['blocked-uri'] ?? report.blockedURL),
      page: pathOf(report['document-uri'] ?? report.documentURL),
    }]
  })
}

/**
 * Round 14 (2.4): CSP Report-Only violations, logged as one compact line each (origin and path
 * only: no query strings, no script samples) so the policy can be tuned before it is enforced.
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
  for (const violation of violations(payload)) {
    console.log(JSON.stringify({ event: 'csp_report_only_violation', ...violation }))
  }
  return new Response(null, { status: 204 })
}
