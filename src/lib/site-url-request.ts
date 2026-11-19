/**
 * The origin the current request came in on (see siteOriginFor in site-url.ts), for Server Actions and services that
 * build a URL a member is sent back to. Outside a request (workers, tests) it is the canonical origin.
 *
 * Both imports are dynamic on purpose. The background workers bundle the payment and billing services:
 * - plain Node cannot load `next/headers` as an ES module, so a static import would stop the outbox worker at
 *   start-up;
 * - site-url.ts reads NEXT_PUBLIC_SITE_URL when it is first loaded, which workers do not set
 *   (scripts/workers/worker-imports.test.mjs loads every worker without the web environment).
 * Nothing here runs until a checkout is created, which only happens in the web app.
 */
export async function currentSiteOrigin(): Promise<string> {
  const { siteOrigin, siteOriginFor } = await import('@/lib/site-url')
  try {
    const { headers } = await import('next/headers')
    return siteOriginFor(await headers())
  } catch {
    return siteOrigin()
  }
}
