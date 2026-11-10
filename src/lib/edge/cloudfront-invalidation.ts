import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { emitMetric } from '@/lib/observability/emf'

/**
 * Round ARCH (Phase 2): clears a claimed organization's public page from CloudFront when the organization
 * edits it, so visitors see the change at once instead of after the page's 5 + 10 minute cache life
 * (src/lib/http/public-page-cache.ts).
 *
 * - One path per organization: `/organizations/<slug>*`. The page cache keys on the query string, so the
 *   wildcard also clears the ?tab= variants. It may also clear another organization whose slug starts with
 *   this one (one extra cache miss, never a stale page). CloudFront bills a wildcard path as one path.
 * - At most one invalidation per organization per minute: edits in a burst (logo, cover, about) send one.
 *   The map is per web task, so with N tasks an organization can be cleared up to N times a minute.
 * - `immediate` (an organization suspended, rejected, unclaimed or removed) skips the minute's wait.
 * - Never fails the edit: an error is counted (OrgPageInvalidationFailures) and logged without member data;
 *   the page then expires on its own.
 * - Without APP_CLOUDFRONT_DISTRIBUTION_ID (development, tests) nothing is sent.
 *
 * Metrics (namespace SeaNShore/App, Area=organizations): OrgPageInvalidations per CreateInvalidation sent,
 * OrgPageInvalidationsDeduped per request skipped inside the minute, OrgPageInvalidationFailures per failure.
 */
export const ORGANIZATION_PAGE_INVALIDATION_WINDOW_MS = 60_000
const INVALIDATION_TIMEOUT_MS = 3_000
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,199}$/

export type OrganizationPageInvalidationResult = 'sent' | 'deduped' | 'disabled' | 'invalid' | 'failed'

type InvalidationSender = {
  send(command: CreateInvalidationCommand, options?: { abortSignal?: AbortSignal }): Promise<unknown>
}

export function organizationPageInvalidationPath(slug: string) {
  return `/organizations/${slug}*`
}

export function createOrganizationPageInvalidator(input: {
  distributionId: () => string | null | undefined
  sender?: () => InvalidationSender
  now?: () => number
  metric?: typeof emitMetric
  log?: (line: string) => void
}) {
  const now = input.now ?? Date.now
  const metric = input.metric ?? emitMetric
  const log = input.log ?? ((line: string) => console.warn(line))
  const lastSent = new Map<string, number>()
  let client: InvalidationSender | null = null
  const sender = () => (client ??= input.sender ? input.sender() : new CloudFrontClient({}))

  function count(name: string) {
    metric({ dimensions: { Area: 'organizations' }, metrics: { [name]: { value: 1 } } })
  }

  function prune(at: number) {
    if (lastSent.size < 1_000) return
    for (const [slug, sentAt] of lastSent) {
      if (at - sentAt >= ORGANIZATION_PAGE_INVALIDATION_WINDOW_MS) lastSent.delete(slug)
    }
  }

  return async function invalidateOrganizationPage(slug: string, options: { immediate?: boolean } = {}): Promise<OrganizationPageInvalidationResult> {
    const distributionId = input.distributionId()?.trim()
    if (!distributionId) return 'disabled'
    if (!SLUG_PATTERN.test(slug)) return 'invalid'

    const at = now()
    const previous = lastSent.get(slug)
    if (!options.immediate && previous !== undefined && at - previous < ORGANIZATION_PAGE_INVALIDATION_WINDOW_MS) {
      count('OrgPageInvalidationsDeduped')
      return 'deduped'
    }
    prune(at)
    lastSent.set(slug, at)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), INVALIDATION_TIMEOUT_MS)
    try {
      await sender().send(new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: `org-page-${slug}-${at}`.slice(0, 128),
          Paths: { Quantity: 1, Items: [organizationPageInvalidationPath(slug)] },
        },
      }), { abortSignal: controller.signal })
      count('OrgPageInvalidations')
      return 'sent'
    } catch (error) {
      // Let the next edit try again rather than wait out the minute.
      if (lastSent.get(slug) === at) lastSent.delete(slug)
      count('OrgPageInvalidationFailures')
      log(JSON.stringify({ event: 'org_page_invalidation_failed', reason: error instanceof Error ? error.name : 'unknown' }))
      return 'failed'
    } finally {
      clearTimeout(timer)
    }
  }
}

export const invalidateOrganizationPage = createOrganizationPageInvalidator({
  distributionId: () => process.env.APP_CLOUDFRONT_DISTRIBUTION_ID,
})
