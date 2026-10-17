import { emitMetric } from '@/lib/observability/emf'

/**
 * Round H (H1): a small outside-in health check with no paid service. Once a minute the outbox worker
 * (which always runs) requests the home page and /api/health through the public site, like a
 * visitor, and writes SiteUp (1 or 0) and the response time as CloudWatch metrics. The alarm fires
 * when a check fails for 3 minutes in a row, and also when the metric stops arriving.
 */
export const SITE_HEALTH_PROBE_MS = 60_000
export const SITE_HEALTH_TIMEOUT_MS = 10_000
export const SITE_HEALTH_CHECKS = [
  { check: 'home', path: '/' },
  { check: 'api-health', path: '/api/health' },
] as const

export function siteHealthBaseUrl(env: Record<string, string | undefined> = process.env) {
  return (env.HEALTH_PROBE_SITE_URL || env.NEXT_PUBLIC_SITE_URL || 'https://seanshore.in').trim().replace(/\/+$/, '')
}

export async function runSiteHealthProbe(input: {
  baseUrl?: string
  fetchImpl?: typeof fetch
  write?: (line: string) => void
  now?: () => number
} = {}) {
  const baseUrl = input.baseUrl ?? siteHealthBaseUrl()
  const fetchImpl = input.fetchImpl ?? fetch
  const now = input.now ?? Date.now
  const results: Array<{ check: string; up: boolean; status: number | null; ms: number }> = []
  for (const { check, path } of SITE_HEALTH_CHECKS) {
    const started = now()
    let status: number | null = null
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        headers: { 'user-agent': 'SeaNShore-HealthProbe/1' },
        signal: AbortSignal.timeout(SITE_HEALTH_TIMEOUT_MS),
      })
      status = response.status
      await response.body?.cancel().catch(() => undefined)
    } catch {
      status = null
    }
    const ms = Math.max(0, now() - started)
    const up = status !== null && status >= 200 && status < 400
    results.push({ check, up, status, ms })
    emitMetric({
      dimensions: { Check: check },
      metrics: { SiteUp: { value: up ? 1 : 0 }, SiteResponseTime: { value: ms, unit: 'Milliseconds' } },
    }, input.write)
  }
  return results
}
