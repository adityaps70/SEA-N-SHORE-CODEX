import { OrganizationPostsTab } from '@/features/feed/components/organization-posts-tab'

/**
 * Posts published as an organization, on the organization page. The Posts tab lists them with
 * a composer for members who can post; the Home tab shows a short preview without the composer.
 */
export function OrganizationPostsSlot({
  companyId,
  companySlug,
  canPost,
  limit,
}: {
  companyId: string
  companySlug: string
  canPost: boolean
  /** Show only the latest N posts (Home tab preview). */
  limit?: number
}) {
  return (
    <OrganizationPostsTab
      companyId={companyId}
      companySlug={companySlug}
      canPost={limit ? false : canPost}
      limit={limit}
    />
  )
}
