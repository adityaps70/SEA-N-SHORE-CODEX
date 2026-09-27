import {
  canPostAsOrganization,
  canUseOrganizationRoleCapability,
  type AccessContext,
} from '@/features/access/policy'

export type ManagedPost = {
  authorId: string
  companyId: string | null
}

export type PostPermissions = {
  canEdit: boolean
  canDelete: boolean
}

/**
 * Who may change a post.
 * - Personal posts: only their author.
 * - Organization posts: the author while they can still post for the organization, and the
 *   organization's owners and administrators. The author can always delete what they wrote.
 * `access` may be null for personal posts; it is required to grant anything on organization posts.
 */
export function postPermissions(access: AccessContext | null, viewerId: string, post: ManagedPost): PostPermissions {
  const isAuthor = Boolean(viewerId) && post.authorId === viewerId
  if (!post.companyId) return { canEdit: isAuthor, canDelete: isAuthor }
  if (!access || !access.accountActive) return { canEdit: false, canDelete: isAuthor }
  const organizationAdmin = canUseOrganizationRoleCapability(access, 'organization.manage_posts', post.companyId)
  const authorStillPosts = isAuthor && canPostAsOrganization(access, post.companyId)
  return {
    canEdit: authorStillPosts || organizationAdmin,
    canDelete: isAuthor || organizationAdmin,
  }
}
