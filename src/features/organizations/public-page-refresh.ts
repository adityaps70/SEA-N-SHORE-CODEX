import { invalidateOrganizationPage } from '@/lib/edge/cloudfront-invalidation'

/**
 * Round ARCH (Phase 2): clears an organization's public page from CloudFront after something on it changed
 * (src/lib/edge/cloudfront-invalidation.ts: one per organization per minute, unless `immediate`). Give the
 * slug when the caller has it, else a lookup, the organization id or a course it publishes (looked up only
 * when CloudFront clearing is configured). Never throws, so it never fails the edit.
 */
// Loaded only when a page is actually cleared, so the many actions that import this stay free of the database module.
async function workspaceRepository() {
  return (await import('./workspace-repository')).organizationWorkspaceRepository
}

export async function clearOrganizationPublicPage(
  target: { slug?: string | null; companyId?: string | null; courseId?: string; resolveSlug?: () => Promise<string | null | undefined> },
  options: { immediate?: boolean } = {},
): Promise<void> {
  try {
    if (!process.env.APP_CLOUDFRONT_DISTRIBUTION_ID?.trim()) return
    const slug = target.slug
      || (target.resolveSlug ? await target.resolveSlug() : null)
      || (target.companyId ? await (await workspaceRepository()).getSlugById(target.companyId) : null)
      || (target.courseId ? await (await workspaceRepository()).getSlugByCourseId(target.courseId) : null)
    if (!slug) return
    await invalidateOrganizationPage(slug, options)
  } catch {
    // The page expires on its own (5 minutes, then up to 10 more served stale).
  }
}
