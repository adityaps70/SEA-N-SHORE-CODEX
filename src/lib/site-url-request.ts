import { siteOrigin, siteOriginFor } from '@/lib/site-url'

/**
 * The origin the current request came in on (see siteOriginFor), for Server Actions and services that build a URL a
 * member is sent back to. Outside a request (workers, tests) it is the canonical origin.
 *
 * next/headers is imported dynamically on purpose: the background workers bundle the payment and billing services
 * with npm packages left external, and plain Node cannot load `next/headers` as an ES module. A static import would
 * stop the outbox worker at start-up; here a worker simply gets the canonical origin.
 */
export async function currentSiteOrigin(): Promise<string> {
  try {
    const { headers } = await import('next/headers')
    return siteOriginFor(await headers())
  } catch {
    return siteOrigin()
  }
}
